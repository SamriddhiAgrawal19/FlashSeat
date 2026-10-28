# FlashSeat — Load Test Results (Phase 2, Step 7)

Runs: 2026-10-27/28 (IST, around midnight). The final numbers come from the
**pre-registered-token runs**: Test A run 2, Test B run 2 (pool 10) and run 3 (pool 50).
The earlier attempts, and what each one taught, are kept at the end.

## Environment

| | |
|---|---|
| k6 | v2.3.0 (commit e088784614, go1.26.8, windows/amd64) |
| OS | Windows 11 Home Single Language 10.0.26200 |
| CPU | Intel Core Ultra 9 185H, 16 cores / 22 logical |
| RAM | 31.4 GB (Docker VM: 22 CPUs, 15.3 GB) |
| Node | v22.15.1, `UV_THREADPOOL_SIZE` unset (default 4) |
| API | `node dist/server.js` (compiled, freshly built), single process |
| Sweeper | separate process, `tsx src/workers/sweeper.ts`, own pool of 10 |
| Postgres | 16.15 (Debian), Docker Desktop, `postgres:16`, `max_connections=100` |
| Load generator | k6 on the **same machine** as API and DB (competes for CPU) |

| Setting (`.env`) | Value |
|---|---|
| `DB_POOL_MAX` | 10 (50 only for Test B run 3, then reverted and confirmed: `grep` shows 10, live API uses 10 backends) |
| `DB_CONNECTION_TIMEOUT_MS` | 5000 |
| `DB_STATEMENT_TIMEOUT_MS` | 5000 |
| `DB_LOCK_TIMEOUT_MS` | 1000 |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | 10000 |
| `SWEEPER_INTERVAL_MS` | 15000 |
| `HOLD_DURATION_SECONDS` | 600 |
| `JWT_ACCESS_EXPIRY` | 15m (why tokens are registered right before each run) |

## Methodology

- **Measured traffic is `POST /shows/:showId/reservations` only.** Attendees are
  registered beforehand with `load/register-users.mjs` (real API, 39–63
  registrations/s depending on the run, argon2-bound), and their access tokens are written to
  `load/fixtures/tokens-<test>.json`. k6 reads them through a `SharedArray`.
  `load/run.mjs` refuses a token file older than 10 minutes.
- **Token sizing.** VU *n* always uses token *n−1*, and a VU runs its iterations one after
  another, so no two in-flight requests ever share a user. Test A has 1000 VUs and 1200
  tokens; the 200 spare mean a VU-count bump can't silently start sharing tokens. Test B
  has 10,000 VUs and 10,000 tokens. Reusing a token across iterations means a user who
  already won a seat on a show gets `409 ACTIVE_RESERVATION_EXISTS` there afterwards
  (one ACTIVE hold per user per show, `uq_one_active_reservation`). That is a correct
  rejection, and it is counted separately.
- **Refused TCP connects are retried; nothing else is.** Windows client editions cap the
  listen backlog, so a burst of new connections is refused before Express sees it. A
  refused connect carries no request, so retrying it can't create a second reservation
  attempt. Retries use full-jitter exponential backoff (100 ms doubling to a 5 s cap,
  30 retries max). Resets and timeouts are *not* retried. They are counted as
  "unknown outcome", because the server may have committed them.
- **Every request is bounded.** There is a 30 s client timeout, and the ramp-down grace is
  40 s, so no iteration is silently interrupted.
- **DB cross-check** (`load/run.mjs`, after every run): seat statuses, reservation statuses,
  no seat in more than one ACTIVE reservation, every HELD seat owned by an ACTIVE
  reservation listing it, and every ACTIVE reservation holding exactly one HELD seat.
  It also checks `k6 201s ≤ DB ACTIVE ≤ k6 201s + unknown-outcome`, which collapses to
  equality when nothing was lost in transit.
- **Timeline:** `k6 --out csv` goes to `throughput-runN.csv.gz`, and
  `node load/timeline.mjs` turns it into 10 s buckets (`throughput-runN-timeline.csv`).
- **Event-loop probe:** `GET /__loadtest_probe` (an Express 404, no DB work) once a second
  during Test B (`throughput-runN-probe.csv`). It separates "API stalled" from "API
  waiting on the pool".
- `http_req_failed` treats 409 as expected (a correct business answer), so it counts
  5xx, other 4xx and transport errors.

