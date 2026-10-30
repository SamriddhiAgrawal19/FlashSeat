# FlashSeat

- **Exactly 100 of 5,000 concurrent holds succeeded on a 100-seat show.** The result was
  DB-verified, with zero deadlocks and zero 5xx ([load test results](load/RESULTS.md)).
- **80 integration tests** run against real Postgres and Redis, with no mocks, plus a
  mutation test that checks the sweeper tests catch injected bugs.
- **Overload fails safe:** bounded 503 + `Retry-After`, and zero 500s across every load run.
- **One-command Docker stack:** Postgres, Redis, migrations, API and sweeper.

FlashSeat is a ticket-booking REST API (Node 22, Express 5, TypeScript, PostgreSQL 16,
Redis 7) for events with numbered or general-admission seats. Its core guarantee is that **a
seat is never sold twice, however many users try to book it at the same moment**. Holds are
taken with row locks inside one Postgres transaction, and database constraints reject any
state that would mean double-selling.

## Contents

- [The problem](#the-problem)
- [Architecture](#architecture)
- [How a booking works](#how-a-booking-works)
- [Key design decisions](#key-design-decisions)
- [Tech stack](#tech-stack)
- [Quickstart with Docker](#quickstart-with-docker)
- [Running the API on the host](#running-the-api-on-the-host)
- [Testing](#testing)
- [Load testing](#load-testing)
- [API overview](#api-overview)
- [Project structure](#project-structure)
- [Configuration](#configuration)
- [Known limitations and roadmap](#known-limitations-and-roadmap)
- [Documentation](#documentation)

## The problem

Ticket sales for a popular show are a burst: many users open the seat map when sales open
and pick from the same few seats in the same second. A naive "check the seat is free, then
mark it taken" flow lets two requests both see the seat as free and both sell it. Holds also
have to expire if the buyer walks away, and clients retry on timeouts. A retried "hold these
seats" or "confirm payment" must not create a second hold or a second set of tickets. All of
this has to stay correct with several API instances whose clocks don't agree exactly, and
under overload the API should turn requests away cleanly instead of hanging.

## Architecture

```mermaid
flowchart LR
  C["Client"] --> MW["Express middleware<br/>auth, rate limit, admission gate"]
  MW --> MOD["Modules<br/>auth, venues, events, shows,<br/>show-seats, reservations, bookings"]
  MOD --> PG[("PostgreSQL 16<br/>source of truth")]
  MOD --> EH["Error mapper<br/>pg errors to HTTP codes"]
  MW -. "advisory, fails open" .-> R[("Redis 7")]
  MOD -. "seat-map cache" .-> R
  SW["Sweeper worker<br/>separate process"] --> PG
  MIG["migrate<br/>one-shot container"] --> PG
```

- **API** (`src/server.ts`, `src/app.ts`): a stateless Express process. Each module has
  routes, a controller (Zod validation), a service (business rules, transactions) and a
  repository (raw SQL). Every multi-statement write runs inside one `withTransaction` call
  (`src/db/pool.ts`).
- **PostgreSQL** is the source of truth for everything: holds, expiry, idempotency keys and
  tickets. Constraints are the final guard against double-selling (see
  [docs/data-model.md](docs/data-model.md)).
- **Redis** is advisory and fails open. It backs rate limiting, the admission gate and a 2 s
  seat-map cache. If Redis is down or slow, requests go through as if the feature were off
  (`src/redis/client.ts` `withRedisFallback`). Correctness never depends on it.
- **Sweeper** (`src/workers/sweeper.ts`): a separate process that periodically marks expired
  reservations and bookings `EXPIRED` and frees their seats. It uses `SKIP LOCKED` so it
  never blocks an API request. The API never depends on it for correctness (see
  [lazy expiry](docs/booking-flow.md#lazy-expiry-and-the-sweeper)).
- **migrate**: a one-shot compose service that runs `node-pg-migrate up` and exits. `api`
  and `sweeper` start only after it exits 0.
- **Error mapper** (`src/middleware/errorHandler.ts`): turns Zod errors, application errors
  and Postgres SQLSTATEs into one response shape, `{ "error": { "message", "code" } }`.

Details: [docs/architecture.md](docs/architecture.md).

## How a booking works

Hold, then checkout, then confirm. Each step is one transaction, and each locks rows in the
same global order: show, then reservation, then booking, then seats by ascending id.

```mermaid
sequenceDiagram
  participant C as Client
  participant A as API
  participant P as Postgres
  C->>A: POST /shows/S/reservations (Idempotency-Key K, seatIds)
  A->>P: BEGIN, find reservation by (user, K)
  Note over A,P: key found -> replay 200, or 409/422, stop here
  A->>P: show FOR SHARE, bookable? (DB clock)
  A->>P: expire own stale holds, INSERT reservation
  A->>P: seats ORDER BY id FOR UPDATE, all free?
  A->>P: seats HELD until now()+600s, COMMIT
  A-->>C: 201 reservation (expiresAt)
  C->>A: POST /reservations/R/checkout
  A->>P: BEGIN, show FOR SHARE, reservation and booking FOR UPDATE
  Note over A,P: booking exists -> replay 200, no second booking
  A->>P: seats FOR UPDATE, still held by R? INSERT booking, COMMIT
  A-->>C: 201 booking PENDING_PAYMENT (payBefore)
  C->>A: POST /bookings/B/confirm-mock
  A->>P: BEGIN, show FOR SHARE, reservation and booking FOR UPDATE
  Note over A,P: already CONFIRMED -> replay 200
  A->>P: seats FOR UPDATE, BOOKED, INSERT tickets, CONFIRMED, COMMIT
  A-->>C: 200 booking with a ticketCode per seat
```

Step by step, with race timelines and state diagrams: [docs/booking-flow.md](docs/booking-flow.md).

## Key design decisions

| Decision | Why | Trade-off |
|---|---|---|
| Raw SQL (`pg`), no ORM | Locking is explicit and reviewable: every `FOR UPDATE`, `FOR SHARE`, `SKIP LOCKED` and `ORDER BY id` is visible in the query that takes it. ORMs express the Postgres features the guarantees rest on poorly: the exclusion constraint, partial unique indexes, composite FKs, `ON CONFLICT` on a named index. And the project was built to learn SQL and transactions directly. | More SQL to write and review; no generated types or migrations from models. |
| DB constraints as the final guard | `chk_show_seat_hold`, `chk_show_seat_booked`, composite FKs, `uq_one_active_reservation`, `uq_one_live_ticket_per_seat` and the `no_venue_overlap` exclusion constraint reject bad states even if application code is wrong. | Constraint violations have to be mapped to HTTP codes per constraint (`23505` with `err.constraint` checks). |
| Row locks in ascending id order | Two transactions that lock overlapping seat sets always take them in the same order, so they wait on each other instead of deadlocking. | Every multi-row lock needs `ORDER BY id`; a missing one is a latent deadlock. |
| Global lock hierarchy | events, then the venue advisory lock, shows, reservations, bookings, show_seats ([docs/lock-order.md](docs/lock-order.md)). Paths that only know a reservation or booking id do a plain read for `show_id` first, then lock from the top. | One extra read per checkout, confirm and release; the rule has to be kept by hand. |
| Hold, then confirm | A hold (`HELD` + `held_until`) reserves seats for `HOLD_DURATION_SECONDS` (600) while the user pays; confirm turns them `BOOKED`. | Seats are unavailable to others during an abandoned hold until it expires. |
| Lazy expiry plus a sweeper | Every availability check treats `HELD` with `held_until < now()` as free, so correctness never waits for cleanup. The sweeper only tidies rows. | Rows can read as `HELD`/`ACTIVE` in the table after they are logically expired; reads compute an effective status. |
| DB clock, not server clock | All expiry and "has the show started" decisions use Postgres `now()`, so several API instances agree ([docs/clocks.md](docs/clocks.md)). | Access-token `exp` is still checked on the app clock (stateless JWTs), so API hosts need NTP. |
| Idempotency keys on hold | `Idempotency-Key` header, unique per `(user_id, idempotency_key)`; a retry returns the same reservation. Checkout and confirm are idempotent by state: one booking per reservation, and confirming a `CONFIRMED` booking replays it. | Replays only work while the hold is live; a dead hold needs a new key. |
| Tickets created only on confirm | `booking_seats` rows (one `ticket_code` per seat) are inserted in the confirm transaction, never at checkout, so an unpaid booking holds no tickets. | Checkout and confirm each re-verify the seat hold. |
| 404 instead of 403 for others' resources | Someone else's venue, event, reservation or booking returns 404, so ids cannot be probed for existence. A wrong role still gets 403. | Clients can't tell "not yours" from "doesn't exist". |
| Refresh-token rotation with reuse detection | Refresh tokens are random, stored as SHA-256 hashes, rotated on every use under `FOR UPDATE`. Presenting a revoked token revokes all of that user's tokens. | A stolen-cookie replay logs the real user out too (by design). |
| Redis fails open | Redis only protects capacity, so an outage must not take bookings down: commands time out after 2 s or are rejected at once while disconnected, and the request proceeds. | During a Redis outage there is no rate limiting or admission gate. |
| Fixed-window rate limiting | `INCR` + `EXPIRE NX` in one pipeline: atomic, one round trip, enough to blunt brute-force login, signup floods and hold griefing. | Up to 2x the limit in a short span across a window edge. |
| Admission gate on booking writes | Caps in-flight hold, checkout and confirm requests at `MAX_INFLIGHT_BOOKING_REQUESTS` (150), using a Redis sorted set updated by one Lua script. Excess requests get an immediate 503 `SERVICE_BUSY` instead of waiting 5 s for a pool connection. | Did not raise overall goodput at 10,000 concurrent requests on one Node process (see [Load testing](#load-testing)). |

## Tech stack

- **Node.js 22 + TypeScript**: one language for API, worker, tests and scripts. The image is
  `node:22-slim` because argon2's prebuilt binaries are glibc-only.
- **Express 5**: HTTP routing and middleware.
- **PostgreSQL 16 via `pg`**: row locks, partial unique indexes, an exclusion constraint and
  a shared clock carry the correctness guarantees. Migrations are plain `.sql` files run by
  **node-pg-migrate**.
- **Redis 7 via ioredis**: counters and sets shared by all API instances, for rate limiting,
  admission control and the seat-map cache.
- **Zod**: validates env vars at startup and every request body, query, path and header.
- **argon2** for passwords, **jsonwebtoken** for HS256 access tokens (algorithm pinned),
  **pino** for JSON logs.
- **Vitest** integration tests, **k6** load tests, **Docker Compose** for the whole stack.

## Quickstart with Docker

**Prerequisites:** Docker Desktop (Compose v2). For tests and load tests, also Node 22 on
the host.

1. Create the container env file (gitignored) and fill in its one placeholder,
   `JWT_ACCESS_SECRET` (at least 32 characters; to run the tests, use the same value as in
   your host `.env`):

   ```sh
   cp .env.docker.example .env.docker
   ```

2. Build and start Postgres, Redis, migrations, API and sweeper:

   ```sh
   docker compose up --build -d
   ```

3. Check it. `migrate` should have exited 0, `api` should be healthy:

   ```sh
   docker compose ps -a
   curl http://localhost:3000/health     # {"status":"ok"}
   ```

4. Stop, or reset all data:

   ```sh
   docker compose down      # stop and remove containers, keep data
   docker compose down -v   # also delete the Postgres and Redis volumes
   ```

A full happy path with curl (organizer creates a venue, event and show; an attendee holds,
checks out and confirms) is in [docs/api.md](docs/api.md#curl-walkthrough).

## Running the API on the host

Stop the `api` and `sweeper` containers (`docker compose stop api sweeper`), then run
`npm run dev` (API with `tsx watch`) and, if wanted, `npm run sweeper` against the compose
Postgres and Redis. The host `.env` is `.env.docker.example` plus
`DATABASE_URL=postgres://flashseat:flashseat@localhost:5432/flashseat` and
`REDIS_URL=redis://localhost:6379`. Don't start from `.env.example`: that production template
disables mock payment and keeps the strict register limit.

## Testing

Tests are integration tests against the running API, real Postgres and real Redis, with no
mocks. Files run one at a time. Details: [docs/testing.md](docs/testing.md).

| File | Tests | Covers |
|---|---|---|
| `tests/api-consistency.test.ts` | 14 | 404 for foreign resources, uuid validation, nested show route scoping, bulk seat limits |
| `tests/auth.test.ts` | 23 | refresh rotation races, theft containment, DB-clock expiry, error shape, login timing, JWT forgery |
| `tests/booking-lifecycle.test.ts` | 8 | confirm after cancel, cancelEvent cleanup, replay of dead holds, uuid case |
| `tests/concurrency.test.ts` | 7 | 20 users on one seat, reversed seat sets, idempotent races, cancel racing every writer |
| `tests/idempotency-race.test.ts` | 2 | 20 identical concurrent holds, second key for the same show |
| `tests/rate-limit.test.ts` | 8 | each rate limiter, Redis outage fail-open, admission gate, lost-release recovery, seat-map cache |
| `tests/robustness.test.ts` | 7 | lock timeouts, killed backends, register race, overlapping shows, 9 invariants |
| `tests/sweeper.test.ts` | 11 | expiry, takeover, batching, concurrent sweeps, races with the API, stranded bookings |
| **Total** | **80** | |

Run the suite against the Docker stack:

```sh
npm install
npm run test:docker
```

`test:docker` stops the `sweeper` container, runs `npm test`, then starts the sweeper again
even if tests fail. A full run takes about 4–5 minutes (80/80, last verified 2026-10-30).
**Never run a standalone sweeper while the tests run**: the sweeper tests call
`runSweepOnce()` themselves, and an external sweeper steals their expired rows (seen as
`sweeper.test.ts` E failing with `expected 9 to be 25`).

Regression scripts run against the live API:

- `node scripts/verify-batch1.mjs`, `verify-batch2.mjs`, `verify-batch3.mjs`: lifecycle,
  robustness and auth fixes.
- `SHOW_ID=<uuid> node scripts/smoke-concurrency.mjs` and `smoke-checkout.mjs`: races on a
  fresh show.
- `npm run db:check-invariants`: 9 SQL invariants; healthy means 0 rows each.

`npm run verify:sweeper` is a **mutation test**: it deletes one condition from the sweeper's
SQL, runs the sweeper tests, checks that they fail, then restores the file byte for byte.
Details and last results: [docs/testing.md](docs/testing.md).

## Load testing

k6 against one API process (`DB_POOL_MAX=10`) and Postgres 16 in Docker, all on one Windows 11
machine (Core Ultra 9 185H), measuring only `POST /shows/:showId/reservations`. Last run 2026-10-28.

| Test | Load | Result |
|---|---|---|
| Contention ([Test A run 2](load/RESULTS.md#test-a-correctness-under-maximum-contention)) | 1,000 VUs, 5,000 hold attempts on one 100-seat show | **100 x 201**, 4,900 x 409, 0 lock timeouts, 0 5xx; 517 attempts/s; p50 1.84 s, p99 1.97 s; DB: 100 holds, 100 HELD seats |
| Throughput ([Test B run 2](load/RESULTS.md#run-2-db_pool_max10-baseline)) | ramp to 10,000 VUs on 200 shows x 50 seats | 159,645 requests (~1,330 req/s peak); 7,611 holds; peak goodput ~390 completed holds+409s/s; 145,129 x 503 `DB_UNAVAILABLE`; **0 x 500**; p50 6.16 s, p99 11.29 s |

- **No overselling in any run.** No seat was ever in two live reservations, and every DB
  count reconciled with what k6 saw.
- **Overload fails safe.** The pool saturates at about 1,000–3,000 concurrent requests. Past
  that, the API answers with bounded 503 + `Retry-After` near the 5 s pool timeout instead of
  hanging.
- **Goodput collapses at 10,000 concurrent requests**, because rejecting ~1,300 doomed
  requests/s lags the single Node event loop.
- **Neither a bigger pool nor the Redis admission gate fixed that.** Pool 50 was worse than
  pool 10 on every throughput and latency number. The gate moved rejection from a 5 s pool
  wait to an immediate Redis check but did not raise goodput. At this concurrency the event
  loop, not the database, is the bottleneck.

[load/RESULTS.md](load/RESULTS.md) has the pool-50 run, the Redis-gate run, the full
methodology, and the measurement mistakes that were made and corrected along the way. To
re-run (needs [k6](https://k6.io); tokens expire after 15 minutes, so register right before
running; re-seed after `docker compose down -v`):

```sh
npm run load:seed:contention && npm run load:register:contention && npm run load:contention
npm run load:seed:throughput && npm run load:register:throughput && npm run load:throughput
```

## API overview

Auth: `Bearer` access token in `Authorization`; the refresh token is an `httpOnly` cookie
scoped to `/auth`. Full reference: [docs/api.md](docs/api.md).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | none | create attendee or organizer, returns access token + refresh cookie |
| POST | `/auth/login` | none | log in |
| POST | `/auth/refresh` | refresh cookie | rotate refresh token, new access token |
| POST | `/auth/logout` | refresh cookie | revoke refresh token |
| POST | `/venues` | ORGANIZER | create venue |
| POST | `/venues/:venueId/seats/bulk` | ORGANIZER (owner) | add seats (GRID or GENERAL_ADMISSION) |
| GET | `/venues/mine` | ORGANIZER | list own venues |
| GET | `/events` | none | search published events |
| GET | `/events/mine` | ORGANIZER | list own events |
| POST | `/events` | ORGANIZER | create DRAFT event |
| GET | `/events/:eventId` | none | event with its shows (DRAFT is 404) |
| PATCH | `/events/:eventId` | ORGANIZER (owner) | edit event |
| POST | `/events/:eventId/publish` | ORGANIZER (owner) | DRAFT to PUBLISHED (needs at least one show) |
| POST | `/events/:eventId/cancel` | ORGANIZER (owner) | cancel event, shows, holds and pending bookings |
| POST | `/events/:eventId/shows` | ORGANIZER (owner) | create show, generate its seats |
| GET | `/events/:eventId/shows/:showId` | none | show details and prices |
| GET | `/shows/:showId/seats` | none | seat map (cached up to 2 s) |
| POST | `/shows/:showId/reservations` | user | hold seats (`Idempotency-Key` required) |
| GET | `/reservations/:reservationId` | user (owner) | read hold |
| DELETE | `/reservations/:reservationId` | user (owner) | release hold |
| POST | `/reservations/:reservationId/checkout` | user (owner) | create PENDING_PAYMENT booking |
| POST | `/bookings/:bookingId/confirm-mock` | user (owner) | mock payment: confirm and issue tickets |
| GET | `/bookings/mine` | user | list own bookings |
| GET | `/bookings/:bookingId` | user (owner) | read booking |
| GET | `/health` | none | DB ping; 503 while shutting down |

## Project structure

```text
.
├── src/
│   ├── server.ts           HTTP server, graceful shutdown
│   ├── app.ts              Express app, route mounting, /health
│   ├── config/env.ts       Zod-validated environment (all settings and defaults)
│   ├── db/pool.ts          pg pool with timeouts, withTransaction()
│   ├── redis/client.ts     ioredis client, withRedisFallback() (fail-open)
│   ├── middleware/         auth, rateLimit, admissionControl, errorHandler
│   ├── modules/
│   │   ├── auth/           register, login, refresh rotation, JWT, argon2
│   │   ├── venues/         venues and bulk seat layouts
│   │   ├── events/         events, publish, cancelEvent
│   │   ├── shows/          show creation (advisory lock, seat generation)
│   │   ├── show-seats/     seat map (+ Redis cache)
│   │   ├── reservations/   hold, read, release
│   │   ├── bookings/       checkout, confirm, booking reads
│   │   └── sweeper/        expiry cleanup SQL and orchestration
│   ├── workers/            sweeper loop, one-shot sweeper
│   └── utils/              AppError classes, uuid schema, lifecycle flag
├── migrations/             two SQL migrations (accounts/venues/events, then the booking engine)
├── tests/                  Vitest integration suites, helpers, setup
├── scripts/                regression and smoke scripts, invariant SQL, test-docker runner
├── load/                   k6 scripts, seeding, runner, RESULTS.md
├── docs/                   design and operations documentation
├── Dockerfile              one image for api, sweeper and migrate
└── docker-compose.yml      postgres, redis, migrate, api, sweeper
```

## Configuration

All settings are validated by Zod in `src/config/env.ts`; the process exits at startup if
any is invalid. Templates: `.env.example` (production-style, placeholders for secrets) and
`.env.docker.example` (local Docker and test stack). Full table: [docs/operations.md](docs/operations.md#environment-variables).

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required | Postgres connection string |
| `JWT_ACCESS_SECRET` | required | HS256 secret, at least 32 characters |
| `JWT_ACCESS_EXPIRY` | required | access token lifetime (templates: `15m`) |
| `REFRESH_TOKEN_EXPIRY_DAYS` | required | refresh token lifetime in days (templates: 7) |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `HOLD_DURATION_SECONDS` | 600 | how long a hold lasts |
| `DB_POOL_MAX` | 10 | pg pool size (per process) |
| `DB_CONNECTION_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` | 5000 / 5000 | pool checkout wait / statement limit |
| `DB_LOCK_TIMEOUT_MS` | 1000 | row-lock wait before 409 `LOCK_TIMEOUT` |
| `ENABLE_MOCK_PAYMENT` | false | enables `confirm-mock`; refused when `NODE_ENV=production` |
| `ENABLE_RATE_LIMITING` | true | rate limiters on/off |
| `RATE_LIMIT_REGISTER_IP_LIMIT` | 30 | registrations per IP per 60 s (the local test `.env` uses 400) |
| `MAX_INFLIGHT_BOOKING_REQUESTS` | 150 | admission gate cap |
| `ENABLE_SEAT_MAP_CACHE` / `SEAT_MAP_CACHE_TTL_MS` | true / 2000 | seat-map cache |

## Known limitations and roadmap

- **Real payments (not built).** Only mock confirm exists. `confirmBookingCore` is
  written for a future payment webhook; there are no payments, refunds or webhook tables.
- **Refund worker (not built).** `cancelEvent` marks CONFIRMED bookings `REFUND_PENDING` and
  leaves their seats BOOKED; `REFUNDED` and `PAYMENT_FAILED` are defined but unused.
- **Not built either:** no frontend, no admin flows (the `ADMIN` role and organizer approval
  exist in the schema only), no check-in, no `BLOCKED` seat management.
- **From [docs/todo.md](docs/todo.md):** register and login run argon2 (~67 ms) inside the DB
  transaction, so a sign-up burst turns the pool into an argon2 queue. There is also no
  dedicated `start:test` / `.env.test` config, so tests depend on the local `.env`.
- **From the load tests:** one Node process is the ceiling at 10,000 concurrent requests;
  horizontal scaling and a reverse-proxy limiter are untested.

## Documentation

- [docs/architecture.md](docs/architecture.md): components, process model, request lifecycle, failure behaviour
- [docs/booking-flow.md](docs/booking-flow.md): hold, checkout, confirm, release, cancel; state diagrams; races; idempotency
- [docs/data-model.md](docs/data-model.md): ER diagram, every table and constraint, and the bug each prevents
- [docs/api.md](docs/api.md): every endpoint and a curl walkthrough
- [docs/testing.md](docs/testing.md): test architecture, suites, regression scripts, mutation testing
- [docs/operations.md](docs/operations.md): env vars, Docker services, logs, shutdown, troubleshooting
- [docs/lock-order.md](docs/lock-order.md): the global lock hierarchy and the sweeper's locks
- [docs/clocks.md](docs/clocks.md): which decisions use the DB clock and which the app clock
- [docs/todo.md](docs/todo.md): deferred items
- [docs/review/phase2-review.md](docs/review/phase2-review.md): code review of the booking engine (findings since fixed)
- [docs/review/test-findings.md](docs/review/test-findings.md): bugs tracked by tests and the script-to-suite map
- [load/RESULTS.md](load/RESULTS.md): load-test results and methodology
