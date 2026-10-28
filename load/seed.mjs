#!/usr/bin/env node
/**
 * FlashSeat — load-test fixture seeder.
 *
 * Creates N fresh, bookable shows through the REAL API (no raw SQL):
 *   organizer register -> per show: venue -> bulk seats -> event -> show -> publish
 * then reads each show's seat map and prints a JSON array of
 *   { showId, seatIds: string[] }
 * to stdout, and writes the same array to load/fixtures/<name>.json.
 *
 * Each show gets its own venue and event so shows are fully independent (no shared
 * event row lock between shows during the throughput test).
 *
 * Usage:
 *   node load/seed.mjs --name contention --shows 1 --seats 100
 *   BASE_URL=http://localhost:3000 node load/seed.mjs --name throughput --shows 200 --seats 50
 *
 * Progress goes to stderr so stdout stays pure JSON.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { name: null, shows: null, seats: null, concurrency: 8 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key in args) args[key] = argv[++i];
  }
  args.shows = Number(args.shows);
  args.seats = Number(args.seats);
  args.concurrency = Number(args.concurrency);
  if (!args.name || !/^[a-z0-9_-]+$/i.test(args.name) || !(args.shows > 0) || !(args.seats > 0)) {
    console.error('Usage: node load/seed.mjs --name <fixture> --shows <n> --seats <m> [--concurrency 8]');
    process.exit(1);
  }
  // GRID mode caps seatsPerRow at 500; spread larger counts over several rows.
  if (args.seats > 500 * 26) {
    console.error('--seats must be <= 13000');
    process.exit(1);
  }
  return args;
}

const rnd = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const log = (...m) => console.error('[seed]', ...m);

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

function expect(res, status, what) {
  if (res.status !== status) {
    throw new Error(`${what} failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

// rows x seatsPerRow with exactly `seats` seats when seats <= 500, else full rows of 500
function gridFor(seats) {
  if (seats <= 500) return { rows: ['A'], seatsPerRow: seats };
  if (seats % 500 !== 0) throw new Error('--seats above 500 must be a multiple of 500');
  const n = seats / 500;
  return { rows: Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i)), seatsPerRow: 500 };
}

async function createShow(org, index, seats) {
  const tag = `LT ${index} ${rnd()}`;

  const venue = expect(
    await api('POST', '/venues', {
      token: org.token,
      body: { name: `Load Arena ${tag}`, address: '1 Load Test Way', city: 'Loadville' },
    }),
    201,
    'createVenue'
  );

  expect(
    await api('POST', `/venues/${venue.id}/seats/bulk`, {
      token: org.token,
      body: { mode: 'GRID', section: 'MAIN', ...gridFor(seats), category: 'REGULAR' },
    }),
    201,
    'bulkSeats'
  );

  const event = expect(
    await api('POST', '/events', {
      token: org.token,
      body: { title: `Load Event ${tag}`, category: 'MUSIC' },
    }),
    201,
    'createEvent'
  );

  // Far enough out that the show stays bookable for the whole run.
  const start = Date.now() + 7 * 86400_000;
  const show = expect(
    await api('POST', `/events/${event.id}/shows`, {
      token: org.token,
      body: {
        venueId: venue.id,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + 2 * 3600_000).toISOString(),
        categoryPrices: [{ category: 'REGULAR', pricePaise: 50000 }],
      },
    }),
    201,
    'createShow'
  );

  // publish requires at least one show, so it comes last
  expect(await api('POST', `/events/${event.id}/publish`, { token: org.token }), 200, 'publish');

  const map = expect(await api('GET', `/shows/${show.id}/seats`), 200, 'seatMap');
  const all = map.sections.flatMap((s) => s.rows.flatMap((r) => r.seats));
  const available = all.filter((s) => s.status === 'AVAILABLE').map((s) => s.id);
  if (available.length !== seats) {
    throw new Error(`show ${show.id}: expected ${seats} AVAILABLE seats, got ${available.length}`);
  }

  return { showId: show.id, seatIds: available };
}

async function main() {
  const { name, shows, seats, concurrency } = parseArgs(process.argv.slice(2));
  log(`${BASE_URL}: creating ${shows} show(s) x ${seats} seats as fixture "${name}"`);

  const org = expect(
    await api('POST', '/auth/register', {
      body: {
        name: 'Load Organizer',
        email: `load_org_${rnd()}@example.com`,
        password: 'Passw0rd!123',
        role: 'ORGANIZER',
        organization_name: 'Load Test Org',
      },
    }),
    201,
    'register organizer'
  );
  const organizer = { token: org.accessToken };

  // Small bounded worker pool: fast enough for 200 shows, gentle on a 10-conn DB pool.
  const results = new Array(shows);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < shows) {
      const i = next++;
      results[i] = await createShow(organizer, i, seats);
      done++;
      if (done % 25 === 0 || done === shows) log(`${done}/${shows} shows ready`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, shows) }, worker));

  const outDir = join(HERE, 'fixtures');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${name}.json`);
  const json = JSON.stringify(results, null, 2);
  writeFileSync(outFile, json + '\n');

  log(`wrote ${outFile} (${shows} shows, ${shows * seats} seats)`);
  process.stdout.write(json + '\n');
}

main().catch((err) => {
  console.error('[seed] fatal:', err.message);
  process.exit(1);
});
