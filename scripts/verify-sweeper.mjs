#!/usr/bin/env node
/**
 * FlashSeat — Step 6 regression script (background sweeper).
 *
 * 1. Mutation checks: each mutation removes one exact condition from
 *    src/modules/sweeper/sweeper.repository.ts, runs `npx vitest run
 *    tests/sweeper.test.ts`, records which tests failed, then restores the file
 *    byte-for-byte from the copy taken before the mutation and verifies its
 *    sha256 matches the original. (Restored from that copy rather than with
 *    `git checkout`: the file may not be committed yet, and a checkout would also
 *    discard any uncommitted edits in it.)
 *      M1  lockExpiredHeldSeats  without "AND held_until <= now()"   -> B and D must FAIL
 *      M2  lockExpiredReservations without "AND expires_at <= now()" -> B and D must FAIL
 *      M3  lockExpiredReservations without "SKIP LOCKED" (3 runs)    -> reported, informational
 *      M4  freeSeats UPDATE without "AND held_until <= now()"        -> reported, informational
 *      M5  lockExpiredReservations without the stranded-booking
 *          branch (EXPIRED reservation + PENDING_PAYMENT booking)    -> J must FAIL
 * 2. PASS/FAIL summary table for M1-M4.
 * 3. `npm run sweeper:once` and the sweeper invariant check, with their output.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 node scripts/verify-sweeper.mjs
 *
 * The tests need a running API (ENABLE_MOCK_PAYMENT=true) and the compose DB. The
 * invariant check runs `npm run db:check-sweeper-invariants`; if DOCKER_BIN is set
 * (docker binary not on PATH), the same SQL is run through `$DOCKER_BIN compose
 * exec -T postgres psql` instead, since the npm script hardcodes `docker`.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DOCKER_BIN = process.env.DOCKER_BIN;
const PSQL_ARGS = ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'flashseat', '-d', 'flashseat'];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = 'src/modules/sweeper/sweeper.repository.ts';
const TARGET_PATH = join(ROOT, TARGET);
const TEST_FILE = 'tests/sweeper.test.ts';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Runs a shell command in the repo root; returns { code, out }. */
function sh(cmd, { echo = false } = {}) {
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  if (echo) process.stdout.write(out);
  return { code: r.status ?? 1, out };
}

/**
 * Removes/replaces `from` inside the body of `export async function <fn>(`
 * (up to the next exported function). `from` must occur exactly once there.
 */
function mutateInFunction(src, fn, from, to) {
  const start = src.indexOf(`export async function ${fn}(`);
  if (start < 0) throw new Error(`function ${fn} not found in ${TARGET}`);
  const next = src.indexOf('export async function ', start + 1);
  const end = next < 0 ? src.length : next;
  const body = src.slice(start, end);
  const parts = body.split(from);
  if (parts.length !== 2) throw new Error(`"${from}" occurs ${parts.length - 1}x in ${fn} (expected exactly 1)`);
  return src.slice(0, start) + parts.join(to) + src.slice(end);
}

/** Runs the sweeper test file; returns { ok, failed: ['B', ...], total, summary }. */
function runSweeperTests() {
  const outFile = join(tmpdir(), `flashseat-verify-sweeper-${process.pid}.json`);
  rmSync(outFile, { force: true });
  const r = sh(`npx vitest run ${TEST_FILE} --reporter=json --outputFile="${outFile}"`);
  let report;
  try {
    report = JSON.parse(readFileSync(outFile, 'utf8'));
  } catch {
    throw new Error(`vitest produced no JSON report (exit ${r.code}):\n${r.out.slice(-3000)}`);
  } finally {
    rmSync(outFile, { force: true });
  }
  const tests = report.testResults.flatMap((f) => f.assertionResults);
  const letter = (t) => (t.title.match(/^([A-Z][0-9]?):/) || [, t.title])[1];
  const failed = tests.filter((t) => t.status !== 'passed').map(letter);
  return {
    ok: r.code === 0 && failed.length === 0,
    failed,
    total: tests.length,
    summary: `${tests.length - failed.length}/${tests.length} passed${failed.length ? `, failed: ${failed.join(', ')}` : ''}`,
  };
}

// The original file, captured once; every mutation starts from and returns to it.
const ORIGINAL = readFileSync(TARGET_PATH);
const ORIGINAL_HASH = sha256(ORIGINAL);

function restoreTarget() {
  writeFileSync(TARGET_PATH, ORIGINAL);
  const now = sha256(readFileSync(TARGET_PATH));
  if (now !== ORIGINAL_HASH) throw new Error(`RESTORE FAILED: ${TARGET} sha256 ${now} != original ${ORIGINAL_HASH}`);
  return now;
}

// Never leave a mutated file behind, even on Ctrl+C.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { restoreTarget(); console.error(`\n${sig}: ${TARGET} restored`); } catch (e) { console.error(String(e)); }
    process.exit(130);
  });
}

// ---------------------------------------------------------------------------
// mutations
// ---------------------------------------------------------------------------

