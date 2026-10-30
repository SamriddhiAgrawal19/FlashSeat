# FlashSeat

Ticket booking API (Express + Postgres + Redis) built to never oversell under heavy concurrency.

## Run it

**Prerequisites:** Docker Desktop (Compose v2). For tests and load tests you also need
Node 22 on the host.

1. Create the container env file (gitignored) and fill in its placeholder:

   ```sh
   cp .env.docker.example .env.docker
   ```

   If you will run the tests, set `JWT_ACCESS_SECRET` in `.env.docker` to the same
   value as in your host `.env` (the tests sign their own JWTs with it).

2. Start everything (Postgres, Redis, migrations, API, sweeper):

   ```sh
   docker compose up --build
   ```

   `migrate` runs `node-pg-migrate up` once and exits 0; `api` and `sweeper` start only
   after it succeeds. Add `-d` to run in the background.

3. Check it:

   ```sh
   docker compose ps                     # api healthy, sweeper running, migrate exited (0)
   curl http://localhost:3000/health     # {"status":"ok"}
   ```

### Tests

Tests run on the host against the containerized API (`http://localhost:3000`) and the
published Postgres/Redis ports, and read the host `.env` (DB URL, JWT secret, limits).
On a fresh clone, create it from `.env.docker.example` (same dev/test values) plus
`DATABASE_URL=postgres://flashseat:flashseat@localhost:5432/flashseat` and
`REDIS_URL=redis://localhost:6379`. Don't start from `.env.example`: that is the
production template, and the suite needs mock payment and the loosened register limit.

```sh
npm install
npm run test:docker
```

`test:docker` stops the `sweeper` container, runs `npm test`, then starts the sweeper
again even if tests fail. Don't run plain `npm test` while the sweeper container (or a
host `npm run sweeper`) is running: the sweeper tests drive `runSweepOnce` themselves
and an external sweeper steals their expired rows.

### Load tests

Need [k6](https://k6.io) on the host. Seed fixtures, register users (tokens expire after
15 minutes, so register right before running), then run:

```sh
npm run load:seed:contention && npm run load:register:contention && npm run load:contention
npm run load:seed:throughput && npm run load:register:throughput && npm run load:throughput
```

Results and methodology: `load/RESULTS.md`. Fixtures in `load/fixtures/` point at rows in
the database, so re-seed after `docker compose down -v`.

### Stop

```sh
docker compose down      # stop and remove containers, keep data
docker compose down -v   # also delete the Postgres/Redis volumes
```

### Running on the host instead

`npm run dev` (API) and `npm run sweeper` still work against the compose Postgres/Redis,
using `.env` (localhost URLs). Stop the `api`/`sweeper` containers first
(`docker compose stop api sweeper`): the API needs port 3000, and two sweepers would race
the tests.
