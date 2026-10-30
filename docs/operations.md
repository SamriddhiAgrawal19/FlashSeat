# Operations

## Environment variables

Every variable is validated by Zod in `src/config/env.ts` when the process starts. If any is
missing or invalid, the process prints `Invalid environment variables:` with the details and
exits 1. `dotenv` loads `.env` from the working directory but never overrides variables that
are already set (compose's `env_file` and `environment` win).

Templates:

- `.env.example`: production-style values with `<PLACEHOLDER>`s for secrets. Start a deploy
  from this.
- `.env.docker.example`: the local Docker and test stack. Copy it to `.env.docker`
  (gitignored). It has no `DATABASE_URL` or `REDIS_URL`, because `docker-compose.yml` sets
  those to the service hostnames.

### Core

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `production` or `test`. `production` refuses `ENABLE_MOCK_PAYMENT=true` and sets the refresh cookie `Secure`. |
| `PORT` | 3000 | HTTP port |
| `DATABASE_URL` | required | Postgres URL |
| `REDIS_URL` | `redis://localhost:6379` | Redis URL |
| `JWT_ACCESS_SECRET` | required | HS256 secret, at least 32 characters. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `JWT_ACCESS_EXPIRY` | required | access-token lifetime in `jsonwebtoken` format (templates: `15m`) |
| `REFRESH_TOKEN_EXPIRY_DAYS` | required | refresh-token lifetime (templates: 7) |
| `ENABLE_MOCK_PAYMENT` | false | enables `POST /bookings/:id/confirm-mock`. Must be false in production (enforced). |
| `SHUTDOWN_TIMEOUT_MS` | 10000 | drain deadline on SIGTERM before a forced exit 1 |

### Booking limits

| Variable | Default | Meaning |
|---|---|---|
| `HOLD_DURATION_SECONDS` | 600 | hold length; also the pay-before window |
| `MAX_SEATS_PER_RESERVATION` | 6 | seats per hold |
| `MAX_SEATS_PER_BULK_CALL` | 2000 | seats per bulk seat call |
| `MAX_SEATS_PER_VENUE` | 20000 | seats per venue |

### Database

| Variable | Default | Meaning |
|---|---|---|
| `DB_POOL_MAX` | 10 | connections per process. Load tests found 50 worse than 10 (see the README). |
| `DB_CONNECTION_TIMEOUT_MS` | 5000 | wait for a pooled connection, then 503 `DB_UNAVAILABLE` |
| `DB_STATEMENT_TIMEOUT_MS` | 5000 | server-side `statement_timeout`, then 503 `DB_TIMEOUT` |
| `DB_LOCK_TIMEOUT_MS` | 1000 | server-side `lock_timeout`, then 409 `LOCK_TIMEOUT` |
| `DB_IDLE_IN_TX_TIMEOUT_MS` | 10000 | server-side `idle_in_transaction_session_timeout` |
| `DB_APPLICATION_NAME` | `flashseat-api` | `application_name` in `pg_stat_activity`. The sweeper forces `flashseat-sweeper`; tests use `flashseat-test`. |

### Sweeper

| Variable | Default | Meaning |
|---|---|---|
| `SWEEPER_INTERVAL_MS` | 15000 | delay between the end of one sweep and the start of the next |
| `SWEEPER_BATCH_SIZE` | 200 | rows per lock query |
| `SWEEPER_MAX_RUN_MS` | 10000 | time budget for one sweep cycle |

### Redis features

| Variable | Default | Meaning |
|---|---|---|
| `ENABLE_RATE_LIMITING` | true | switch all rate limiters off without a redeploy |
| `RATE_LIMIT_LOGIN_IP_LIMIT` / `_WINDOW_SECONDS` | 10 / 60 | logins per IP per window |
| `RATE_LIMIT_LOGIN_EMAIL_LIMIT` / `_WINDOW_SECONDS` | 5 / 60 | logins per target email per window |
| `RATE_LIMIT_REGISTER_IP_LIMIT` / `_WINDOW_SECONDS` | 30 / 60 | registrations per IP. The local test `.env` and `.env.docker.example` use 400; never in production. |
| `RATE_LIMIT_RESERVATION_USER_LIMIT` / `_WINDOW_SECONDS` | 20 / 60 | hold requests per user |
| `MAX_INFLIGHT_BOOKING_REQUESTS` | 150 | admission gate cap for hold, checkout and confirm across all instances |
| `INFLIGHT_SAFETY_TTL_SECONDS` | 10 | a gate entry that is never released drops out after this; must outlast any real request |
| `ENABLE_SEAT_MAP_CACHE` | true | seat-map cache on/off |
| `SEAT_MAP_CACHE_TTL_MS` | 2000 | seat-map cache lifetime |

Redis keys: `ratelimit:<name>:<ip|email|userId>` (names `login-ip`, `login-email`,
`register-ip`, `reservation-user`), `admission:inflight:booking:set`, and
`seatmap:<showId>`.

## Docker services

```sh
docker compose up --build -d    # build the image, start everything in the background
docker compose ps -a            # migrate: Exited (0); api: healthy; sweeper: Up
docker compose logs --tail 5 --no-color api sweeper
docker compose stop sweeper     # what test:docker does before the tests
docker compose start sweeper
docker compose down             # remove containers, keep volumes
docker compose down -v          # also delete pgdata and redisdata
```

| Service | Container | Ports | Notes |
|---|---|---|---|
| `postgres` | `flashseat_db` | 5432 | `postgres:16`, user/password/db `flashseat`, volume `pgdata`, `pg_isready` health check |
| `redis` | `flashseat_redis` | 6379 | `redis:7-alpine`, volume `redisdata`, `redis-cli ping` health check |
| `migrate` | `flashseat_migrate` | – | runs `npm run migrate:up` and exits; `restart: "no"` |
| `api` | `flashseat_api` | 3000 | `node dist/server.js`; health check `GET /health` every 10 s; `restart: unless-stopped`; `stop_grace_period: 15s` |
| `sweeper` | `flashseat_sweeper` | – | `node dist/workers/sweeper.js`; `restart: unless-stopped`; `stop_grace_period: 15s` |

The Postgres and Redis ports stay published, so host tools (tests, scripts, `psql`) reach
the same data.

The image (`Dockerfile`) is multi-stage on `node:22-slim`. The build stage compiles
TypeScript. The runtime stage holds production dependencies, `dist/` and `migrations/`, and
runs as the `node` user. It uses Debian slim rather than Alpine because argon2's prebuilt
binaries are glibc-only. Secrets are never baked into the image: `.dockerignore` excludes
`.env` and `.env.*`, and the env file is supplied at run time.

From a clean state (`down -v`, then `up --build -d`, base images cached), the stack comes up
in about 15 s: `/health` returns `{"status":"ok"}` and `migrate` exits 0 (last verified
2026-10-30).

Migrations: `npm run migrate:up` / `migrate:down` (node-pg-migrate, SQL files in
`migrations/`). `docker compose start sweeper` also re-runs `migrate`, which is harmless
because applied migrations are skipped.

## Logs

All processes log JSON lines to stdout with pino (`level` 30 info, 40 warn, 50 error,
60 fatal). The `name` field says which part of the code logged. Read them with
`docker compose logs <service>`.

| `name` | Message | Meaning |
|---|---|---|
| `server` | `Server is running on port 3000`, `Shutting down server...`, `HTTP server closed.`, `Database pool closed.`, `Redis connection closed.` | lifecycle |
| `error-handler` | `Mapped database error` (warn, with `code`, `constraint`, `detail`) | a pg error was mapped to 409/503/400 |
| `error-handler` | `Unhandled error occurred` (error) | a 500 |
| `db` | `Transaction failed, rolled back.` (error) | an unexpected error inside `withTransaction` (a 5xx `AppError`, a database error, a bug); the transaction was rolled back |
| `db` | `Transaction failed, rolled back.` (**debug**) | an expected 4xx `AppError` ended the transaction (`SEATS_UNAVAILABLE`, `INVALID_CREDENTIALS`, ...). Not shown at pino's default `info` level. |
| `db` | `Unexpected idle client error on the pool`, `Pooled client connection error` | a connection died; the process stays up |
| `admission-control` | `Admission gate rejected request: SERVICE_BUSY` (warn, with `count`, `limit`) | one line per 503 `SERVICE_BUSY` |
| `redis` | `Redis operation failed; using fallback` (warn), `Redis connection error` (warn) | fail-open in action |
| `auth` | `Refresh token reuse detected; revoked all of the user's tokens` (warn) | possible token theft |
| `bookings-service` | `CRITICAL INVARIANT VIOLATION: uq_one_live_ticket_per_seat collision` (error) | should never appear; every other guard failed |
| `sweeper-worker` | `Sweeper worker starting`, `Shutting down sweeper...`, `Sweeper shut down cleanly.` | lifecycle |
| `sweeper` | `Sweep completed` (with `shows`, `reservationsExpired`, `bookingsExpired`, `seatsFreed`, `skippedShows`, `errors`, `durationMs`) | one line per sweep that did work |

## Graceful shutdown

`docker compose stop api` sends SIGTERM. The API then:

1. returns 503 `SHUTTING_DOWN` from `/health`;
2. closes idle connections and stops accepting new ones;
3. lets in-flight requests finish;
4. ends the pg pool and Redis, and exits 0.

If draining takes longer than `SHUTDOWN_TIMEOUT_MS` (10 s), it force-closes and exits 1.
Compose waits 15 s (`stop_grace_period`) before SIGKILL. The sweeper waits for a running
sweep under the same deadline. In a check on 2026-10-30, `docker compose stop` took the API
607 ms and the sweeper 446 ms, both exiting 0. If Redis is already down, shutdown logs
`Error during Redis connection close` and still completes.

## The sweeper

`src/workers/sweeper.ts` runs `runSweepOnce()` on a `setTimeout` chain. Each cycle:

1. Finds shows with expired state using a plain read (expired ACTIVE reservations, expired
   HELD seats, or stranded PENDING_PAYMENT bookings).
2. Opens one short transaction per show, taking locks with `SKIP LOCKED`.
3. Marks expired reservations and bookings `EXPIRED` and frees expired seats.

It never blocks the API and is never required for correctness
([booking-flow.md](booking-flow.md#lazy-expiry-and-the-sweeper),
[lock-order.md](lock-order.md#sweeper)). Several sweepers can run at once.

Other ways to run it:

- `npm run sweeper:once` runs one sweep and prints the result.
- `npm run sweeper` runs the loop on the host with `tsx`.

## Rate limits and the admission gate

- Rate limits are fixed windows per key. A 429 carries `Retry-After` equal to the key's
  remaining TTL.
- The admission gate covers hold, checkout and confirm-mock only. A 503 `SERVICE_BUSY`
  carries `Retry-After: 1`.
- Both fail open when Redis is unavailable. Watch for `Redis operation failed` warnings:
  during an outage, neither protection applies.
- To turn rate limiting off: set `ENABLE_RATE_LIMITING=false` and restart.
- The admission gate has no off switch other than a very high
  `MAX_INFLIGHT_BOOKING_REQUESTS`.
- Inspect the gate:
  `docker compose exec -T redis redis-cli ZCARD admission:inflight:booking:set`
  (0 when idle).

## Common problems

**Port 3000 already in use.** The `api` container cannot publish 3000 while a host
`npm start` / `npm run dev` holds it. Find listeners with:

```sh
netstat -ano | grep -E "[:.]3000 .*LISTEN"
```

Docker's own port forwarders show up there too. On Windows with Docker Desktop, for
example, you may see `com.docker.backend` and `wslrelay` listening on 3000. Those belong to
the `api` container. Any other process is a host server: stop it, or stop the container
(`docker compose stop api`) if you want to run the API on the host.

**Sweeper tests fail with `expected 9 to be 25` (sweeper stealing rows).** Another sweeper
is running against the same database. Check connections by application:

```sh
docker compose exec -T postgres psql -U flashseat -d flashseat -c "SELECT application_name, count(*) FROM pg_stat_activity WHERE datname = 'flashseat' GROUP BY 1 ORDER BY 1"
```

Any `flashseat-sweeper` row during a test run is a problem. Use `npm run test:docker`
(stops the container sweeper) and stop any host `npm run sweeper`.

**Line endings.** `.gitattributes` sets `* text=auto eol=lf`: every text file is LF, in the
repository and in the working tree, on every OS, whatever `core.autocrlf` says. Git still
detects binaries (the gzipped load results) and leaves them alone. Editors on Windows must
keep LF when saving. If a file shows up as CRLF anyway (`git ls-files --eol` lists
`w/crlf`), re-check it out from a clean tree. Scripts that patch source text
(`verify-sweeper.mjs`) still detect and preserve each file's own line ending, so they keep
working on a tree checked out before the rule existed.

**`Invalid environment variables` and `ENABLE_MOCK_PAYMENT cannot be true in production` at
startup.** `env.ts` refuses mock payment when `NODE_ENV=production`. The Docker test stack
needs mock payment (tests and `smoke-checkout.mjs` confirm bookings), so `.env.docker.example`
uses `NODE_ENV=development`. A real deploy uses `.env.example`: `NODE_ENV=production` and
`ENABLE_MOCK_PAYMENT=false`.

**Tests get 401 `INVALID_TOKEN` everywhere.** The host `.env`'s `JWT_ACCESS_SECRET` differs
from `.env.docker`'s. Tests sign their own tokens; make the two match.

**Tests get 429 on register.** The server runs with the production register limit (30 per
60 s). The suite needs `RATE_LIMIT_REGISTER_IP_LIMIT=400` in `.env.docker` (and the host
`.env`).

**Load-test runner refuses to start.** `load/run.mjs` rejects a token file older than 10
minutes (access tokens live 15 minutes). Re-run the `load:register:*` script right before
the test.
