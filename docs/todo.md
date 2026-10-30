# FlashSeat — TODO

Deferred items found during review and testing. Each entry says where it came from
and why it was not fixed at the time.

## Performance

### Hash passwords before acquiring a DB connection (register)

- **Found in:** the first throughput load test, which registered users inside the measured loop ([load/RESULTS.md](../load/RESULTS.md#run-1-both-tests-registration-inside-the-measured-iteration), 2026-10-27).
- **Where:** `src/modules/auth/auth.controller.ts` `register` wraps
  `authService.register` in `withTransaction`; `src/modules/auth/auth.service.ts`
  `register` calls `hashPassword` (argon2) *inside* that transaction.
- **Problem:** argon2 takes ~67 ms per hash and runs on the libuv threadpool (4 threads
  by default, ~46 hashes/s ceiling on the test machine). For the whole hash, the
  request holds one of the `DB_POOL_MAX` (10) pooled connections, idle in an open
  transaction. Under a sign-up burst the pool turns into an argon2 queue: every other
  request (reservations included) waits behind it and gets 503 `DB_UNAVAILABLE` after
  `DB_CONNECTION_TIMEOUT_MS`. In that run: 188,847 register 503s, 24.6 successful
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
- **Not fixed because:** out of scope for the load-testing work (no `src/` changes).

## Testing

### Dedicated test server config (`start:test` + `.env.test`)

- **Found in:** the review of the rate-limiting change (2026-10-30), restoring the production
  `RATE_LIMIT_REGISTER_IP_LIMIT` default to 30/60s.
- **Problem:** the integration suite runs against whatever server is started from the
  local `.env`, so it only passes because that `.env` loosens limits (register-by-IP
  set to 400 since the suite registers ~300 users from one IP). Tests silently depend
  on a developer's local config, and a loosened value can leak into a deploy.
- **Fix:** add a `start:test` script that boots the API with an explicit `.env.test`
  (e.g. `dotenv -e .env.test -- tsx src/server.ts`, or `DOTENV_CONFIG_PATH`), holding
  every test-only override with a comment per value. Point vitest/`tests/helpers.ts`
  at that server, and make the local `.env` match `.env.example` limits.
- **Not fixed because:** out of scope for that change (config cleanup only).

### Never run a standalone sweeper during the test battery

- **Found in:** regression test runs (2026-10-30).
- **Problem:** never run a standalone sweeper (`npm run sweeper`) while running the
  test battery. The tests drive `runSweepOnce` themselves, and an external sweeper
  steals their expired rows. Seen as `sweeper.test.ts` E failing with
  `expected 9 to be 25`: the external worker expired 16 of the test's 25 holds before
  the test's own sweep ran.
- **Fix:** the `start:test` setup above should also make this impossible, e.g. a
  separate test database the dev sweeper never connects to, or a pre-flight check
  that fails the run if a `flashseat-sweeper` connection is present in
  `pg_stat_activity`.
- **Partly addressed (Docker setup):** `npm run test:docker` stops the `sweeper` container
  for the duration of `npm test`. It does not stop a host `npm run sweeper`.
- **Not fixed because:** a workflow rule until `start:test` exists.

## API consistency

### Mixed field casing in requests and responses

- **Found in:** documentation review (2026-10-30).
- **Problem:** field names mix snake_case and camelCase. Request bodies use
  `organization_name` (register) but `posterUrl`, `seatIds`, `startsAt`, `pricePaise`
  elsewhere. Responses that return raw rows (users, venues, events, shows) are snake_case
  (`owner_id`, `starts_at`), while reservation, booking and seat-map objects are camelCase
  (`expiresAt`, `totalPaise`). Documented as a known inconsistency in `docs/api.md`.
- **Fix:** pick one casing (camelCase, the newer endpoints) and map rows explicitly in the
  services. Accept both spellings of renamed request fields for one deprecation period.
- **Not fixed because:** changing field names breaks existing clients; needs a versioning
  decision first.
