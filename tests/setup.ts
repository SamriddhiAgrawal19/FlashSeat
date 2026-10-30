/**
 * Per-test-file setup. Vitest runs every test file in its own worker process, so
 * each file that imports src/ code gets its own instance of the production pool
 * (src/db/pool.ts) and Redis client (src/redis/client.ts). Close them when the
 * file finishes so no connections outlive the file that opened them.
 */
import { afterAll } from 'vitest';
import { pool } from '../src/db/pool';
import { redis } from '../src/redis/client';

afterAll(async () => {
  await pool.end();
  // Defensive cleanup of the admission-control counter: a test that throws
  // mid-request could in principle leave it non-zero if its 'close'/'finish'
  // handler never fired. It's a safety-net value (see admissionControl.ts),
  // so resetting it between files is harmless and keeps files independent.
  await redis.del('admission:inflight:booking').catch(() => {});
  redis.disconnect();
});
