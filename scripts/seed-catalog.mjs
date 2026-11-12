/**
 * FlashSeat: create the demo CATALOG (organizers, venues + seat layouts, events,
 * shows) through the public API. No attendees, no holds, no bookings, no payments,
 * so it works in production, where mock payment is refused.
 *
 *   npm run seed:catalog                      (API_BASE_URL, DEMO_PASSWORD from the environment)
 *   docker compose -f docker-compose.prod.yml run --rm seed-catalog   (on the server)
 *
 * Environment:
 *   API_BASE_URL   the API root, default http://localhost:3000. Through Caddy that is
 *                  https://<SITE_DOMAIN>/api; inside the compose network http://api:3000.
 *   DEMO_PASSWORD  required (at least 8 characters): the password of the 3 demo
 *                  organizer accounts. Never printed.
 *
 * Same content as `npm run seed:demo` (scripts/lib/demo-catalog.mjs): 3 organizers,
 * 6 venues, the published events with their shows, and the draft event. The
 * "cancelled" demo event is left out: without bookings to refund it shows nothing.
 * Refuses to run if a demo organizer account already exists.
 *
 * No dependencies beyond Node 22 (no dotenv), so it runs in a bare node image.
 */
import { DOMAIN, ORGANIZERS, VENUES, EVENTS, DRAFT_EVENT, plusHours, fmtIst } from './lib/demo-catalog.mjs';

const API = (process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const PASSWORD = process.env.DEMO_PASSWORD;
const TAG = '[seed:catalog]';
const log = (...a) => console.log(TAG, ...a);
const fail = (...a) => { console.error(TAG, ...a); process.exit(1); };

if (!PASSWORD || PASSWORD.startsWith('<')) fail('DEMO_PASSWORD is not set. Set it (at least 8 characters) and run again.');
if (PASSWORD.length < 8) fail('DEMO_PASSWORD must be at least 8 characters (the API rejects shorter ones).');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Production register limit is 30/min per IP; 3 registrations never get near it,
// but a retry on 429 / busy / lock conflicts keeps a re-run on a busy server safe.
const RETRYABLE = new Set(['RATE_LIMITED', 'SERVICE_BUSY', 'LOCK_TIMEOUT', 'RETRYABLE_CONFLICT', 'DB_UNAVAILABLE', 'DB_TIMEOUT']);

class ApiError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} -> ${status} ${body?.error?.code ?? ''} ${body?.error?.message ?? JSON.stringify(body)}`);
    this.status = status;
    this.code = body?.error?.code;
    this.body = body;
  }
}

async function api(method, path, { body, token } = {}) {
  for (let attempt = 1; ; attempt++) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
    if (res.ok) return json;
    const err = new ApiError(method, path, res.status, json);
    if (RETRYABLE.has(err.code) && attempt <= 8) {
      const wait = Number(res.headers.get('retry-after') || 1) * 1000 + 100;
      log(`  ${err.code} on ${method} ${path}; retrying in ${Math.ceil(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    throw err;
  }
}

async function main() {
  try {
    const health = await api('GET', '/health');
    if (health?.status !== 'ok') throw new Error(JSON.stringify(health));
  } catch (e) {
    fail(`The API at ${API} is not healthy (${e.message}). Check API_BASE_URL and that the stack is up.`);
  }
  log(`API at ${API} is healthy.`);

  // Organizers. The first registration doubles as the "already seeded?" check.
  log('Registering the demo organizers...');
  const orgs = {};
  for (const [key, o] of Object.entries(ORGANIZERS)) {
    try {
      const r = await api('POST', '/auth/register', {
        body: { name: o.name, email: o.email, password: PASSWORD, role: 'ORGANIZER', organization_name: o.organization_name },
      });
      orgs[key] = { ...o, token: r.accessToken };
    } catch (e) {
      if (e.code === 'EMAIL_TAKEN') {
        fail(`Demo account ${o.email} already exists: the catalog is already seeded (or partly). Refusing to run again.`);
      }
      throw e;
    }
  }

  log('Creating venues and seat layouts...');
  const venues = {};
  for (const [key, v] of Object.entries(VENUES)) {
    const token = orgs[v.org].token;
    const row = await api('POST', '/venues', { token, body: { name: v.name, address: v.address, city: v.city } });
    let seats = 0;
    for (const block of v.layout) {
      await api('POST', `/venues/${row.id}/seats/bulk`, { token, body: block });
      seats += block.mode === 'GRID' ? block.rows.length * block.seatsPerRow : block.count;
    }
    venues[key] = { ...v, id: row.id, seats };
  }

  log('Creating events and shows...');
  const created = [];
  for (const [ev, publish] of [...EVENTS.map((e) => [e, true]), [DRAFT_EVENT, false]]) {
    const token = orgs[ev.org].token;
    const row = await api('POST', '/events', { token, body: { title: ev.title, category: ev.category, description: ev.description } });
    for (const s of ev.shows) {
      await api('POST', `/events/${row.id}/shows`, {
        token,
        body: {
          venueId: venues[s.venue].id,
          startsAt: s.start.toISOString(),
          endsAt: plusHours(s.start, s.hours).toISOString(),
          ...(s.salesOpenAt ? { salesOpenAt: s.salesOpenAt.toISOString() } : {}),
          categoryPrices: s.prices,
        },
      });
    }
    if (publish) await api('POST', `/events/${row.id}/publish`, { token });
    created.push([ev.title.slice(0, 48), ev.category, publish ? 'PUBLISHED' : 'DRAFT', ev.shows.length, fmtIst(ev.shows[0].start)]);
  }

  console.log('\n================ FlashSeat demo catalog ================');
  console.log('Organizer accounts (password: the DEMO_PASSWORD you set):');
  for (const o of Object.values(orgs)) console.log(`  ${o.email}  ${o.organization_name.split(',')[0]}`);
  console.log(`\nVenues: ${Object.values(venues).map((v) => `${v.name} (${v.city}, ${v.seats})`).join('; ')}`);
  console.log(`\nEvents (${created.length}):`);
  for (const r of created) console.log(`  ${r.join('  |  ')}`);
  console.log(`\nNo bookings were created. Attendees sign up on the site. Demo e-mail domain: @${DOMAIN}.\n`);
}

main().catch((e) => {
  console.error(`\n${TAG} FAILED:`, e.message);
  if (e.body?.error?.details) console.error(JSON.stringify(e.body.error.details, null, 2));
  process.exit(1);
});
