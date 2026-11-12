# FlashSeat

**FlashSeat: a concurrency-safe event ticketing platform. Pick your exact seat; it can never be sold twice.**

A full-stack ticketing app (React + Express + PostgreSQL) built around one guarantee: however
many people try to book the same seat at the same moment, exactly one of them gets it. Seats
are held for 10 minutes while the buyer pays with Razorpay, and the database itself rejects
any state that would mean selling a seat twice.

<p align="center">
  <img src="docs/screenshots/seat-hold.webp" alt="Selecting three seats on the live seat map, holding them, and the 10-minute hold countdown starting" width="900">
</p>

| Landing | Events | Event detail |
|---|---|---|
| [![Landing page hero](docs/screenshots/landing.webp)](docs/screenshots/landing.webp) | [![Events list with category and date filters](docs/screenshots/events.webp)](docs/screenshots/events.webp) | [![Event detail page with dates and prices](docs/screenshots/event-detail.webp)](docs/screenshots/event-detail.webp) |
| **Seat map** | **Tickets** | **Organizer overview** |
| [![Seat map with three seats selected](docs/screenshots/seat-map.webp)](docs/screenshots/seat-map.webp) | [![Confirmed booking with a QR-code ticket](docs/screenshots/tickets.webp)](docs/screenshots/tickets.webp) | [![Organizer dashboard with live sales stats](docs/screenshots/organizer-overview.webp)](docs/screenshots/organizer-overview.webp) |

<sub>Screenshots use the seeded demo data (`npm run demo:fresh`). Event photos: [web/public/images/CREDITS.md](web/public/images/CREDITS.md).</sub>

## Contents

