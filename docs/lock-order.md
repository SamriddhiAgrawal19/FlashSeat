# FlashSeat Global Database Lock Hierarchy

To prevent deadlocks across concurrent transactions in the booking engine, all operations that acquire row-level locks on core transactional entities MUST acquire them in this strict, non-negotiable global hierarchy:

1. **`reservations` row** (`FOR UPDATE`)
2. **`bookings` row** (`FOR UPDATE`)
3. **`show_seats` rows** (`ORDER BY id ASC FOR UPDATE`)

## Principles
- **No Inverted Ordering**: Never lock `show_seats` before `reservations` or `bookings`, and never lock `bookings` before `reservations`.
- **Consistent Tie-Breaking**: When locking multiple rows in `show_seats`, rows must ALWAYS be locked in ascending ID order (`ORDER BY ss.id FOR UPDATE`).
- **Shared Locks**: Show metadata inspection uses non-exclusive shared locks (`FOR SHARE OF s`), which do not conflict with concurrent seat locks.
- **Single-Transaction Boundary**: Checkouts, releases, and confirmations execute entirely within a single `withTransaction` block adhering to this sequence.
