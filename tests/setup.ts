/**
 * Per-test-file setup. Vitest runs every test file in its own worker process, so
 * each file that imports src/ code gets its own instance of the production pool
 * (src/db/pool.ts) and Redis client (src/redis/client.ts). Close them when the
 * file finishes so no connections outlive the file that opened them.
 */
import { afterAll, beforeAll } from 'vitest';
import { pool } from '../src/db/pool';
import { redis } from '../src/redis/client';

// The shared client runs with enableOfflineQueue=false (see src/redis/client.ts),
// so a test's first Redis command would be rejected outright if the client were
// still connecting. Wait for it once per file. Bounded, and never fails the file:
// a file that doesn't use Redis must still run with Redis down.
beforeAll(async () => {
  if (redis.status === 'ready') return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    redis.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
});

afterAll(async () => {
  await pool.end();
  // Defensive cleanup of the admission-control set: a test that throws
  // mid-request could in principle leave members behind if its 'close'/'finish'
  // handler never fired. They expire on their own (see admissionControl.ts),
  // so removing them between files is harmless and keeps files independent.
  await redis.del('admission:inflight:booking:set').catch(() => {});
  redis.disconnect();
});