- [Features](#features)
- [How it stays correct](#how-it-stays-correct)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Documentation](#documentation)
- [Roadmap and known limitations](#roadmap-and-known-limitations)

## Features

**For attendees**

- **Browse** upcoming events by city, category and date.
- **Live seat map**: a curved venue map showing every seat as available, taken or yours,
  refreshed while you look, with category prices and a view-from-seat preview.
- **10-minute holds**: holding seats (up to 6) reserves them for you while you pay, with a
  countdown. Nobody else can take them in that time; when it ends, they go back on sale.
- **Razorpay payments** (test mode): card, UPI or netbanking through Razorpay Checkout. A
  mock payment mode works with no Razorpay account.
- **Tickets with QR codes**: one ticket per seat, each with its own ticket code and QR code.
- **Add to calendar**: download an `.ics` file for the show.
- **My bookings**: upcoming, past, pending and cancelled bookings, including refund status.

**For organizers**

- **Venues and a seat builder**: lay out numbered rows and sections, or general admission,
  with a live preview.
- **Events and shows**: create an event as a draft, add shows at a venue, and set a price
  for each seat category.
- **Live sales stats**: seats sold, average fill and upcoming shows across all events.
- **Publish** an event when it has at least one show.
- **Cancel** an event: open holds and unpaid bookings close, and paid bookings are refunded
  automatically.

### Payments

| Razorpay Checkout | Payment confirmed |
|---|---|
| [![Razorpay Checkout in test mode showing the ₹1,198 order total and netbanking bank choices](docs/screenshots/razorpay-checkout.webp)](docs/screenshots/razorpay-checkout.webp) | [![Razorpay's Payment Successful screen for the ₹1,198 netbanking test payment](docs/screenshots/payment-success.webp)](docs/screenshots/payment-success.webp) |
| Razorpay Checkout in test mode. The amount comes from the server, never the browser. | After the server verifies the payment's HMAC signature, the booking is confirmed and tickets are issued. |

## How it stays correct

Many people opening the seat map the moment sales open and clicking the same seats is the
normal case, not an edge case. A naive "check the seat is free, then mark it taken" lets two
requests both see the seat as free. FlashSeat closes every gap:

- **Postgres is the single source of truth.** Holds, expiry times, idempotency keys,
  payments and tickets all live in Postgres, and every time decision uses the database clock
  ([clocks](docs/clocks.md)). Redis only does rate limiting, an admission gate and a
  2-second seat-map cache, and fails open: correctness never depends on it.
- **Row locks in a fixed order.** Every write locks rows in one global order (show,
  reservation, booking, payment, then seats by ascending id), so two buyers going for
  overlapping seats wait for each other instead of deadlocking
  ([lock order](docs/lock-order.md), [why `ORDER BY id`](docs/booking-flow.md#why-order-by-id-prevents-deadlock)).
- **Idempotency keys.** A hold request carries an `Idempotency-Key`; a retried request
  returns the same hold instead of creating a second one. Checkout, confirm and payment
  creation are idempotent by state ([replay rules](docs/booking-flow.md#idempotency-and-replay-rules)).
- **Lazy expiry plus a sweeper.** Every availability check treats an expired hold as free,
  so correctness never waits for cleanup. A separate sweeper process tidies expired rows
  with `SKIP LOCKED`, so it never blocks a buyer ([lazy expiry](docs/booking-flow.md#lazy-expiry-and-the-sweeper)).
- **Database constraints as the final safety net.** Check constraints, composite foreign
  keys, partial unique indexes and an exclusion constraint reject bad states even if
  application code is wrong. `uq_one_live_ticket_per_seat` allows **one live ticket per
  seat**, full stop ([data model](docs/data-model.md)).
- **Razorpay signature verification.** The checkout callback's HMAC-SHA256 signature is
  checked in constant time, the payment is fetched from Razorpay, and the amount must match
  the one stored in the database ([payments API](docs/api.md#payments-razorpay)).
- **Webhook idempotency.** Webhooks are verified against the raw body and recorded by
  Razorpay event id; a repeated event does nothing. The verify callback and the
  `payment.captured` webhook run the same locked step, so they produce one confirmation and
  one set of tickets.
- **Automatic refunds.** If a payment arrives after the hold has ended (or the event was
  cancelled), the booking becomes `REFUND_PENDING` and the refund worker refunds it in
  full, with retries and backoff. A payment can never be refunded twice
  ([paying with Razorpay](docs/booking-flow.md#paying-with-razorpay)).

**Load test** (k6, from [load/RESULTS.md](load/RESULTS.md)):

> Load tested the booking engine's seat-hold endpoint with k6: 5,000 concurrent hold attempts
> on a 100-seat show gave **exactly 100 successful holds (DB-verified, no seat held twice, zero
> deadlocks)**. At 10,000 concurrent connections it served ~1,300 req/s, peaking at ~390 hold
> requests/s fully processed by Postgres (successful holds + clean 409s) on a 10-connection
> Postgres pool, and shed overload as bounded 503 + Retry-After with zero 500s.

| Test | Load | Result |
|---|---|---|
| [Contention](load/RESULTS.md#test-a-correctness-under-maximum-contention) | 1,000 VUs, 5,000 hold attempts on one 100-seat show | **100 x 201**, 4,483 x 409 `SEATS_UNAVAILABLE`, 417 x 409 `ACTIVE_RESERVATION_EXISTS`, 0 lock timeouts, 0 5xx; DB: 100 ACTIVE reservations = 100 HELD seats |
| [Throughput](load/RESULTS.md#run-2-db_pool_max10-baseline) | ramp to 10,000 VUs on 200 shows x 50 seats | 159,645 requests (~1,330 req/s peak); 7,611 holds; 145,129 x 503 `DB_UNAVAILABLE`; 0 x 500 |

The runs measured the hold endpoint on one machine (k6, API and Postgres together); the
full methodology, the pool-size and Redis-gate experiments, and what the runs do not cover
are in [load/RESULTS.md](load/RESULTS.md).

## Architecture

```mermaid
flowchart LR
  U["Browser"] --> W["React SPA<br/>Vite dev server, /api proxy"]
  W -->|"REST /api/*"| A["Express 5 API<br/>auth, rate limits, admission gate"]
  A --> PG[("PostgreSQL 16<br/>single source of truth")]
  A -. "rate limits, admission gate,<br/>seat-map cache (fails open)" .-> R[("Redis 7")]
  SW["Sweeper process<br/>expiry sweep + refund worker"] --> PG
  U -->|"Razorpay Checkout<br/>(card / UPI / netbanking)"| RZ["Razorpay<br/>test mode"]
  A -->|"create order, fetch payment"| RZ
  W -->|"POST /payments/razorpay/verify"| A
  RZ -->|"POST /webhooks/razorpay"| A
  SW -->|"refunds"| RZ
  MIG["migrate<br/>one-shot container"] --> PG
```

- **API** (`src/`): a stateless Express process. Each module has routes, a controller (Zod
  validation), a service (business rules, transactions) and a repository (raw SQL).
- **Sweeper** (`src/workers/sweeper.ts`): a separate process that expires stale holds and
  unpaid bookings, then runs the payment jobs: refunds and webhook retries.
- **migrate**: a one-shot container that applies the SQL migrations; the API and sweeper
  start only after it succeeds.
- **Web** (`web/`): a React single-page app. In development, Vite proxies `/api/*` to the
  API, so no CORS is needed.

Booking and payment, end to end:

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as API
  participant P as Postgres
  participant R as Razorpay
  B->>A: POST /shows/S/reservations (Idempotency-Key K, seatIds)
  A->>P: BEGIN, replay if (user, K) exists
  A->>P: show FOR SHARE, seats ORDER BY id FOR UPDATE
  A->>P: all free? seats HELD until now() + 10 min, COMMIT
  A-->>B: 201 reservation (expiresAt), countdown starts
  B->>A: POST /reservations/R/checkout
  A->>P: lock show, reservation, booking, seats, INSERT booking
  A-->>B: 201 booking PENDING_PAYMENT
  B->>A: POST /bookings/BK/payments
  A->>P: checks under locks, COMMIT (no lock held during the call)
  A->>R: create order (amount from the DB)
  A->>P: INSERT payment CREATED (one open order per booking)
  A-->>B: keyId, orderId, amount
  B->>R: Razorpay Checkout (card / UPI / netbanking)
  R-->>B: payment_id, order_id, signature
  B->>A: POST /payments/razorpay/verify
  A->>A: HMAC-SHA256 signature check (constant time)
  A->>R: fetch payment: captured, amount matches?
  A->>P: lock show, reservation, booking, payment, seats
  alt hold still live
    A->>P: seats BOOKED, one ticket per seat, CONFIRMED, COMMIT
    A-->>B: 200 booking with tickets (QR codes)
  else hold ended or event cancelled
    A->>P: booking REFUND_PENDING + refunds row, COMMIT
    A-->>B: 409 PAYMENT_CAPTURED_SEATS_UNAVAILABLE
    Note over P,R: sweeper process refunds it (receipt = refund id, retried with backoff)
  end
  R->>A: webhook payment.captured (signed, event id deduplicated)
  A->>P: same captured step: already CONFIRMED, no-op
```

With `PAYMENT_PROVIDER=mock`, steps 9 to 25 are replaced by one call,
`POST /bookings/BK/confirm-mock`, which runs the same confirm step. More:
[architecture](docs/architecture.md), [booking flow](docs/booking-flow.md) (state diagrams
and race timelines).

## Tech stack

| Area | Technologies |
|---|---|
| Backend | Node.js 22, TypeScript, Express 5, Zod (env and request validation), argon2 (passwords), jsonwebtoken (HS256 access tokens), cookie-parser (refresh-token cookie), pino (JSON logs) |
| Frontend | React 19, Vite 8, React Router 8, TanStack Query 5, Tailwind CSS 4, lucide-react (icons), qrcode (ticket QR codes) |
| Data | PostgreSQL 16 via `pg` (raw SQL, no ORM), node-pg-migrate (plain `.sql` migrations), Redis 7 via ioredis |
| Payments | Razorpay (test mode): Orders and Payments REST API, Checkout, webhooks, refunds; a built-in mock provider |
| Testing | Vitest (integration tests against real Postgres and Redis, a fake Razorpay client), k6 (load tests), SQL invariant checks, a sweeper mutation test |
| Tooling | Docker and Docker Compose, tsx (dev server and scripts), dotenv |

## Getting started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine with Compose v2)
- Node.js 22 and npm
- Optional: a [Razorpay](https://razorpay.com) account in Test Mode, for real test payments

### 1. Clone

```sh
git clone https://github.com/SamriddhiAgrawal19/FlashSeat.git
cd FlashSeat
```

### 2. Create the env files

The containers read `.env.docker`; the host scripts (demo data, tests) read `.env`. Both
start from [.env.docker.example](.env.docker.example) and must share the same
`JWT_ACCESS_SECRET`. This snippet (bash, Git Bash or macOS/Linux shells) generates a secret
and creates both files:

```sh
cp .env.docker.example .env.docker
SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
sed -i.bak "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$SECRET|" .env.docker && rm .env.docker.bak
cp .env.docker .env
printf '\nDATABASE_URL=postgres://flashseat:flashseat@localhost:5432/flashseat\nREDIS_URL=redis://localhost:6379\n' >> .env
```

Or do it by hand: copy `.env.docker.example` to `.env.docker` and to `.env`, put the same
random 32+ character string in `JWT_ACCESS_SECRET` in both, and add the two `DATABASE_URL`
and `REDIS_URL` lines above to `.env`. Both files are gitignored.

[.env.example](.env.example) is the **production** template (mock payment off, strict
rate limits); don't use it for local development. Every variable is documented in
[docs/operations.md](docs/operations.md#environment-variables).

**Payments.** `.env.docker.example` sets `PAYMENT_PROVIDER=mock`, which needs no Razorpay
keys: the pay page shows a "test mode" card form (nothing is sent anywhere), and **Pay**
confirms the booking. To use Razorpay test
mode, set `PAYMENT_PROVIDER=razorpay` and the three `RAZORPAY_*` values (Test Mode keys,
`rzp_test_...`) in `.env.docker`, then run `docker compose up -d` again so the API and
sweeper pick them up. Webhooks need a public HTTPS URL (for example a cloudflared or ngrok
tunnel); see [Payments (Razorpay, test mode)](docs/operations.md#payments-razorpay-test-mode).

### 3. Start the backend

```sh
npm install                  # host dependencies for the demo and test scripts
docker compose up -d --build # Postgres, Redis, migrations, API, sweeper
curl http://localhost:3000/health   # {"status":"ok"}
```

`docker compose ps -a` should show `migrate` exited with code 0 and `api` healthy.

### 4. Load the demo data

```sh
npm run demo:fresh
```

> **Warning:** `demo:fresh` **deletes all data** in the local Docker database and the
> app's Redis keys, then seeds demo data through the public API (takes a few minutes). It
> refuses to run unless the targets are the local compose `postgres` and `redis`
> containers and `NODE_ENV` is not `production`.

It creates 3 organizers, 6 venues in 5 cities, 16 events across six categories (one draft,
one cancelled, two with sales opening later) and about 560 bookings. All names are fictional.

### 5. Start the web app

```sh
cd web
npm install
npm run dev
```

Open http://localhost:5173 (Vite picks the next free port if 5173 is taken). If the API is
not on `http://localhost:3000`, copy [web/.env.example](web/.env.example) to
`web/.env.local` and set `VITE_API_PROXY_TARGET`.

### Demo accounts

Every demo account uses the **local-only** default password `LocalDemoOnly#2026` (set
`DEMO_PASSWORD` in `.env` before seeding to choose another; the seed prints it at the end).

| Account | Role | What to look at |
|---|---|---|
| `demo-meera@flashseat.test` | Organizer (Saptak Sound Collective) | dashboard with a cancelled event and its refunds |
| `demo-kabir@flashseat.test` | Organizer (Chaupal Theatre Company) | dashboard with a draft event |
| `demo-nikhil@flashseat.test` | Organizer (Lehar Fest Committee) | general-admission ground, arena |
| `demo-asha@flashseat.test` | Attendee | confirmed tickets and a refund-pending booking |
| `demo-rahul@flashseat.test` | Attendee | confirmed tickets, a pending payment and an active hold |
| `demo-guest-01@flashseat.test` … `demo-guest-20@flashseat.test` | Attendee | volume buyers |

Rahul's hold and pending payment expire after 10 minutes; run `npm run demo:fresh` again to
get them back.

### Paying in Razorpay test mode

With `PAYMENT_PROVIDER=razorpay` and Test Mode keys, no real money moves. Use the test
details from Razorpay's official docs:

- **Cards:** [Test card details](https://razorpay.com/docs/payments/payments/test-card-details/)
- **UPI:** [Test UPI details](https://razorpay.com/docs/payments/payments/test-upi-details/)
  (`success@razorpay` for a successful payment, `failure@razorpay` for a failed one)
- **Netbanking:** pick any bank; test mode opens Razorpay's test bank page, where you choose
  success or failure.

To see the automatic refund, let a hold run out while the Razorpay window is open, then
pay: the booking turns `REFUND_PENDING` and the sweeper process refunds it.

### Deploying

One Linux server running `docker-compose.prod.yml` behind Caddy with automatic HTTPS:
follow [docs/deploy-aws.md](docs/deploy-aws.md) (AWS EC2, ap-south-1).

### API docs

The API runs at http://localhost:3000 (the web app reaches it through `/api`). Every
endpoint, its errors, and a curl walkthrough of the whole booking flow are in
[docs/api.md](docs/api.md).

## Testing

The tests are integration tests: they call the running API and use real Postgres and real
Redis, with no mocks except a fake Razorpay client. With the Docker stack up and `.env`
created as above:

```sh
npm run test:docker           # whole suite: stops the sweeper container, runs Vitest, restarts it
npm run test:docker -- tests/payments.test.ts   # one file
npm run db:check-invariants   # SQL invariants on the live database: healthy means 0 rows each
```

**Current result: 137 tests in 14 files, all passing** (`npm run test:docker`, 2026-11-12,
about 5 minutes; files run one at a time because they share one API and database).

| Suite | Covers |
|---|---|
| `concurrency.test.ts` | 20 users on one seat; reversed seat sets (`[A,B,C]` vs `[C,B,A]`); parallel identical holds, checkouts and confirms; event cancel racing every writer |
| `idempotency-race.test.ts` | 20 concurrent identical holds give one hold and 19 replays; a second key on the same show is refused |
| `booking-lifecycle.test.ts` | confirm after cancel or after the show started, cancel cleanup, replays of dead holds |
| `payments.test.ts` | Razorpay orders (amount from the DB, idempotent), signature checks, verify and webhook replays, verify racing the webhook, late payments refunded, refunds on event cancel, refund retries and backoff |
| `sweeper.test.ts` | expiry, takeover by a new holder, batching, concurrent sweeps, sweeps racing the API |
| `robustness.test.ts` | lock timeouts, killed database connections, register races, overlapping shows, all SQL invariants at rest |
| `rate-limit.test.ts` | every rate limiter, Redis outage (fails open), admission gate, seat-map cache |
| `trust-proxy.test.ts` | `X-Forwarded-For` honoured only with `TRUST_PROXY`, production refresh cookie (`Path=/api/auth`, `Secure`) |
| `auth.test.ts`, `auth-me.test.ts` | refresh-token rotation and reuse detection, database-clock expiry, forged JWTs, login timing, `/auth/me` |
| `api-consistency.test.ts` | 404 for other users' resources, uuid validation, route scoping, bulk seat limits |
| `events-list.test.ts`, `events-seat-counts.test.ts`, `organizer-reads.test.ts` | event listing filters and seat counts, organizer dashboard reads and ownership |

Beyond the suites: `npm run verify:sweeper` is a mutation test (it deletes one condition
from the sweeper's SQL and checks the tests catch it), and `npm run smoke:concurrency` /
`npm run smoke:checkout` race requests on a fresh show. The suite adds its own users and
events to the local database; run `npm run demo:fresh` afterwards for clean demo data.
Details, including why a standalone sweeper must not run during the tests:
[docs/testing.md](docs/testing.md).

## Project structure

```text
.
├── src/                    Express API (TypeScript)
│   ├── app.ts              Express app, route mounting, /health
│   ├── server.ts           HTTP server, graceful shutdown
│   ├── config/             Zod-validated environment
│   ├── db/                 pg pool with timeouts, withTransaction()
│   ├── middleware/         auth, rate limits, admission gate, error mapper
│   ├── modules/            auth, venues, events, shows, show-seats, reservations,
│   │                       bookings, payments (Razorpay), sweeper
│   ├── redis/              ioredis client, fail-open wrapper
│   ├── utils/              error classes, Zod helpers, lifecycle flag
│   └── workers/            sweeper + payment-jobs process
├── web/                    React single-page app
│   ├── src/                pages, components, lib (API client, booking, calendar export)
│   ├── public/             event photos (with credits), favicon
│   └── vite.config.ts      dev server and /api proxy
├── migrations/             SQL migrations: accounts and venues, booking engine, payments
├── tests/                  Vitest integration suites, fakes/ (Razorpay), helpers
├── scripts/                demo reset/seed, test-docker runner, invariant SQL, smoke and regression scripts
├── load/                   k6 scripts, load seeding, runner, RESULTS.md, raw results
├── docs/                   deep dives, reviews, design references, screenshots
├── deploy/                 Caddyfile and Dockerfile.web (production edge: web app + /api proxy)
├── Dockerfile              one image for api, sweeper and migrate
├── docker-compose.yml      local dev: postgres, redis, migrate, api, sweeper
└── docker-compose.prod.yml one-server production: the same plus caddy (docs/deploy-aws.md)
```

## Documentation

| Document | What it covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | components, process model, request lifecycle, failure behaviour |
| [docs/booking-flow.md](docs/booking-flow.md) | hold, checkout, confirm, Razorpay payment, release, cancel; state diagrams; races; idempotency |
| [docs/data-model.md](docs/data-model.md) | ER diagram, every table and constraint, and the bug each prevents |
| [docs/api.md](docs/api.md) | every endpoint, error codes, curl walkthrough |
| [docs/lock-order.md](docs/lock-order.md) | the global lock hierarchy and the sweeper's locks |
| [docs/clocks.md](docs/clocks.md) | which decisions use the database clock and which the app clock |
| [docs/deploy-aws.md](docs/deploy-aws.md) | production on one EC2 server: Docker Compose behind Caddy (automatic HTTPS), secrets, backups, updates |
| [docs/operations.md](docs/operations.md) | env vars, Docker services, Razorpay setup, logs, shutdown, troubleshooting |
| [docs/testing.md](docs/testing.md) | test architecture, suites, regression scripts, mutation testing |
| [docs/todo.md](docs/todo.md) | deferred items |
| [docs/review/phase2-review.md](docs/review/phase2-review.md) | code review of the booking engine (findings since fixed) |
| [docs/review/test-findings.md](docs/review/test-findings.md) | bugs tracked by tests, and the script-to-suite map |
| [load/RESULTS.md](load/RESULTS.md) | load-test results and methodology |

**Design references** (static HTML mockups the web app was built from; open them in a
browser): [landing](docs/landing-v2-design.html), [log in and sign up](docs/auth-page-design.html),
[events](docs/events-page-design.html), [event detail](docs/event-detail-design.html),
[booking flow](docs/booking-flow-design.html), [organizer dashboard](docs/organizer-dashboard-design.html).

## Roadmap and known limitations

From [docs/todo.md](docs/todo.md) and the load tests:

- **Password hashing inside the transaction.** Register and login run argon2 while holding a
  database connection, so a sign-up burst can starve other requests of connections.
- **Tests share the dev database.** There is no separate test database or `.env.test`, so
  the suite depends on local config and leaves test data next to the demo data.
- **My bookings filters on the client.** `GET /bookings/mine` has no server-side tab filter,
  so with many bookings a tab can look incomplete.
- **Seat layouts are saved group by group.** A multi-section layout is several calls; a
  failure midway leaves a partial layout. An all-or-nothing endpoint is planned.
- **Mixed field casing** (snake_case and camelCase) in API requests and responses.
- **Scaling is untested beyond one API process.** At 10,000 concurrent requests the single
  Node event loop is the bottleneck; horizontal scaling is not measured yet.
- **No admin flows or check-in yet**: the `ADMIN` role exists only in the schema, and QR
  codes are not scanned by anything in the app.
