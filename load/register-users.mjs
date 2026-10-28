#!/usr/bin/env node
/**
 * FlashSeat — pre-register attendee users for a load test.
 *
 * Registers <count> fresh ATTENDEE users through the real API BEFORE the measured
 * k6 run and writes their access tokens to load/fixtures/tokens-<name>.json:
 *   { "createdAt": "<ISO>", "tokens": ["<jwt>", ...] }
 * so the measured run only calls POST /shows/:showId/reservations.
 *
 * Registration is argon2-bound (~46 hashes/s on the test machine), so this runs
 * with a small bounded concurrency to stay under the API's DB pool. Access tokens
 * expire after JWT_ACCESS_EXPIRY (15m), so run this right before the k6 test;
 * load/run.mjs refuses a token file older than 10 minutes.
 *
 * Usage:
 *   node load/register-users.mjs --name contention --count 1200 [--concurrency 8]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { name: null, count: null, concurrency: 8 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key in args) args[key] = argv[++i];
  }
  args.count = Number(args.count);
  args.concurrency = Number(args.concurrency);
  if (!args.name || !/^[a-z0-9_-]+$/i.test(args.name) || !(args.count > 0) || !(args.concurrency > 0)) {
    console.error('Usage: node load/register-users.mjs --name <fixture> --count <n> [--concurrency 8]');
    process.exit(1);
  }
  return args;
}

const log = (...m) => console.error('[register]', ...m);

async function registerOne(runId, i) {
  // a transient 503 (pool timeout) is retried; anything else is fatal
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `LT User ${i}`,
        email: `lt_u_${runId}_${i}@example.com`,
        password: 'Passw0rd!123',
        role: 'ATTENDEE',
      }),
    });
    if (res.status === 201) return (await res.json()).accessToken;
    if (res.status !== 503) throw new Error(`register ${i} failed: ${res.status} ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 250 * attempt));
  }
  throw new Error(`register ${i} failed: 503 after 5 attempts`);
}

async function main() {
  const { name, count, concurrency } = parseArgs(process.argv.slice(2));
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  log(`${BASE_URL}: registering ${count} attendees for "${name}" (concurrency ${concurrency})`);

  const started = Date.now();
  const tokens = new Array(count);
  let next = 0;
  let done = 0;
  const step = Math.max(100, Math.ceil(count / 10));
  async function worker() {
    while (next < count) {
      const i = next++;
      tokens[i] = await registerOne(runId, i);
      done++;
      if (done % step === 0 || done === count) {
        const secs = (Date.now() - started) / 1000;
        log(`${done}/${count} (${(done / secs).toFixed(1)}/s)`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));

  const outDir = join(HERE, 'fixtures');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `tokens-${name}.json`);
  writeFileSync(outFile, JSON.stringify({ createdAt: new Date().toISOString(), tokens }) + '\n');
  log(`wrote ${outFile} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('[register] fatal:', err.message);
  process.exit(1);
});