## What overload looks like (expectation, written before any numbers)

Each request checks a client out of a `DB_POOL_MAX` pool. Waiters queue in pg-pool, and
after `DB_CONNECTION_TIMEOUT_MS` (5 s) they get `timeout exceeded when trying to connect`.
`errorHandler.isConnectionError` turns that into **503 `DB_UNAVAILABLE`** with
`Retry-After: 1`. A slow statement becomes 503 `DB_TIMEOUT` (57014). A row-lock wait
longer than 1 s becomes **409 `LOCK_TIMEOUT`** (55P03). A taken seat is **409
`SEATS_UNAVAILABLE`**. Expected, by design: 503s with latency clustered just above 5 s.
A real bug would be any 500, a seat held twice, or a DB count that doesn't reconcile
with k6.

---

## Test A: correctness under maximum contention

`load/contention.k6.js` uses the `shared-iterations` executor with 1000 VUs, 5000
iterations and no think time. There is **one show with 100 seats**, and each iteration
makes one hold attempt on a random seat.
Output: `load/results/contention-run2.txt`, `contention-run2-summary.json`.

| Result | Count |
|---|---|
| Hold attempts that reached the server | **5000 / 5000** |
| 201 Created | **100** |
| 409 `SEATS_UNAVAILABLE` | 4483 |
| 409 `ACTIVE_RESERVATION_EXISTS` (a winner trying again) | 417 |
| 409 `LOCK_TIMEOUT` | 0 |
| 5xx / other | 0 / 0 |
| Refused TCP connects (retried, all eventually connected) | 9341 (0 gave up) |
| Duration / rate | 9.7 s, **517 hold attempts/s** |
| Latency (server-reached) | p50 1.84 s, p95 1.96 s, p99 1.97 s, max 2.01 s |

| DB right after the run | |
|---|---|
| show_seats | **100 HELD**, 0 AVAILABLE, 0 BOOKED |
| reservations | **100 ACTIVE** (no other status) |
| k6 201s = ACTIVE reservations = HELD seats | 100 = 100 = 100 ✅ |
| seats in more than one ACTIVE reservation | 0 ✅ |
| orphan HELD seats / ACTIVE reservations not holding exactly one seat | 0 / 0 ✅ |