const MUTATIONS = [
  {
    id: 'M1',
    desc: 'lockExpiredHeldSeats: drop "AND held_until <= now()"',
    apply: (s) => mutateInFunction(s, 'lockExpiredHeldSeats', " AND status = 'HELD' AND held_until <= now()", " AND status = 'HELD'"),
    runs: 1,
    mustFail: ['B', 'D'],
  },
  {
    id: 'M2',
    desc: 'lockExpiredReservations: drop "AND expires_at <= now()"',
    apply: (s) => mutateInFunction(s, 'lockExpiredReservations', "(status = 'ACTIVE' AND expires_at <= now())", "(status = 'ACTIVE')"),
    runs: 1,
    mustFail: ['B', 'D'],
  },
  {
    id: 'M3',
    desc: 'lockExpiredReservations: drop "SKIP LOCKED"',
    apply: (s) => mutateInFunction(s, 'lockExpiredReservations', 'FOR UPDATE SKIP LOCKED', 'FOR UPDATE'),
    runs: 3,
    mustFail: null, // informational
  },
  {
    id: 'M4',
    desc: 'freeSeats UPDATE: drop "AND held_until <= now()"',
    apply: (s) => mutateInFunction(s, 'freeSeats', " AND status = 'HELD' AND held_until <= now()", " AND status = 'HELD'"),
    runs: 1,
    mustFail: null, // informational
    ifNothingFails:
      'expected: freeSeats only receives ids that lockExpiredHeldSeats already filtered on held_until <= now() and holds FOR UPDATE, so the re-check is defence in depth',
  },
  {
    id: 'M5',
    desc: 'lockExpiredReservations: drop the stranded-booking branch',
    apply: (s) => mutateInFunction(s, 'lockExpiredReservations', `
          OR (status = 'EXPIRED' AND EXISTS (
                SELECT 1 FROM bookings b WHERE b.reservation_id = r.id AND b.status = 'PENDING_PAYMENT'))`, ''),
    runs: 1,
    mustFail: ['J'],
  },
];

async function main() {
  console.log(`verify-sweeper against ${BASE_URL}`);
  console.log(`target ${TARGET} sha256=${ORIGINAL_HASH}`);
  let allOk = true;

  // -- baseline: the unmutated suite must be green, otherwise mutations prove nothing
  console.log('\n--- Baseline (no mutation) ---');
  const base = runSweeperTests();
  console.log(`   ${base.summary}`);
  if (!base.ok) {
    console.log('   ! baseline is not green; mutation results would be meaningless. Aborting.');
    process.exit(1);
  }

  // -- 1. mutations
  const rows = [];
  for (const m of MUTATIONS) {
    console.log(`\n--- ${m.id}: ${m.desc} ---`);
    const runs = [];
    try {
      writeFileSync(TARGET_PATH, m.apply(ORIGINAL.toString('utf8')));
      console.log(`   mutated (sha256 ${sha256(readFileSync(TARGET_PATH)).slice(0, 12)}…)`);
      for (let i = 1; i <= m.runs; i++) {
        const r = runSweeperTests();
        runs.push(r);
        console.log(`   run ${i}/${m.runs}: ${r.summary}`);
      }
    } finally {
      const h = restoreTarget();
      console.log(`   restored, sha256 matches original (${h.slice(0, 12)}…)`);
    }

    const failedUnion = [...new Set(runs.flatMap((r) => r.failed))].sort();
    let verdict;
    let note;
    if (m.mustFail) {
      const missing = m.mustFail.filter((t) => runs.some((r) => !r.failed.includes(t)));
      verdict = missing.length === 0 ? 'PASS' : 'FAIL';
      note = missing.length === 0
        ? `${m.mustFail.join(' and ')} failed as required`
        : `NOT caught by: ${missing.join(', ')}`;
      if (verdict === 'FAIL') allOk = false;
    } else {
      verdict = 'INFO';
      note = failedUnion.length === 0
        ? `nothing failed in ${m.runs} run(s)${m.ifNothingFails ? ` — ${m.ifNothingFails}` : ''}`
        : `failing in ${runs.filter((r) => r.failed.length).length}/${m.runs} run(s): ${failedUnion.join(', ')}`;
    }
    rows.push({ id: m.id, desc: m.desc, runs: m.runs, failed: failedUnion.join(', ') || '-', verdict, note });
  }

  // -- 2. summary table
  console.log('\n========================================================================================');
  console.log('Mut | Runs | Tests failed        | Verdict | Notes');
  console.log('----|------|---------------------|---------|-------------------------------------------');
  for (const r of rows) {
    console.log(`${r.id.padEnd(3)} | ${String(r.runs).padEnd(4)} | ${r.failed.padEnd(19)} | ${r.verdict.padEnd(7)} | ${r.note}`);
  }
  console.log('========================================================================================');

  // -- 3. one real sweep + invariant check
  console.log('\n--- npm run sweeper:once ---');
  const once = sh('npm run sweeper:once', { echo: true });
  if (once.code !== 0) {
    console.log(`   ! sweeper:once exited ${once.code}`);
    allOk = false;
  }

  console.log('\n--- sweeper invariants ---');
  let invOut;
  if (DOCKER_BIN) {
    console.log(`(DOCKER_BIN=${DOCKER_BIN}: running scripts/check-sweeper-invariants.sql directly)`);
    invOut = execFileSync(DOCKER_BIN, [...PSQL_ARGS, '-f', '-'], {
      cwd: ROOT,
      input: readFileSync(join(ROOT, 'scripts', 'check-sweeper-invariants.sql'), 'utf8'),
      encoding: 'utf8',
    });
    process.stdout.write(invOut);
  } else {
    const inv = sh('npm run db:check-sweeper-invariants', { echo: true });
    invOut = inv.out;
    if (inv.code !== 0) allOk = false;
  }
  const sections = (invOut.match(/\(\d+ rows?\)/g) || []);
  const invOk = sections.length === 3 && sections.every((s) => s === '(0 rows)');
  console.log(`   sweeper invariants: ${invOk ? 'PASS (all three queries returned 0 rows)' : `FAIL (${sections.join(' ') || 'no result lines'})`}`);
  if (!invOk) allOk = false;

  console.log(`\nverify-sweeper: ${allOk ? 'PASS' : 'FAIL'}`);
  if (!allOk) process.exit(1);
}

main().catch((err) => {
  try { restoreTarget(); } catch (e) { console.error(String(e)); }
  console.error('Fatal error during verify-sweeper:', err);
  process.exit(1);
});
