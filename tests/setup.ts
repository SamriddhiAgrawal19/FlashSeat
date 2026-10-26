/**
 * Per-test-file setup. Vitest runs every test file in its own worker process, so
 * each file that imports src/ code gets its own instance of the production pool
 * (src/db/pool.ts). Close it when the file finishes so no connections outlive
 * the file that opened them.
 */
import { afterAll } from 'vitest';
import { pool } from '../src/db/pool';

afterAll(async () => {
  await pool.end();
});
