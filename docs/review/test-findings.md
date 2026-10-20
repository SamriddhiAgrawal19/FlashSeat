# Test findings

Known bugs exposed by the test suite. Each has a test marked `it.fails` (expected to
fail against the current code). When the bug is fixed, the test starts passing and
vitest flags it so the `it.fails` marker can be removed.

| ID | Test | Bug | Notes |
|----|------|-----|-------|
| L-9 | `tests/api-consistency.test.ts` — "L-9: GET /events/:eventId/shows/:showId must 404…" | The nested route `GET /events/:eventId/shows/:showId` ignores `:eventId` entirely (`shows.controller.ts` `getShowDetails` uses only `showId`), so a show id can be read through any event id. No data leak (the endpoint is public anyway) but clients that pre-filter by event are silently wrong. | Review finding L-9. Fix: verify `shows.event_id = :eventId` (404 otherwise) or expose `GET /shows/:showId`. |
| M-5 | `tests/api-consistency.test.ts` — "M-5: bulk seat creation must reject oversized layouts…" | `venues.repository.ts insertBulkSeats` emits 5 bind params per seat with no cap; >13,107 seats (65,535-param protocol limit) fails inside the driver/server and surfaces as **503 DB_UNAVAILABLE** (SQLSTATE class 08 is mapped as a connection error) instead of a clean client error. Duplicate `rows` entries or a re-run of the same bulk call return generic 409 CONFLICT instead of a validation error. | Review finding M-5 (partial: size cap + clearer duplicate semantics are missing; the 409 path at least no longer 500s). |

## Deliberately not tested here

- **M-6 rate limiting** — explicitly deferred (not part of Batch 3). When it lands,
  add tests for login backoff and reservation-creation throttling.
- **Postgres-log deadlock grep** (`verify-batch2` F) — needs `docker compose logs`;
  the suite instead asserts the observable contract (1×201 + 1×409, zero 5xx over 50
  overlapping `createShow` rounds) and the V-1 race suite asserts zero 5xx + zero
  invariant rows.
- **`verify-002.sql` / `check-invariants.sql` driver scripts** — the 9 invariants are
  asserted by the suite (`tests/helpers.ts INVARIANT_QUERIES`); the migration
  constraint self-test (`verify-002.sql`) stays a manual psql check.

## Scenarios that exist ONLY in the old scripts (not ported to the suite)

1. **Postgres-log `deadlock detected` grep** (verify-batch2 F tail) — needs
   `docker compose logs`; environment-specific. The suite asserts the observable
   contract instead (1×201 + 1×409 across 50 overlapping `createShow` rounds; the V-1
   race suite asserts zero 5xx + zero invariant rows).
2. **`scripts/verify-002.sql` migration-constraint self-test** (chk_show_seat_*,
   composite FKs, `uq_one_live_ticket_per_seat`, `uq_one_active_reservation`) — manual
   psql driver that fabricates invalid rows on purpose; kept as a DBA check.
3. **`scripts/backfill-show-seats.sql` idempotency runs** (test-phase2-step2 Test 7) —
   ops script behavior, not API behavior.
4. **Show-creation validation details** (test-phase2-step2 Tests 1/3/4/5 + Extra):
   exact `seatCount` echo, missing-category 400, unknown-category 400, zero-seat-venue
   400, duplicate-price-category validation.
5. **publish with zero shows → 409** (test2.js step 2) — event state machine detail not
   covered beyond the cancel/publish guards in `tests/booking-lifecycle.test.ts`.
6. **Console-only flows in `test.js`/`test2.js`** (login/refresh/logout prints,
   organizer RBAC spot checks, DRAFT 404 on public event details) — no assertions in
   the originals; the substance is covered by `tests/auth.test.ts` L-1 cases, but e.g.
   `GET /events/:id` for a DRAFT → 404 is not asserted anywhere in the suite.

Everything else from `verify-batch1.mjs` (A–F), `verify-batch2.mjs` (A–F incl. the
response-time budget of A), `verify-batch3.mjs` (A–H), `smoke-concurrency.mjs` (1–3)
and `smoke-checkout.mjs` (A–C) is ported (see the map below).

## Suite coverage map (old script scenario -> suite test)


| Old scenario | Suite |
|---|---|
| verify-batch1 A–E (H-1, M-2, M-1, M-8, H-2) | `tests/booking-lifecycle.test.ts` |
| verify-batch1 F (cancel races, invariants, deadlocks) | `tests/concurrency.test.ts` ("V-1 lock hierarchy under cancellation") |
| verify-batch2 A–E (H-3, M-7, L-8, hygiene, M-9 register race) | `tests/robustness.test.ts` |
| verify-batch2 F (L-5 overlapping createShow) | `tests/robustness.test.ts` |
| verify-batch3 A–H (H-4, M-3, L-1, L-3, L-4) | `tests/auth.test.ts` |
| smoke-concurrency 1–3 | `tests/concurrency.test.ts` ("smoke: contention and idempotent replay") |
| smoke-checkout A–C | `tests/concurrency.test.ts` ("smoke: checkout and confirmation races") |
