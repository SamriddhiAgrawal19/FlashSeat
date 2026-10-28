#!/usr/bin/env node
/**
 * FlashSeat — load test runner.
 *
 *   node load/run.mjs contention [--out load/results/contention-run2.txt]
 *   node load/run.mjs throughput [--out load/results/throughput-run2.txt]
 *        [--csv load/results/throughput-run2.csv.gz] [--probe load/results/throughput-run2-probe.csv]
 *
 * Requires fixtures/<test>.json (load/seed.mjs) and fixtures/tokens-<test>.json
 * (load/register-users.mjs, at most 10 minutes old: access tokens live 15m).
 *
 * 1. runs `k6 run load/<test>.k6.js`, streaming output to the console and (with
 *    --out) to a file, plus a JSON summary next to it (<out>-summary.json); with
 *    --csv, every metric sample is also written as (gzipped) CSV for a timeline;
 *    with --probe, a no-DB route is polled once a second to track event-loop stalls
 * 2. queries Postgres directly (psql in the compose container, like the other
 *    project scripts) for the fixture's shows and cross-checks the DB against
 *    the k6 counters: seat statuses, reservation statuses, no seat held twice.
 *
 * k6 exit 99 means "thresholds crossed": informational here, not a broken run.
 * Exit code is non-zero only if k6 itself failed or a DB integrity check failed.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';
const K6_BIN = process.env.K6_BIN || 'k6';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const PSQL_ARGS = ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'flashseat', '-d', 'flashseat'];

const test = process.argv[2];
if (!['contention', 'throughput'].includes(test)) {
  console.error('Usage: node load/run.mjs <contention|throughput> [--out <file>] [--csv <file>] [--probe <file>]');
  process.exit(1);
}
const argPath = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? resolve(process.argv[i + 1]) : null;
};
const outFile = argPath('--out');
const csvFile = argPath('--csv');
const probeFile = argPath('--probe');

const TOKEN_MAX_AGE_MS = 10 * 60_000;
function assertFreshTokens() {
  const file = join(HERE, 'fixtures', `tokens-${test}.json`);
  let createdAt;
  try {
    createdAt = Date.parse(JSON.parse(readFileSync(file, 'utf8')).createdAt);
  } catch {
    console.error(`missing or unreadable ${file}: run load/register-users.mjs --name ${test} first`);
    process.exit(1);
  }
  const ageMs = Date.now() - createdAt;
  if (!(ageMs <= TOKEN_MAX_AGE_MS)) {
    console.error(`${file} is ${Math.round(ageMs / 60_000)} min old; access tokens expire after 15m. Re-register first.`);
    process.exit(1);
  }
}

mkdirSync(join(HERE, 'results'), { recursive: true });
const sink = outFile ? createWriteStream(outFile) : null;
const emit = (text) => {
  process.stdout.write(text);
  sink?.write(text);
};

// k6 logs one warning per refused connect; under a stall that is millions of lines
// (497 MB in throughput run 2). Count them instead of writing them out.
let refusedWarnings = 0;
let partial = '';
function emitFiltered(chunk) {
  const lines = (partial + chunk).split('\n');
  partial = lines.pop();
  const kept = lines.filter((l) => {
    if (l.includes('msg="Request Failed"') && /actively refused|connection refused/i.test(l)) {
      refusedWarnings++;
      return false;
    }
    return true;
  });
  if (kept.length) emit(kept.join('\n') + '\n');
}

// Event-loop probe: GET a route that does no DB work (Express 404) once a second.
// Its latency is HTTP accept + event-loop responsiveness only, so it separates
// "API stalled" from "API is waiting on the DB pool".
function startProbe(file) {
  const rows = [];
  const t0 = Date.now();
  let inFlight = false;
  const timer = setInterval(async () => {
    if (inFlight) return; // one probe at a time: a stall shows up as one long sample
    inFlight = true;
    const start = Date.now();
    let status = 0;
    try {
      const res = await fetch(`${BASE_URL}/__loadtest_probe`, { signal: AbortSignal.timeout(30_000) });
      status = res.status;
      await res.arrayBuffer();
    } catch {
      status = 0;
    }
    rows.push({ t: (start - t0) / 1000, ms: Date.now() - start, status });
    inFlight = false;
  }, 1000);

  return () => {
    clearInterval(timer);
    writeFileSync(file, 't_s,latency_ms,status\n' + rows.map((r) => `${r.t.toFixed(1)},${r.ms},${r.status}`).join('\n') + '\n');
    const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
    const p = (q) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))];
    const failed = rows.filter((r) => r.status === 0).length;
    return `\nprobe (no-DB route, 1/s): n=${lat.length} p50=${p(0.5)}ms p95=${p(0.95)}ms max=${lat[lat.length - 1]}ms failed=${failed} -> ${file}\n`;
  };
}

function runK6() {
  const summaryFile = outFile
    ? outFile.replace(/\.txt$/, '') + '-summary.json'
    : join(HERE, 'results', `${test}-summary.json`);
  const args = [
    'run',
    '--summary-export', summaryFile,
    ...(csvFile ? ['--out', `csv=${csvFile}`] : []),
    '-e', `RUN_ID=${Date.now()}`,
    ...(process.env.BASE_URL ? ['-e', `BASE_URL=${process.env.BASE_URL}`] : []),
    ...(process.env.PEAK_VUS ? ['-e', `PEAK_VUS=${process.env.PEAK_VUS}`] : []),
    join(HERE, `${test}.k6.js`),
  ];
  emit(`$ ${K6_BIN} ${args.join(' ')}\n`);
  return new Promise((resolveRun, reject) => {
    const child = spawn(K6_BIN, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => emit(d.toString()));
    child.stderr.on('data', (d) => emitFiltered(d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      emitFiltered('\n');
      if (refusedWarnings > 0) {
        emit(`(${refusedWarnings} "connection refused" request warnings suppressed; see connect_refused_retries)\n`);
      }
      resolveRun({ code, summaryFile });
    });
  });
}

function psql(sql) {
  return execFileSync(DOCKER_BIN, [...PSQL_ARGS, '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    cwd: ROOT,
    input: sql,
    encoding: 'utf8',
  });
}

function psqlScalar(sql) {
  return execFileSync(DOCKER_BIN, [...PSQL_ARGS, '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    cwd: ROOT,
    input: sql,
    encoding: 'utf8',
  }).trim();
}

function counter(summary, name) {
  return summary?.metrics?.[name]?.count ?? 0;
}

function dbCheck(summary) {
  const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', `${test}.json`), 'utf8'));
  const ids = fixture.map((s) => s.showId);
  const totalSeats = fixture.reduce((n, s) => n + s.seatIds.length, 0);
  // uuids come from our own fixture file; validate anyway before inlining into SQL
  if (!ids.every((id) => /^[0-9a-f-]{36}$/i.test(id))) throw new Error('bad showId in fixture');
  const showFilter = `ARRAY[${ids.map((id) => `'${id}'`).join(',')}]::uuid[]`;

  emit(`\n=== DB verification (${ids.length} show(s), ${totalSeats} seats) ===\n`);
  emit(psql(`
\\echo '--- show_seats by status ---'
SELECT status, count(*) FROM show_seats WHERE show_id = ANY(${showFilter}) GROUP BY status ORDER BY status;
\\echo '--- reservations by status ---'
SELECT status, count(*) FROM reservations WHERE show_id = ANY(${showFilter}) GROUP BY status ORDER BY status;
`));

  const n = (sql) => Number(psqlScalar(sql));
  const heldOrBooked = n(`SELECT count(*) FROM show_seats WHERE show_id = ANY(${showFilter}) AND status IN ('HELD','BOOKED');`);
  const activeRes = n(`SELECT count(*) FROM reservations WHERE show_id = ANY(${showFilter}) AND status = 'ACTIVE';`);
  // a seat linked to more than one ACTIVE reservation = oversold
  const doubleHeld = n(`
SELECT count(*) FROM (
  SELECT rs.show_seat_id FROM reservation_seats rs
  JOIN reservations r ON r.id = rs.reservation_id
  WHERE r.show_id = ANY(${showFilter}) AND r.status = 'ACTIVE'
  GROUP BY rs.show_seat_id HAVING count(*) > 1) x;`);
  // HELD seat must point at an ACTIVE reservation that lists that seat
  const orphanHeld = n(`
SELECT count(*) FROM show_seats ss
LEFT JOIN reservations r ON r.id = ss.reservation_id
LEFT JOIN reservation_seats rs ON rs.reservation_id = ss.reservation_id AND rs.show_seat_id = ss.id
WHERE ss.show_id = ANY(${showFilter}) AND ss.status = 'HELD'
  AND (r.status IS DISTINCT FROM 'ACTIVE' OR rs.show_seat_id IS NULL);`);
  // every ACTIVE reservation in these tests holds exactly one seat, and that seat is HELD by it
  const badActive = n(`
SELECT count(*) FROM reservations r
WHERE r.show_id = ANY(${showFilter}) AND r.status = 'ACTIVE'
  AND (SELECT count(*) FROM show_seats ss WHERE ss.reservation_id = r.id AND ss.status = 'HELD') <> 1;`);

  const k6Success = counter(summary, 'reserve_201');
  // Requests whose response never arrived (timeout / reset) may still have committed,
  // so with any of them the k6 count is a lower bound on the DB count, not an equality.
  const unknown = counter(summary, 'reserve_unknown_outcome');

  const checks = [
    unknown === 0
      ? ['k6 successful holds == DB ACTIVE reservations', k6Success === activeRes, `${k6Success} vs ${activeRes}`]
      : [
          'k6 201s <= DB ACTIVE reservations <= k6 201s + unknown-outcome requests',
          k6Success <= activeRes && activeRes <= k6Success + unknown,
          `${k6Success} <= ${activeRes} <= ${k6Success} + ${unknown}`,
        ],
    ['DB HELD/BOOKED seats == DB ACTIVE reservations', heldOrBooked === activeRes, `${heldOrBooked} vs ${activeRes}`],
    ['no seat in more than one ACTIVE reservation', doubleHeld === 0, `${doubleHeld} seat(s)`],
    ['every HELD seat belongs to an ACTIVE reservation listing it', orphanHeld === 0, `${orphanHeld} seat(s)`],
    ['every ACTIVE reservation holds exactly one HELD seat', badActive === 0, `${badActive} reservation(s)`],
  ];
  if (test === 'contention') {
    checks.unshift(['HELD/BOOKED seats == seat count (all seats sold, none oversold)', heldOrBooked === totalSeats, `${heldOrBooked} vs ${totalSeats}`]);
  }

  emit(`\nHELD/BOOKED seats: ${heldOrBooked}   ACTIVE reservations: ${activeRes}   k6 successful holds: ${k6Success}   unknown-outcome requests: ${unknown}\n`);
  let ok = true;
  for (const [label, pass, detail] of checks) {
    emit(`${pass ? 'PASS' : 'FAIL'}  ${label}  (${detail})\n`);
    ok &&= pass;
  }
  return ok;
}

async function main() {
  assertFreshTokens();
  const stopProbe = probeFile ? startProbe(probeFile) : null;
  const { code, summaryFile } = await runK6();
  if (stopProbe) emit(stopProbe());
  if (code !== 0 && code !== 99) {
    emit(`\nk6 exited with code ${code}: run failed.\n`);
    process.exitCode = 1;
  } else if (code === 99) {
    emit('\nk6 exit 99: one or more informational thresholds were crossed (see ✗ above).\n');
  }

  let summary = null;
  try {
    summary = JSON.parse(readFileSync(summaryFile, 'utf8'));
  } catch {
    emit(`(could not read ${summaryFile}; k6 counter cross-check will read 0)\n`);
  }

  const dbOk = dbCheck(summary);
  if (!dbOk) process.exitCode = 1;
  sink?.end();
}

main().catch((err) => {
  emit(`fatal: ${err.stack || err.message}\n`);
  sink?.end();
  process.exit(1);
});
