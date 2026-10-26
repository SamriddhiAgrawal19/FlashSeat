# Test findings

Known bugs exposed by the test suite are tracked here with a test marked `it.fails`
(expected to fail against the current code). When the bug is fixed, the test starts
passing and vitest flags it so the `it.fails` marker can be removed.

**Open known bugs: none.** The suite has zero `it.fails` tests.

## Fixed (Batch 4)

| ID | Status | Tests (`tests/api-consistency.test.ts`) | Bug | Fix |
|----|--------|------------------------------------------|-----|-----|
| L-9 | **Fixed** (Batch 4) | "L-9: GET /events/:eventId/shows/:showId must 404 when the show belongs to another event"; "L-9: the right event id => 200 with the show; a non-existent event id => 404"; "L-9: visibility unchanged — DRAFT event => 404, CANCELLED event => 200" | The nested route `GET /events/:eventId/shows/:showId` ignored `:eventId` entirely (`getShowDetails` used only `showId`), so a show id could be read through any event id. | `shows.repository.ts findShowInEvent` requires `s.id = $1 AND s.event_id = $2`; `getShowDetails` returns 404 NOT_FOUND for a missing/foreign show, a non-existent event, or a DRAFT event (same rule as the seat map); CANCELLED stays readable. |
| M-5 | **Fixed** (Batch 4) | "M-5: bulk seat creation must reject oversized layouts with 400 VALIDATION_ERROR"; "M-5: 2001 seats in one call => 400 (GRID and GENERAL_ADMISSION); 2000 is accepted"; "M-5: duplicate row labels (exact or case-insensitive) => 400, nothing inserted"; "M-5: invalid row label, section or category => 400"; "M-5: row labels, section and category are trimmed/stored uppercase"; "M-5: same valid payload twice => 201 then 409 SEATS_ALREADY_EXIST, nothing extra inserted"; "M-5: filling a venue to MAX_SEATS_PER_VENUE => 409 VENUE_SEAT_LIMIT past the cap"; "M-5: 10 parallel identical bulk calls on a fresh venue => one 201, nine 409, zero 5xx"; "M-5: parallel bulk calls adding DIFFERENT seats cannot race past MAX_SEATS_PER_VENUE" | `insertBulkSeats` emitted 5 bind params per seat with no cap; >13,107 seats (65,535-param limit) surfaced as **503 DB_UNAVAILABLE**. Duplicate `rows` or a re-run of the same call returned generic 409 CONFLICT. | `venues.schema.ts`: `MAX_SEATS_PER_BULK_CALL` (2000) per call, `seatsPerRow` 1–500, row labels `/^[A-Za-z0-9]{1,4}$/` and unique case-insensitively, section/category trimmed 1–30 chars; all stored uppercase. `venues.service.ts`: venue row `FOR UPDATE` (serializes bulk calls), `MAX_SEATS_PER_VENUE` (20,000) → 409 VENUE_SEAT_LIMIT, unique-constraint 23505 → 409 SEATS_ALREADY_EXIST. |

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
