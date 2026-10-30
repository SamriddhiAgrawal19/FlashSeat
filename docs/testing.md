# Testing

## Test architecture

- **Integration only, no mocks.** Tests send real HTTP requests to a running API
  (`BASE_URL`, default `http://localhost:3000`) backed by real Postgres and Redis. The Redis
  outage test stops and starts the real `redis` container.
- **Direct DB access for setup and checks.** `tests/helpers.ts` opens its own `pg`
  connections (`DATABASE_URL` from the host `.env`) to move timestamps, hold row locks, kill
  API backends and run invariant queries. Tests sign their own JWTs with the host `.env`'s
  `JWT_ACCESS_SECRET`, so the API must use the same secret.
- **Files run serially** (`fileParallelism: false` in `vitest.config.ts`). All files share
  one API and one database, and some tests kill backends or hold row locks that would break a
  parallel file. Concurrency inside a test is intentional: many races fire dozens of requests
  at once with `Promise.all`.
- **Timeouts:** 120 s per test, 60 s per hook.
- **Per-file setup** (`tests/setup.ts`): wait up to 5 s for the shared Redis client to be
  ready, because it rejects commands while connecting (`enableOfflineQueue: false`). After
  each file, close the pool, delete the admission-gate set and disconnect Redis.
- **Own connection name.** Test processes connect as `flashseat-test`, so
  `terminateApiBackends()` (which kills `flashseat-api` backends) never kills the test's own
  connections.
- **Fresh data per test.** `setupShow(tag, seatCount)` registers an organizer and an attendee,
  creates a venue with `seatCount` seats, an event and a show 5 days ahead, publishes it and
  returns the seat ids. Emails carry a timestamp and a random suffix, so tests never collide
  and the database never needs resetting.

### Time shifting instead of sleeping

Expiry is evaluated with Postgres `now()`, so tests move the stored timestamps into the past
instead of waiting 600 s:

