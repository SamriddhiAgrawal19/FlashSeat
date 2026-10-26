# FlashSeat Global Database Lock Hierarchy

To prevent deadlocks across concurrent transactions in the booking engine, all operations that acquire row-level locks on core transactional entities MUST acquire them in this strict, non-negotiable global hierarchy:

1. **`events` row** (`FOR UPDATE` for mutations, `FOR SHARE` for read-then-create checks)
2. **venue show-creation advisory lock** (only `createShow`; see below)
3. **`shows` row** (`FOR SHARE` on booking paths, `FOR UPDATE` in `cancelEvent`; `ORDER BY id ASC` when locking several)
4. **`reservations` row** (`FOR UPDATE`; `ORDER BY id ASC` when locking several)
5. **`bookings` row** (`FOR UPDATE`; `ORDER BY id ASC` when locking several)
6. **`show_seats` rows** (`ORDER BY id ASC FOR UPDATE`)

## Auth lock order (`refresh_tokens`)

Refresh-token rotation locks the **token row first** (`lookupRefreshTokenForUpdate`,
`FOR UPDATE` on the presented token), then, only on reuse detection, the user's **other
tokens ordered by id** (`revokeAllRefreshTokensForUser` locks in `ORDER BY id` so
concurrent containment runs cannot deadlock). Auth code never touches booking tables,
so it is independent of the booking hierarchy above.

## Venue show-creation advisory lock

`createShow` takes a per-venue, transaction-scoped advisory lock
(`SELECT pg_advisory_xact_lock(hashtext(<venueId>))`) right after the event row lock and
before inserting the show. Only `createShow` takes it; never take it while holding show,
reservation, booking or seat locks. It serializes concurrent show creation per venue so
the `no_venue_overlap` exclusion-constraint check cannot deadlock (observed as `40P01`
under parallel overlapping `createShow` calls).

## Principles
- **No Inverted Ordering**: never lock a lower level before a higher one — no `show_seats` before `reservations`/`bookings`, no `bookings` before `reservations`, no `reservations` before `shows`, no `shows` before `events`.
- **Plain read first, then lock at the top**: checkout, confirm and release only know a reservation/booking id. They first do a plain (non-locking) `SELECT` of `show_id` (with the owner check — someone else's resource is 404), then lock the show row before anything below it. `release` does not require the show to be bookable; it takes the show lock only to respect the hierarchy.
- **Consistent Tie-Breaking**: when locking multiple rows at one level, rows are ALWAYS locked in ascending ID order (`ORDER BY id … FOR UPDATE`).
- **Shared Locks**: booking paths hold the show row `FOR SHARE`, which conflicts only with `cancelEvent`'s `FOR UPDATE` — sales serialize against cancellation and against each other never. Show metadata inspection that does not write uses `FOR SHARE` too.
- **Single-Transaction Boundary**: create-reservation, checkout, release, confirm and cancelEvent execute entirely within one `withTransaction` block adhering to this sequence.

## Writers and where they stop

| Operation | Locks taken, in order |
|-----------|----------------------|
| `createReservation` | show (`FOR SHARE`) → own stale reservations → new reservation row → `show_seats` (id asc) |
| `checkout` | show (`FOR SHARE`) → reservation → booking → `show_seats` (id asc) |
| `confirmBookingCore` | show (`FOR SHARE`) → reservation → booking → `show_seats` (id asc) |
| `releaseReservation` | show (`FOR SHARE`) → reservation → booking → `show_seats` (id asc) |
| `cancelEvent` | event (`FOR UPDATE`) → shows (id asc) → reservations (id asc) → bookings (id asc) → `show_seats` (id asc) |
| `createShow` | event (`FOR SHARE`) → inserts `shows` / `show_category_prices` / `show_seats` |
| `publishEvent` / `updateEvent` | event (`FOR UPDATE`) |

## Sweeper

The background sweeper (`src/workers/sweeper.ts` loop, `src/workers/sweeper-once.ts`
one-shot) cleans up expired state in small per-show transactions. One cycle is
`runSweepOnce()` → `sweepOnceInternal()` in `src/modules/sweeper/sweeper.service.ts`;
the SQL lives in `src/modules/sweeper/sweeper.repository.ts`. Each show's transaction
follows the global hierarchy (levels 3 → 6; it never takes event locks or the
venue advisory lock):

| Step | Repository function | Lock |
|------|---------------------|------|
| 1 | `lockShowShareSkipLocked` | `shows` row (`FOR SHARE SKIP LOCKED`) |
| 2 | `lockExpiredReservations` | `reservations` rows: ACTIVE past `expires_at`, plus already-EXPIRED ones that still own a `PENDING_PAYMENT` booking ("stranded"), in one pass (`ORDER BY id LIMIT $batch FOR UPDATE SKIP LOCKED`) |
| 3 | `lockPendingBookings` | `bookings` rows of those reservations (`ORDER BY id FOR UPDATE` — no SKIP LOCKED; see below) |
| 4 | `lockExpiredHeldSeats` | `show_seats` rows (`ORDER BY id LIMIT $batch FOR UPDATE SKIP LOCKED`) |

Then `expireReservations`, `expireBookings` and `freeSeats` update only the rows
locked above, each re-checking its expiry condition against `now()`. Candidate
shows are found first by `findShowsWithExpiredState`, a plain read outside any
transaction that takes no locks: shows with an expired ACTIVE reservation, an
expired HELD seat, or a stranded booking.

**Stranded bookings**: when a user holds again on a show, the API lazily marks
their stale reservation EXPIRED (`expireStaleActiveReservations`) without touching
its booking, so a checked-out booking can be left `PENDING_PAYMENT` under an
EXPIRED reservation (reads already report it as EXPIRED). Locking that reservation
in the same ascending-id pass as the expired ACTIVE ones gives
`lockPendingBookings` its parent lock, and the booking is marked EXPIRED.

**Why SKIP LOCKED on show, reservation and seat locks**: the sweeper must never
block an API request. If a row is already locked by a booking/checkout/release
transaction, the sweeper simply skips it and picks it up on the next cycle.
Correctness does not depend on the sweeper — lazy expiry in the API handles
every case. A show whose row cannot be locked (e.g. `cancelEvent` holds it
`FOR UPDATE`) is counted in `skippedShows` and excluded for the rest of that
cycle, so it cannot burn the cycle's time budget.

**Why no SKIP LOCKED on bookings**: once the sweeper holds the parent reservation
locks (`FOR UPDATE`) and the show row (`FOR SHARE`), the booking rows are
uncontested. checkout, confirm and release lock the reservation before its
booking, so they queue on the sweeper's reservation lock. `cancelEvent` is the one
path that locks bookings without their reservations (every `PENDING_PAYMENT` /
`CONFIRMED` booking of the event, stranded ones included), but it locks the show
`FOR UPDATE` first, which conflicts with the sweeper's `FOR SHARE`: it either waits
for the sweeper's transaction, or already holds the show and the sweeper skips it.

**Why skipping never causes a lock cycle**: SKIP LOCKED means the sweeper never
*waits* on a lock. A deadlock requires a cycle of waits. Since the sweeper holds
locks only in the strict hierarchy order and skips anything it cannot acquire
immediately, it can never form the second half of a wait cycle.

**Several sweepers at once**: `runSweepOnce()` has an in-process guard so one
process's timer never overlaps itself. Separate sweeper processes are kept apart
only by SKIP LOCKED: each row is locked, and therefore updated and counted, by
exactly one of them.
