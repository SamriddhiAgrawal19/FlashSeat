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