| Helper | Effect |
|---|---|
| `expireReservation(id)` | `expires_at` and its seats' `held_until` both into the past, in one statement (as the API would have written them) |
| `expireAllLiveHolds()` | the same for every live hold (sweeper tests, so no other test's hold expires mid-test) |
| `expireSeatHold(seatId)` | one seat's `held_until` into the past (lazy expiry, takeover) |
| `startShowNow(showId)` | the show's `starts_at` into the past ("show has started") |
| `expireRefreshToken(raw)` | a refresh token's `expires_at` into the past |

Other DB helpers:

- `holdRowLock(sql, seconds)` keeps a row lock in a background transaction while the test
  continues. It is used for lock-timeout tests and to keep admitted requests in flight in
  the admission-gate test.
- `terminateApiBackends()` kills the API's connections.
- `deactivateUser()` sets `is_active=false`.

### Invariant checks

`INVARIANT_QUERIES` in `tests/helpers.ts` ports the 9 queries of
`scripts/check-invariants.sql` (listed in [data-model.md](data-model.md#invariants-not-expressible-as-constraints)).
`invariantViolations()` returns the queries that found rows. The concurrency and sweeper
suites assert it is empty after race rounds, and `robustness.test.ts` asserts the whole
database satisfies all 9 at rest.

## Suites

80 tests in 8 files. The labels (H-1, M-5, L-9, V-1, ...) refer to findings in
[review/phase2-review.md](review/phase2-review.md); each test was written to reproduce a
finding and now guards its fix.

| File | Tests | Purpose |
|---|---|---|
| `api-consistency.test.ts` | 14 | someone else's resource is 404, malformed uuid is 400; nested show route respects `:eventId` (L-9); bulk seat limits, validation, duplicate handling and parallel calls (M-5) |
| `auth.test.ts` | 23 | 10 parallel refreshes give exactly one 200; reuse of a rotated token revokes everything (H-4); refresh expiry on the DB clock, plus a source scan for JS-clock expiry decisions (M-3); one error shape across 10 cases (L-1); login timing and deactivated users (L-3); forged JWTs `alg:none`, HS512, bad role, non-uuid id (L-4); cookie lifecycle |
| `booking-lifecycle.test.ts` | 8 | confirm after cancel or after show start is 409 (H-1); cancelEvent closes holds, pending and confirmed bookings (M-2); replay of an expired hold is 409 (M-1); checkout replay after release is 409, and dead bookings read EXPIRED (M-8); uuid case-insensitivity (H-2) |
| `concurrency.test.ts` | 7 | 30 rounds of cancel racing hold/checkout/confirm/release with zero 5xx and zero invariant rows (V-1); 20 users on one seat; `[A,B,C]` vs `[C,B,A]`; 10 identical holds; 10 parallel checkouts; 10 parallel confirms; confirm vs release |
| `idempotency-race.test.ts` | 2 | 20 concurrent identical holds give one 201 and nineteen 200 replays (10 runs); a second key on the same show is 409 `ACTIVE_RESERVATION_EXISTS` |
| `rate-limit.test.ts` | 8 | login-by-IP, login-by-email, register-by-IP, reservation-per-user limits; Redis stopped mid-test and requests still succeed; admission gate rejects beyond the cap and settles back to baseline; a lost release frees its slot after 10 s under continuous traffic; seat-map cache MISS, HIT, expiry |
| `robustness.test.ts` | 7 | a held row lock gives a fast 409 `LOCK_TIMEOUT` and `/health` stays up (H-3); killed idle backends don't crash the API (M-7); backend killed mid-checkout gives a mapped 503/409 (L-8); error bodies leak nothing; 10 parallel same-email registers give 1x201 + 9x409 (M-9); 50 rounds of overlapping `createShow` with zero 5xx (L-5); all 9 invariants at rest |
| `sweeper.test.ts` | 11 | expiry; takeover leaves the new holder alone; lazy leftovers; live and confirmed data never touched; batching; two concurrent sweeps; sweep racing API calls (30 rounds); cancelled shows; skip a locked show; stranded pending bookings |

The sweeper tests import `runSweepOnce()` from `src/` and run it in the test process, so they
need `DATABASE_URL` and do not use the sweeper container.

## Running the tests

```sh
npm install
npm run test:docker
```

`scripts/test-docker.mjs` stops the `sweeper` container, runs `npm test` (extra arguments are
passed through), starts the sweeper again even when tests fail, and exits with the test
result. A full run passes 80/80 in about 4–5 minutes (last verified 2026-10-30: 253 s).

**Never run a standalone sweeper during the tests.** The sweeper tests drive
`runSweepOnce()` themselves, and an external sweeper expires their rows first. It showed up
as `sweeper.test.ts` E failing with `expected 9 to be 25`: the external worker had expired 16
of the test's 25 holds. `test:docker` stops the container sweeper, but not a host
`npm run sweeper`. See [todo.md](todo.md).

One file, against the running stack (fine for any file except `sweeper.test.ts`, which also
needs the sweeper container stopped):

```sh
npx vitest run tests/rate-limit.test.ts
```

`tests/rate-limit.test.ts` alone takes about 90 s (it waits out real rate-limit windows and
the 10 s admission safety TTL); it passed 20 consecutive runs on 2026-10-30.

### What the tests need from the server

The host `.env` (read by the tests) and `.env.docker` (read by the containers) must agree on:

- `JWT_ACCESS_SECRET` (tests sign tokens)
- `ENABLE_MOCK_PAYMENT=true` (confirm-mock tests)
- `RATE_LIMIT_REGISTER_IP_LIMIT=400`: the suite registers about 300 users from one IP within
  one window; the production default is 30
- the rate-limit, admission, hold and lock-timeout values, which several tests read from
  `src/config/env.ts` to size their bursts

`ENABLE_RATE_LIMITING` and `ENABLE_SEAT_MAP_CACHE` are on for the whole suite. Tests that
read the seat map right after a write allow for the 2 s cache window, and the login-timing
test resets the login rate-limit counters before each sample.

## Regression scripts

These scripts predate the Vitest suite. Their scenarios are ported into it
([review/test-findings.md](review/test-findings.md#suite-coverage-map-old-script-scenario---suite-test)),
but they still run as standalone checks. Each prints PASS/FAIL per scenario and exits
non-zero on any failure. They talk to Postgres through
`docker compose exec -T postgres psql`; set `DOCKER_BIN` if `docker` is not on `PATH`.

| Command | Scenarios | Last result (2026-10-30, Docker stack) |
|---|---|---|
| `node scripts/verify-batch1.mjs` | A–F: confirm after cancel, cancel cleanup, replay of dead holds, checkout replay after release, uuid case, cancel races with invariants | A–F PASS |
| `node scripts/verify-batch2.mjs` | A–F: lock wait vs pool, killed idle backends, backend killed mid-checkout, error shape, register race, overlapping `createShow` | A–F PASS |
| `node scripts/verify-batch3.mjs` | A–H: refresh rotation race, theft containment, DB clock, error shape, login timing oracle, deactivated user, forged JWTs, cookie lifecycle | A–H PASS (E: 5 of 5 runs) |
| `SHOW_ID=<uuid> node scripts/smoke-concurrency.mjs` | 1–3: 20 users on one seat, `[A,B,C]` vs `[C,B,A]` x30, 10 identical idempotent holds; needs at least 3 free seats | 1–3 PASS |
| `SHOW_ID=<uuid> node scripts/smoke-checkout.mjs` | A–C: 10 parallel checkouts, 10 parallel confirms, confirm vs release x20; needs at least 25 free seats on a fresh show | A–C PASS |
| `npm run db:check-invariants` | the 9 invariants | 0 rows x9 |
| `npm run db:check-sweeper-invariants` | 3 sweeper invariants | 0 rows x3 |

`SHOW_ID` must be a published, bookable show with enough free seats. Two ways to get one:

- `setupShow(tag, 30)` from `tests/helpers.ts`;
- the curl walkthrough in [api.md](api.md#curl-walkthrough) with
  `"rows":["A","B","C"],"seatsPerRow":10`, which gives a 30-seat show. Run
  `smoke-checkout.mjs` first (it needs 25 free seats), then `smoke-concurrency.mjs` can use
  what is left.

### Login timing (verify-batch3 E, auth.test.ts L-3 E)

Both check that a failed login does not reveal whether the email is registered (review
finding L-3). Each takes 25 failed logins for registered emails and 25 for unknown emails,
and requires the smaller median response time to be at least 60% of the larger. The API
verifies an unknown email against a dummy argon2 hash with the same parameters as real
hashes (argon2id, m=65536, t=3, p=4), so both paths do the same work.

**Measurement design.** Both groups must be measured under the same conditions:

- Every user is registered before timing starts.
- Registered and unknown samples alternate, swapping which goes first on each pair.
- No rate-limit wait is inside a timed sample. The script waits out the login-ip window
  before starting the timer. The test resets the login rate-limit counters before each
  sample.

An earlier version timed each registered-email login right after that user's register call,
and all unknown-email logins afterwards. That made the registered group 30–55 ms slower
(medians 114.9/60.0, 86.4/55.2 and 105.2/59.8 ms) whether or not the email existed: a probe
that timed unknown-email logins right after a register got the same slowdown (67.8 ms), and
with interleaved samples the medians matched (51.7 vs 51.1 ms). It was a measurement
artefact, not a leak in the API.

Results after the fix (2026-10-30, Docker stack):

| Run | Script: registered / unknown | Test: registered / unknown |
|---|---|---|
| 1 | 63.6 / 58.7 ms, PASS | 52.9 / 54.9 ms, PASS |
| 2 | 56.9 / 53.3 ms, PASS | 50.3 / 51.9 ms, PASS |
| 3 | 51.0 / 52.5 ms, PASS | 51.3 / 51.2 ms, PASS |
| 4 | 55.8 / 55.9 ms, PASS | – |
| 5 | 57.4 / 55.9 ms, PASS | – |

## Mutation testing

A mutation test checks that the tests would actually catch a bug: it deliberately breaks the
code and expects the tests to fail. `npm run verify:sweeper` (`scripts/verify-sweeper.mjs`)
does this for the sweeper:

| Mutation in `src/modules/sweeper/sweeper.repository.ts` | Expected |
|---|---|
| M1: `lockExpiredHeldSeats` without `AND held_until <= now()` | tests B and D fail |
| M2: `lockExpiredReservations` without `AND expires_at <= now()` | tests B and D fail |
| M3: `lockExpiredReservations` without `SKIP LOCKED` (3 runs) | informational |
| M4: `freeSeats` without `AND held_until <= now()` | informational |
| M5: `lockExpiredReservations` without the stranded-booking branch | test J fails |

For each mutation it copies the file, applies the change, runs `tests/sweeper.test.ts`,
restores the file byte for byte from the copy and checks its sha256. Then it runs
`npm run sweeper:once` and the sweeper invariant check.

Run it with the sweeper container stopped (`docker compose stop sweeper`, then
`docker compose start sweeper` afterwards). It rewrites a file in `src/` while it runs, so
don't edit that file at the same time. Last result (2026-10-30, about 6 minutes):

| Mutation | Tests that failed | Verdict |
|---|---|---|
| M1 | B, D | PASS (caught as required) |
| M2 | B, D | PASS (caught as required) |
| M3 | none in 3 runs | INFO |
| M4 | none | INFO: `freeSeats` only receives ids that `lockExpiredHeldSeats` already filtered on `held_until <= now()` and locked, so its own check is defence in depth |
| M5 | J | PASS (caught as required) |

After every mutation the file was restored with a matching sha256, and the sweeper
invariants returned 0 rows x3.

## Adding a test

1. Put it in the file whose concern it belongs to, or add `tests/<area>.test.ts`. Any
   `tests/**/*.test.ts` file is picked up.
2. Build fresh data with `setupShow()` / `register()` and the request helpers (`hold`,
   `checkout`, `confirmMock`, `release`, `cancelEvent`, `api`). Never reuse rows from another
   test.
3. Use the time-shift helpers instead of `sleep` for anything involving expiry or show start.
4. For a race, fire the requests with `Promise.all`. Assert only 2xx and expected 409s (no
   5xx), then assert `invariantViolations()` is empty.
5. Assert on `status` and `error.code`, not messages.
6. If the test needs Redis directly, import `redis` from `src/redis/client.ts`.
   `tests/setup.ts` already waits for it to be ready.
7. Run it alone (`npx vitest run tests/<file>`), then the whole suite with
   `npm run test:docker`.