**Reading it.** 5000 concurrent attempts on 100 seats gave **exactly 100 successes**,
and the database agrees row for row. Each of the other 4900 attempts got a correct 409.
4483 were "seat already taken", and 417 were users who already held a seat being told to
finish that hold first. There were zero lock timeouts. Lock waits on a hot seat row stayed
well under the 1 s `lock_timeout`, because each hold transaction is short and holds the
seat lock only until it commits or rolls back. There were zero 5xx and zero deadlocks. The latency is queueing,
not work: 1000 requests in flight ÷ 517 completions/s ≈ 1.9 s (Little's law), which is
the observed p50. Getting exactly 100 is expected rather than lucky: with 5000 uniform
picks over 100 seats, the chance that some seat is never picked is about
100 × 0.99⁵⁰⁰⁰ ≈ 10⁻²⁰.

---

## Test B: throughput and latency without seat contention

`load/throughput.k6.js` uses `ramping-vus`: 0 → 10,000 VUs over 1 m, hold for 1 m, ramp
down over 30 s. There are 200 independent shows × 50 seats = 10,000 seats, and each
iteration holds one random seat on one random show.
Executor choice: `ramping-vus` is a closed model. A VU waits for its response before
sending again, so 10,000 VUs means up to **10,000 requests in flight at once**, which is
"10,000 concurrent requests" as stated. An arrival-rate executor fixes requests/s and
lets concurrency float, which answers a different question.

### Run 2: `DB_POOL_MAX=10` (baseline)

Output: `throughput-run2.txt`, `-summary.json`, `.csv.gz`, `-timeline.csv`, `-probe.csv`.

| Metric | Value |
|---|---|
| Requests that reached the server | 159,645 in 150.7 s, so **1,059 req/s average, ~1,330 req/s peak** |
| 201 Created (holds) | **7,611** (50/s average; **~390 completed holds+409s per second at peak goodput**) |
| 409 | 6,905 (6,762 `SEATS_UNAVAILABLE` random collisions, 143 `ACTIVE_RESERVATION_EXISTS`, 0 `LOCK_TIMEOUT`) |
| 503 `DB_UNAVAILABLE` | 145,129 (pool checkout timeouts) |
| 429 / 500 / other 5xx | 0 / 0 / 0 |
| Refused connects (retried) / gave up after 30 | 56,862 / 801 |
| Unknown outcome (client timeout or reset) | 1 |
| Reserve latency, server-reached | **p50 6.16 s, p95 7.47 s, p99 11.29 s** (min 65 ms, max 29.9 s) |
| Event-loop probe (no-DB route) | p50 410 ms, p95 2.25 s, max 2.52 s, 0 failed; **4–8 ms in the first 12 s** |
| API log | 145,129 "Mapped database error" = 145,129 503s; 6,905 rollbacks = 6,905 409s; **0 idle-in-transaction kills** |
| DB check | 7,611 ≤ **7,612 ACTIVE = 7,612 HELD** ≤ 7,611 + 1 ✅; no double holds ✅ |

Timeline (10 s buckets; req/s = server-reached reservations; 201/409/503 are counts per bucket):

| t (s) | VUs | req/s | p50 ms | p95 ms | p99 ms | 201 | 409 | 503 |
|---|---|---|---|---|---|---|---|---|
| 0 | 1,340 | 340 | 1,388 | 2,540 | 2,624 | 2,892 | 507 | 0 |
| 10 | 3,007 | 436 | 4,245 | 5,037 | 5,049 | 2,253 | 1,605 | 499 |
| 20 | 4,674 | 715 | 5,009 | 5,079 | 5,116 | 826 | 1,097 | 5,225 |
| 30 | 6,340 | 968 | 5,060 | 5,219 | 5,504 | 164 | 253 | 9,266 |
| 40 | 8,007 | 1,241 | 5,432 | 5,870 | 7,599 | 44 | 74 | 12,287 |
| 60 | 10,000 | 1,302 | 6,010 | 6,203 | 11,291 | 5 | 8 | 13,004 |
| 90 | 10,000 | 1,260 | 6,765 | 6,903 | 14,717 | 3 | 3 | 12,590 |
| 120 | 10,000 | 1,213 | 7,370 | 7,607 | 18,491 | 1 | 3 | 12,122 |
| 140 | 5,162 | 819 | 5,040 | 6,162 | 15,069 | 1,083 | 2,443 | 4,659 |
| 150 | 1,003 | 106 | 3,664 | 4,321 | 4,369 | 265 | 794 | 0 |

**Interpretation.**

1. **The pool saturates at about 1–3k concurrent requests.** In the first 10 s
   (≤1,340 VUs), every request is served (0 503s), but p50 is already 1.4 s. That is time
   spent queueing for one of 10 connections, since the event-loop probe still reads 4–8 ms.
   By 10–20 s (about 3k VUs), p95 reaches **5.04 s, the pool checkout timeout**, and 503s
   begin. **Peak goodput is about 390 completed transactions/s** (201 + 409), the real
   service rate of 10 connections × one short hold transaction each.
2. **Past saturation the API sheds load exactly as designed.** p50 sits right on the 5 s
   timeout, and the API answers about 1,300 req/s with clean 503 + `Retry-After`. There
   are zero 500s and zero killed transactions, and every log line reconciles with a k6 count.
3. **Goodput then collapses at the 10k plateau (about 1 hold/s) while total throughput
   stays high.** Rejecting about 1,300 doomed requests/s and holding 10k sockets adds
   event-loop lag (probe p50 410 ms, up to 2.5 s). A hold transaction is about a dozen
   sequential queries, and every completion waits for an event-loop turn. So a checked-out
   connection is held for seconds instead of milliseconds, and 10 connections ÷ multi-second
   hold time comes out at about 1–2 transactions/s. The rare successes at the plateau are
   the p99 tail of 11–18 s: about 5 s waiting for a connection, then several seconds running
   under lag. This is classic congestion collapse. **The bottleneck is admission, not the
   pool size**: the API accepts far more work than 10 connections can finish, and the cost
   of rejecting it starves the work that would succeed. The fix is admission control (rate
   limiting, a bounded pool queue or faster shedding), not more connections. Run 3 confirms
   that.

### Run 3: `DB_POOL_MAX=50` (experiment, reverted afterwards)

Same scenario, fresh shows, fresh tokens. The API was restarted with pool 50; the sweeper
kept its own pool of 10. Sampled `pg_stat_activity` confirmed the API reached **50**
backends. Output: `throughput-run3.*`.

### Run 2 vs run 3

| Metric | run 2 (pool 10) | run 3 (pool 50) | Change |
|---|---|---|---|
| Requests that reached the server | 159,645 | 90,559 | −43% |
| Server-reached req/s (avg / peak 10 s) | 1,059 / 1,334 | 564 / 899 | worse |
| 201 Created (holds) | **7,611** | 4,592 | −40% |
| Peak goodput (201 + 409 per s) | ~390 | ~240 | −38% |
| Reserve latency p50 / p95 / p99 | 6.16 / 7.47 / 11.29 s | 7.93 / 11.01 / 11.77 s | worse |
| 503 | 145,129 | 84,293 | |
| 409 | 6,905 | 1,674 | |
| 500 / other 5xx / `LOCK_TIMEOUT` | 0 / 0 / 0 | 0 / 0 / 0 | same |
| Refused connects retried / gave up | 56,862 / 801 | 226,548 / 4,094 | worse |
| Unknown outcome (client timed out) | 1 | 397 | worse |
| Event-loop probe p50 / p95 / max / failed | 410 ms / 2.25 s / 2.52 s / 0 | 31 ms / 3.19 s / 5.87 s / 50 | worse tail |
| Idle-in-transaction kills | 0 | 0 | same |
| DB check (bounded equality, no double holds) | ✅ 7,611 ≤ 7,612 ≤ 7,612 | ✅ 4,592 ≤ 4,697 ≤ 4,989 | both pass |

**Interpretation.** **A 5× larger pool made every throughput and latency number worse.**
Even early in the ramp (10–20 s, about 2k VUs), pool 50 completed about 240 transactions/s
against about 390/s for pool 10. So the extra connections bought no extra database work;
they added contention. Likely causes, **not verified because no DB-side metrics were
captured**:
- 5× as many concurrent hold transactions inside one Postgres VM, all taking
  `FOR SHARE` locks on the same 200 show rows. Multiple share-lockers on a row create
  MultiXacts, and lock-manager traffic grows with concurrency.
- 5× more in-flight transactions per event-loop turn in the single Node process. The probe
  tail got worse (p95 3.2 s, 50 failed probes).
- k6 sharing the same CPU.

The 105 holds in the DB that k6 never saw a 201 for fall inside the 397 requests that k6
timed out on after 30 s: they committed, but the response arrived too late. The 252 extra
"Mapped database error" lines and 41 extra rollbacks in the API log are the same effect on
503 and 409 responses. **Conclusion: keep `DB_POOL_MAX=10`.** It was reverted, and the
evidence supports admission control over a bigger pool. Next time, capture
`pg_stat_activity` wait events and `pg_locks` to confirm the cause.

---

## Invariant checks (`check-invariants.sql`, 9 queries; `check-sweeper-invariants.sql`, 3 queries)

| When | Main | Sweeper |
|---|---|---|
| Fresh restart before the reruns | 0 rows ×9 | 0 rows ×3 |
| After Test A run 2 | 0 rows ×9 | 0 rows ×3 |
| After Test B run 2 (harness defect, see below) | 0 rows ×9 | 0 rows ×3 |
| After Test B run 2 (clean) | 0 rows ×9 | 0 rows ×3 |
| After Test B run 3 (pool 50) and the revert | 0 rows ×9 | 0 rows ×3 |
| After the final regression battery (no sweep wait) | 0 rows ×9 | 0 rows ×3 |

### `verify-batch1.mjs` fixture fix

Scenarios C and D used to backdate only `reservations.expires_at`, which left seats HELD
with a future `held_until` behind an EXPIRED reservation (check 3 found 2 rows after the
first battery). The new `backdateHold()` helper moves `expires_at` and the seats'
`held_until` to the **same** instant in one statement, matching what the API always
writes. Verification: verify-batch1 passed A–F while `check-invariants` was polled
continuously in parallel. All **33 polls returned 0 rows**, and a check right after the
run returned 0 rows ×9. The affected seats had matching timestamps and were already freed
by the sweeper.

## Regression battery (after all load runs)

| Suite | Result |
|---|---|
| `npm test` (vitest) | 7 files, 72/72 passed |
| `verify-batch1.mjs` | A–F PASS |
| `verify-batch2.mjs` | A–F PASS |
| `verify-batch3.mjs` | A–H PASS |
| `smoke-concurrency.mjs` (fresh 30-seat show) | 1–3 PASS |
| `smoke-checkout.mjs` (fresh 30-seat show) | A–C PASS |

---

## What this proves

- **Exactly-once seat allocation under a 50:1 burst.** 5000 concurrent attempts on 100
  seats gave exactly 100 holds, and the DB agreed row for row. There were zero lock
  timeouts and zero deadlocks.
- **No overselling at 10,000 concurrent connections.** Across 12,309 holds committed in
  Test B (7,612 + 4,697 DB rows), no seat was ever in two live reservations. Every DB row
  reconciles with what k6 saw, up to requests whose responses were lost to client timeouts.
- **Overload fails safe.** Bounded 5 s waits produced clean 503 + `Retry-After`, with zero
  500s across about 255k requests that reached the server. The idle-in-transaction guard
  killed stuck transactions when the event loop stalled (in the defective run), and the
  invariants stayed clean afterwards. No restart was ever needed.
- **Pool size isn't the lever.** At this load, 50 connections did worse than 10.

## What this does not test yet

- **Admission control and rate limiting** (zero 429s are possible today). This is the
  first thing to add, given the goodput collapse.
- Single machine with k6, API and Postgres sharing one CPU. Single Node process, no
  cluster mode or horizontal scaling, no load balancer.
- No Redis or cache layer.
- Login and registration under load (argon2 inside the transaction is logged in
  `docs/todo.md`).
- Checkout/payment under load, multi-seat holds, the sweeper under a large expiry backlog.
- Long soak, memory growth, and Postgres-side metrics (wait events, locks, WAL, CPU).
- Linux, where the listen backlog is configurable and Windows' cap goes away.

## Resume / README one-liner

> Load tested the booking engine with k6: 5,000 concurrent hold attempts on a 100-seat show
> gave **exactly 100 successes (DB-verified, zero overselling, zero deadlocks)**. At 10,000
> concurrent connections it served ~1,300 req/s, peaking at ~390 completed bookings/s on a
> 10-connection Postgres pool, and shed overload as bounded 503 + Retry-After with zero 500s.

---

## Earlier attempts (methodology issues, kept for the record)

### Run 1 (both tests): registration inside the measured iteration

`contention-run1.txt`, `throughput-run1.txt`. Each iteration registered a fresh attendee,
then reserved.
- **Test A run 1:** 4752 of 5000 register calls were **refused at TCP accept** in the first
  1.5 s (the Windows listen backlog). Each refused iteration failed in about 12 ms, which
  burned the shared iteration budget in 6 s. Only 237 holds were attempted: 87 got 201 and
  150 got 409 `SEATS_UNAVAILABLE`. The DB agreed (87 = 87 = 87, no double holds). 87 is
  normal for 237 random picks over 100 seats (expected 90.8 ± 2.5). The test was correct,
  but it never reached its intended contention.
- **Test B run 1:** 188,847 of 192,654 registrations returned 503. Registration runs argon2
  (about 67 ms, about 46/s on 4 libuv threads) **inside** `withTransaction`, holding a
  pooled connection, so the pool became an argon2 queue. Reservations were starved too:
  977 holds, p50 5.25 s on the pool timeout. This measured password hashing, not booking.
  It is logged in `docs/todo.md`.
- **Lesson:** keep setup cost out of the measured path, and retry refused connects.

### Test B run 2, first attempt: harness defect (discarded)

`throughput-run2-harness-defect.*`. The first pre-registered run retried refused connects
every 10–50 ms. Up to about 8,400 VUs the API was healthy (about 1,100 req/s, 0 refusals).
Then the event loop stalled for more than 10 s: Postgres **killed 20 connections for
idle-in-transaction timeout**, the accept queue overflowed, and the tight retry loop turned
that into a **16,000/s reconnect storm** (1.78 M retries, and 497 MB of k6 warnings piped
through the runner). That kept the shared machine saturated, and the API served almost
nothing for 60 s. 43 holds committed whose responses k6 never received (60 s timeouts and
interrupted iterations). DB integrity still held: no double holds, and invariants were 0
rows. Fixes: exponential backoff, a 30 s request timeout with 40 s ramp-down grace,
unknown-outcome accounting, warning suppression, and the event-loop probe. The clean
rerun is the run 2 above.
- **Lesson:** a retry policy is part of the load, and an aggressive one can manufacture
  the collapse it's meant to work around.
