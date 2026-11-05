/**
 * FlashSeat — wipe the LOCAL docker database's data and the app's Redis keys.
 *
 *   npm run db:reset-local -- --yes
 *
 * What it does:
 *   1. TRUNCATEs every application table in `public` in ONE statement with
 *      RESTART IDENTITY CASCADE. The node-pg-migrate bookkeeping table
 *      (`pgmigrations`) is never touched, so the schema stays migrated.
 *   2. Deletes the Redis keys the app uses (seat-map cache `seatmap:*`, rate
 *      limits `ratelimit:*`, admission gate `admission:*`) with SCAN + UNLINK.
 *      Never FLUSHALL / FLUSHDB.
 *
 * Safety: it refuses to run unless ALL of these hold:
 *   - NODE_ENV is not "production" (neither in the shell nor in .env);
 *   - DATABASE_URL (shell, else .env) points at localhost / 127.0.0.1 / postgres,
 *     and its database name equals the one in the .env file;
 *   - REDIS_URL points at localhost / 127.0.0.1 / redis;
 *   - the Postgres server it connects to IS the docker compose `postgres` service
 *     (same system_identifier and database as `docker compose exec postgres psql`),
 *     and the Redis server IS the compose `redis` service (same run_id);
 *   - the flag --yes is passed.
 * Without --yes it only prints what it would do.
 *
 * DOCKER_BIN overrides the docker binary, like the other project scripts.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { Redis } from 'ioredis';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';
const MIGRATIONS_TABLE = 'pgmigrations'; // node-pg-migrate's default; package.json scripts don't override it
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', 'postgres']);
const LOCAL_REDIS_HOSTS = new Set(['localhost', '127.0.0.1', 'redis']);
// From src/: show-seats.controller.ts (seatmap:<showId>), middleware/rateLimit.ts
// (ratelimit:<name>:<key>), middleware/admissionControl.ts (admission:inflight:booking:set,
// and the older plain-counter key admission:inflight:booking).
const REDIS_PREFIXES = ['seatmap:', 'ratelimit:', 'admission:'];

const yes = process.argv.slice(2).includes('--yes');

function refuse(msg) {
  console.error(`\n[db:reset-local] REFUSING TO RUN: ${msg}\n`);
  process.exit(1);
}

function dbNameOf(url) {
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

// ---------------------------------------------------------------- env checks
const envPath = join(ROOT, '.env');
if (!existsSync(envPath)) refuse(`no .env file at ${envPath}; the local database name comes from it.`);
const fileEnv = dotenv.parse(readFileSync(envPath));

const nodeEnvs = [process.env.NODE_ENV, fileEnv.NODE_ENV].filter(Boolean).map((v) => v.trim().toLowerCase());
if (nodeEnvs.includes('production')) refuse('NODE_ENV is "production".');

if (!fileEnv.DATABASE_URL) refuse('.env has no DATABASE_URL.');
let fileDbUrl, dbUrl, redisUrl;
try {
  fileDbUrl = new URL(fileEnv.DATABASE_URL);
  dbUrl = new URL(process.env.DATABASE_URL || fileEnv.DATABASE_URL);
  redisUrl = new URL(process.env.REDIS_URL || fileEnv.REDIS_URL || 'redis://localhost:6379');
} catch {
  refuse('DATABASE_URL or REDIS_URL is not a valid URL.');
}
if (!LOCAL_DB_HOSTS.has(fileDbUrl.hostname)) refuse(`.env DATABASE_URL host "${fileDbUrl.hostname}" is not a local docker host.`);
if (!LOCAL_DB_HOSTS.has(dbUrl.hostname)) refuse(`database host "${dbUrl.hostname}" is not one of ${[...LOCAL_DB_HOSTS].join(', ')}.`);
const localDbName = dbNameOf(fileDbUrl);
const dbName = dbNameOf(dbUrl);
if (!localDbName) refuse('.env DATABASE_URL has no database name.');
if (dbName !== localDbName) refuse(`database "${dbName}" is not the local database "${localDbName}" from .env.`);
if (!LOCAL_REDIS_HOSTS.has(redisUrl.hostname)) refuse(`Redis host "${redisUrl.hostname}" is not one of ${[...LOCAL_REDIS_HOSTS].join(', ')}.`);
const dbUser = decodeURIComponent(dbUrl.username || 'postgres');

// ---------------------------------------------------------------- plan
const where = `postgres://${dbUser}@${dbUrl.hostname}:${dbUrl.port || 5432}/${dbName}`;
const redisWhere = `redis://${redisUrl.hostname}:${redisUrl.port || 6379}`;
console.log('[db:reset-local] This will PERMANENTLY DELETE all data in the local database:');
console.log(`  database : ${where}  (docker compose service "postgres")`);
console.log(`  action   : TRUNCATE every table in schema public except ${MIGRATIONS_TABLE}, RESTART IDENTITY CASCADE`);
console.log(`  redis    : ${redisWhere}  (docker compose service "redis")`);
console.log(`  action   : delete keys ${REDIS_PREFIXES.map((p) => p + '*').join(', ')} (no FLUSHALL)`);
if (!yes) {
  console.log('\n[db:reset-local] Dry run. Pass --yes to actually do it:  npm run db:reset-local -- --yes');
  process.exit(1);
}

// ---------------------------------------------------------------- docker identity
function dockerExec(service, args) {
  const r = spawnSync(DOCKER_BIN, ['compose', 'exec', '-T', service, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    refuse(`could not run a command in the docker compose "${service}" service (is the stack up?)\n${r.stderr || r.error || ''}`);
  }
  return r.stdout.trim();
}

const dockerDb = dockerExec('postgres', [
  'psql', '-U', dbUser, '-d', dbName, '-Atc',
  "select system_identifier || '|' || current_database() from pg_control_system()",
]);
const dockerRedisRunId = (dockerExec('redis', ['redis-cli', 'INFO', 'server']).match(/run_id:(\w+)/) || [])[1];
if (!dockerRedisRunId) refuse('could not read the docker Redis run_id.');

const client = new pg.Client({ connectionString: dbUrl.toString(), application_name: 'flashseat-reset-local' });
await client.connect();
const redis = new Redis(redisUrl.toString(), { lazyConnect: true, maxRetriesPerRequest: 1 });

try {
  const { rows: [me] } = await client.query(
    "select system_identifier || '|' || current_database() as id from pg_control_system()"
  );
  if (me.id !== dockerDb) {
    refuse(`DATABASE_URL reaches a different Postgres (${me.id}) than the docker compose service (${dockerDb}).`);
  }
  await redis.connect();
  const myRunId = ((await redis.info('server')).match(/run_id:(\w+)/) || [])[1];
  if (myRunId !== dockerRedisRunId) {
    refuse(`REDIS_URL reaches a different Redis (${myRunId}) than the docker compose service (${dockerRedisRunId}).`);
  }
  console.log(`\n[db:reset-local] Verified: Postgres system_identifier ${dockerDb.split('|')[0]} and Redis run_id ${myRunId.slice(0, 12)}… are the docker compose services.`);

  // ------------------------------------------------------------ truncate
  const { rows: tables } = await client.query(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> $1 order by tablename`,
    [MIGRATIONS_TABLE]
  );
  if (tables.length === 0) refuse('no application tables found in schema public (migrations not run?).');
  const { rows: [{ n: migBefore }] } = await client.query(`select count(*)::int as n from public.${MIGRATIONS_TABLE}`);

  const list = tables.map((t) => `public.${pg.escapeIdentifier(t.tablename)}`).join(', ');
  await client.query("set lock_timeout = '10s'");
  await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);

  const { rows: [{ n: migAfter }] } = await client.query(`select count(*)::int as n from public.${MIGRATIONS_TABLE}`);
  if (migAfter !== migBefore) throw new Error(`${MIGRATIONS_TABLE} row count changed (${migBefore} -> ${migAfter})!`);
  console.log(`[db:reset-local] Truncated ${tables.length} tables: ${tables.map((t) => t.tablename).join(', ')}`);
  console.log(`[db:reset-local] ${MIGRATIONS_TABLE} untouched (${migAfter} migrations recorded).`);

  // ------------------------------------------------------------ redis keys
  for (const prefix of REDIS_PREFIXES) {
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      cursor = next;
      if (keys.length) deleted += await redis.unlink(...keys);
    } while (cursor !== '0');
    console.log(`[db:reset-local] Redis: deleted ${deleted} key(s) matching ${prefix}*`);
  }
  console.log('[db:reset-local] Done. The local database is empty (schema and migrations kept).');
} finally {
  await client.end().catch(() => {});
  redis.disconnect();
}
