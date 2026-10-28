#!/usr/bin/env node
/**
 * FlashSeat — latency-over-time from a k6 CSV export (`k6 run --out csv=...`).
 *
 *   node load/timeline.mjs load/results/throughput-run2.csv.gz [--bucket 5]
 *
 * Groups samples into N-second buckets and prints a markdown table:
 * active VUs, reserve req/s, reserve_latency p50/p95/p99, 201/409/503 counts,
 * refused TCP connects (retried) and unknown-outcome requests (timeout / reset).
 * Also writes the same rows as <input>-timeline.csv next to the input.
 * Accepts plain .csv or gzipped .csv.gz.
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node load/timeline.mjs <k6.csv[.gz]> [--bucket 5]');
  process.exit(1);
}
const bIdx = process.argv.indexOf('--bucket');
const BUCKET = bIdx > -1 ? Number(process.argv[bIdx + 1]) : 5;

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN);

const COUNTERS = {
  reserve_201: 'c201',
  reserve_409: 'c409',
  reserve_503: 'c503',
  reserve_5xx: 'c5xx',
  connect_refused_retries: 'refused',
  reserve_unknown_outcome: 'unknown',
};

async function main() {
  let stream = createReadStream(input);
  if (input.endsWith('.gz')) stream = stream.pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let col = null;
  const buckets = new Map();
  let t0 = Infinity;
  const get = (t) => {
    let b = buckets.get(t);
    if (!b) {
      b = { vus: 0, lat: [] };
      for (const key of Object.values(COUNTERS)) b[key] = 0;
      buckets.set(t, b);
    }
    return b;
  };

  for await (const line of rl) {
    if (!col) {
      col = Object.fromEntries(line.split(',').map((h, i) => [h, i]));
      continue;
    }
    const f = line.split(',');
    const metric = f[col.metric_name];
    const ts = Number(f[col.timestamp]);
    if (!Number.isFinite(ts)) continue;
    t0 = Math.min(t0, ts);
    const b = get(Math.floor(ts / BUCKET) * BUCKET);
    const v = Number(f[col.metric_value]);
    if (metric === 'vus') b.vus = Math.max(b.vus, v);
    else if (metric === 'reserve_latency') b.lat.push(v);
    else if (metric in COUNTERS) b[COUNTERS[metric]] += v;
  }

  const origin = Math.floor(t0 / BUCKET) * BUCKET;
  const rows = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => {
      b.lat.sort((x, y) => x - y);
      return {
        t: t - origin,
        vus: b.vus,
        rps: b.lat.length / BUCKET,
        p50: pct(b.lat, 50),
        p95: pct(b.lat, 95),
        p99: pct(b.lat, 99),
        c201: b.c201,
        c409: b.c409,
        c503: b.c503,
        other5xx: b.c5xx - b.c503,
        refused: b.refused,
        unknown: b.unknown,
      };
    });

  const ms = (x) => (Number.isFinite(x) ? Math.round(x) : '-');
  const fields = (r) => [r.t, r.vus, r.rps.toFixed(0), ms(r.p50), ms(r.p95), ms(r.p99), r.c201, r.c409, r.c503, r.other5xx, r.refused, r.unknown];

  console.log('| t (s) | VUs | reserve req/s | p50 ms | p95 ms | p99 ms | 201 | 409 | 503 | other 5xx | refused | unknown |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${fields(r).join(' | ')} |`);

  const out = input.replace(/\.csv(\.gz)?$/, '') + '-timeline.csv';
  const header = 't_s,vus,reserve_rps,p50_ms,p95_ms,p99_ms,c201,c409,c503,other5xx,refused,unknown';
  writeFileSync(out, [header, ...rows.map((r) => fields(r).join(','))].join('\n') + '\n');
  console.error(`wrote ${out}`);
}

main().catch((err) => {
  console.error('fatal:', err.message);
  process.exit(1);
});
