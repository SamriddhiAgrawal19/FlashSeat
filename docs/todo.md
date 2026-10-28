# FlashSeat — TODO

Deferred items found during review and testing. Each entry says where it came from
and why it was not fixed at the time.

## Performance

### Hash passwords before acquiring a DB connection (register)

- **Found in:** Phase 2 Step 7 load testing, baseline run 1 (`load/RESULTS.md`, 2026-10-27).
- **Where:** `src/modules/auth/auth.controller.ts` `register` wraps
  `authService.register` in `withTransaction`; `src/modules/auth/auth.service.ts`
  `register` calls `hashPassword` (argon2) *inside* that transaction.
- **Problem:** argon2 takes ~67 ms per hash and runs on the libuv threadpool (4 threads
  by default, ~46 hashes/s ceiling on the test machine). For the whole hash, the
  request holds one of the `DB_POOL_MAX` (10) pooled connections, idle in an open
  transaction. Under a sign-up burst the pool turns into an argon2 queue: every other
  request (reservations included) waits behind it and gets 503 `DB_UNAVAILABLE` after
  `DB_CONNECTION_TIMEOUT_MS`. Test B run 1: 188,847 register 503s, 24.6 successful
  registrations/s, and reservations starved to 6.3/s.
- **Fix options:**
  1. Hash in the controller/service *before* `withTransaction`, so the connection is
     only held for the email check + inserts (keep the `users_email_key` 23505
     handling for the race, which is already there).
  2. Or split register into "hash outside, short transaction inside" in the service.
  Either way the duplicate-email pre-check moves after hashing or runs twice; the
  unique-constraint path already covers the race, so correctness does not depend on it.
- **Related, also deferred:** `login` runs `verifyPassword` (argon2) inside
  `withTransaction` the same way; consider `UV_THREADPOOL_SIZE` sizing once hashing
  no longer pins connections.
- **Not fixed because:** out of scope for the load-testing step (no `src/` changes).
