/**
 * Shared integration-test helpers. Tests run against a RUNNING API (BASE_URL)
 * and use the `pg` package (already a runtime dependency) for DB-side work:
 * time shifts, invariant checks, row-lock blockers, backend kills.
 */
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

// vitest/vite injects its own `process.env.BASE_URL` ('/'), and statically rewrites
// the dotted access too — so env is read through computed access AND only accepted
// when it is an actual URL.
const envv = (name: string, dflt: string) =>
  (typeof process !== 'undefined' && (process.env as Record<string, string | undefined>)[name]) || dflt;

const rawBase = envv('BASE_URL', '');
export const BASE_URL = rawBase.startsWith('http') ? rawBase : 'http://localhost:3000';

const envFile = readFileSync(join(__dirname, '..', '.env'), 'utf8');
export const DATABASE_URL =
  envv('DATABASE_URL', '') ||
  envFile.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim() ||
  'postgres://flashseat:flashseat@localhost:5432/flashseat';
export const JWT_ACCESS_SECRET =
  envv('JWT_ACCESS_SECRET', '') || envFile.match(/^JWT_ACCESS_SECRET=(.*)$/m)?.[1]?.trim() || '';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2, 8);
export const email = (tag: string) => `${tag}_${Date.now()}_${rnd()}@test.flashseat`;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface ApiResult {
  status: number;
  data: any;
  bodyText: string;
  setCookies: string[];
  retryAfter: string | null;
}

export async function api(
  method: string,
  path: string,
  { token, body, cookie, key }: { token?: string; body?: unknown; cookie?: string; key?: string } = {}
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (cookie) headers['Cookie'] = cookie;
  if (key) headers['Idempotency-Key'] = key;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const bodyText = await res.text();
  let data: any = null;
  try { data = JSON.parse(bodyText); } catch { /* non-JSON */ }
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return { status: res.status, data, bodyText, setCookies, retryAfter: res.headers.get('retry-after') };
}

export interface ParsedCookie {
  name: string;
  value: string;
  attrs: Record<string, string | true>;
}

export function parseSetCookie(line: string): ParsedCookie {
  const parts = line.split(';').map((p) => p.trim());
  const eq = parts[0].indexOf('=');
  const attrs: Record<string, string | true> = {};
  for (const p of parts.slice(1)) {
    const i = p.indexOf('=');
    if (i === -1) attrs[p.toLowerCase()] = true;
    else attrs[p.slice(0, i).toLowerCase()] = p.slice(i + 1);
  }
  return { name: parts[0].slice(0, eq), value: parts[0].slice(eq + 1), attrs };
}

export function refreshCookie(setCookies: string[]): ParsedCookie | null {
  for (const line of setCookies) {
    const c = parseSetCookie(line);
    if (/refresh/i.test(c.name)) return c;
  }
  return null;
}

export const cookieHeader = (c: ParsedCookie) => `${c.name}=${c.value}`;
export const tokenHash = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** { error: { message, code, details? } } with string message+code. */
export function hasErrorShape(data: any): boolean {
  return (
    data !== null &&
    typeof data.error === 'object' &&
    typeof data.error.message === 'string' &&
    typeof data.error.code === 'string'
  );
}

// ---------------------------------------------------------------------------
// Hand-rolled JWTs (never the library under test)
// ---------------------------------------------------------------------------

const b64url = (s: string) => Buffer.from(s).toString('base64url');

export function makeToken(header: Record<string, unknown>, payload: Record<string, unknown>, secret = JWT_ACCESS_SECRET): string {
  const head = b64url(JSON.stringify(header));
  const pay = b64url(JSON.stringify(payload));
  const sig = createHmac(`sha${header.alg === 'HS512' ? '512' : '256'}`, secret)
    .update(`${head}.${pay}`)
    .digest('base64url');
  return `${head}.${pay}.${sig}`;
}

export const validPayload = (over: Record<string, unknown> = {}) => ({
  userId: '11111111-2222-4333-8444-555555555555',
  role: 'ATTENDEE',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 900,
  ...over,
});

// ---------------------------------------------------------------------------
// Database (pg) helpers: one-shot queries
// ---------------------------------------------------------------------------

export async function db<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    await client.end();
  }
}

/** Moves a reservation's expiry (and its seats' held_until) into the past. */
export async function expireReservation(reservationId: string): Promise<void> {
  await db(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [reservationId]);
  await db(`UPDATE show_seats SET held_until = now() - interval '1 minute' WHERE reservation_id = $1`, [reservationId]);
}

/**
 * Moves EVERY live hold in the database into the past (test data only). Used by
 * the sweeper tests before draining: with no live hold left anywhere, none can
 * reach its real HOLD_DURATION_SECONDS expiry mid-test and be swept along with
 * the test's own rows.
 */
export async function expireAllLiveHolds(): Promise<void> {
  await db(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE status = 'ACTIVE' AND expires_at > now()`);
  await db(`UPDATE show_seats SET held_until = now() - interval '1 minute' WHERE status = 'HELD' AND held_until > now()`);
}

/** Moves a single seat's hold deadline into the past (lazy expiry). */
export async function expireSeatHold(showSeatId: string): Promise<void> {
  await db(`UPDATE show_seats SET held_until = now() - interval '1 minute' WHERE id = $1`, [showSeatId]);
}

/** Moves a show's start time into the past (it has "started"). */
export async function startShowNow(showId: string): Promise<void> {
  await db(
    `UPDATE shows SET starts_at = now() - interval '1 hour', ends_at = now() + interval '1 hour' WHERE id = $1`,
    [showId]
  );
}

/** Expires a raw refresh token (by its sha256 hash). */
export async function expireRefreshToken(raw: string): Promise<void> {
  await db(`UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [tokenHash(raw)]);
}

export function liveRefreshTokens(userId: string): Promise<{ count: string }[]> {
  return db(`SELECT count(*) AS count FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}

export function deactivateUser(userId: string): Promise<unknown[]> {
  return db(`UPDATE users SET is_active = false WHERE id = $1`, [userId]);
}

/** Kills the API's backends (application_name 'flashseat-api'). */
export function terminateApiBackends(): Promise<unknown[]> {
  return db(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE application_name = 'flashseat-api' AND pid <> pg_backend_pid()`
  );
}

/**
 * Starts a background transaction that holds `lockSql` (e.g. a FOR UPDATE) for
 * `seconds`. Resolves when it finishes. Never sleeps in *test* time — the test
 * proceeds while the blocker runs.
 */
export function holdRowLock(lockSql: string, seconds = 8): { done: Promise<void> } {
  const client = new Client({ connectionString: DATABASE_URL });
  const done = (async () => {
    await client.connect();
    try {
      await client.query(`BEGIN; ${lockSql}; SELECT pg_sleep(${seconds}); COMMIT;`);
    } finally {
      await client.end();
    }
  })();
  return { done };
}

// ---------------------------------------------------------------------------
// Invariant checks (ported from scripts/check-invariants.sql — zero rows healthy)
// ---------------------------------------------------------------------------

export const INVARIANT_QUERIES: string[] = [
  `SELECT ss.id FROM show_seats ss LEFT JOIN booking_seats bs ON bs.show_seat_id = ss.id AND bs.released_at IS NULL
    WHERE ss.status = 'BOOKED' GROUP BY ss.id HAVING count(bs.id) <> 1`,
  `SELECT bs.id FROM booking_seats bs JOIN show_seats ss ON ss.id = bs.show_seat_id
    WHERE bs.released_at IS NULL AND (ss.status <> 'BOOKED' OR ss.booking_id IS DISTINCT FROM bs.booking_id)`,
  `SELECT ss.id FROM show_seats ss LEFT JOIN reservations r ON r.id = ss.reservation_id
    WHERE ss.status = 'HELD' AND (ss.reservation_id IS NULL OR r.status IN ('RELEASED', 'CONFIRMED')
      OR (ss.held_until > now() AND r.status <> 'ACTIVE'))`,
  `SELECT b.id FROM bookings b
     LEFT JOIN (SELECT booking_id, sum(price_paise) AS sp, count(*) AS c FROM booking_seats WHERE released_at IS NULL GROUP BY booking_id) t ON t.booking_id = b.id
     LEFT JOIN (SELECT reservation_id, count(*) AS c FROM reservation_seats GROUP BY reservation_id) u ON u.reservation_id = b.reservation_id
    WHERE b.status = 'CONFIRMED' AND (COALESCE(t.sp,0) <> b.total_amount_paise OR COALESCE(t.c,0) <> COALESCE(u.c,0))`,
  `SELECT ss.id FROM show_seats ss LEFT JOIN bookings b ON b.id = ss.booking_id
    WHERE ss.status = 'BOOKED' AND (b.status IS NULL OR b.status NOT IN ('CONFIRMED','REFUND_PENDING'))`,
  `SELECT r.id FROM reservations r
     LEFT JOIN bookings b ON b.reservation_id = r.id AND b.status IN ('CONFIRMED','REFUND_PENDING')
    WHERE r.status = 'CONFIRMED' AND b.id IS NULL`,
  `SELECT ss.id FROM show_seats ss JOIN shows s ON s.id = ss.show_id
    WHERE ss.status = 'HELD' AND s.status = 'CANCELLED'`,
  `SELECT r.id FROM reservations r JOIN shows s ON s.id = r.show_id
    WHERE r.status = 'ACTIVE' AND s.status = 'CANCELLED'`,
  `SELECT b.id FROM bookings b JOIN shows s ON s.id = b.show_id
    WHERE b.status = 'PENDING_PAYMENT' AND s.status = 'CANCELLED'`,
];

export async function invariantViolations(): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < INVARIANT_QUERIES.length; i++) {
    const rows = await db(INVARIANT_QUERIES[i]);
    if (rows.length > 0) out.push(`query #${i + 1}: ${rows.length} row(s): ${JSON.stringify(rows[0])}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entity setup
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  token: string;
  cookie: ParsedCookie;
  body: Record<string, unknown>;
}

export async function register(
  tag: string,
  { role = 'ATTENDEE', password = 'Passw0rd!123' }: { role?: string; password?: string } = {}
): Promise<User> {
  const body: Record<string, unknown> = { name: tag, email: email(tag), password, role };
  if (role === 'ORGANIZER') body.organization_name = `${tag} Org`;
  const res = await api('POST', '/auth/register', { body });
  if (res.status !== 201) throw new Error(`register ${tag} failed: ${res.status} ${res.bodyText}`);
  return { id: res.data.user.id, token: res.data.accessToken, cookie: refreshCookie(res.setCookies)!, body };
}

export interface ShowSetup {
  org: User;
  user: User;
  eventId: string;
  venueId: string;
  showId: string;
  seatIds: string[];
}

export async function createShowAt(org: User, eventId: string, venueId: string, startMs: number) {
  return api('POST', `/events/${eventId}/shows`, {
    token: org.token,
    body: {
      venueId,
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(startMs + 2 * 3600_000).toISOString(),
      categoryPrices: [{ category: 'REGULAR', pricePaise: 50000 }],
    },
  });
}

export async function setupShow(tag: string, seatCount = 4): Promise<ShowSetup> {
  const org = await register(`${tag}_org`, { role: 'ORGANIZER' });
  const user = await register(`${tag}_usr`);
  const venue = await api('POST', '/venues', {
    token: org.token,
    body: { name: `${tag} Arena ${rnd()}`, address: '1 Test Way', city: 'Testville' },
  });
  const bulk = await api('POST', `/venues/${venue.data.id}/seats/bulk`, {
    token: org.token,
    body: { mode: 'GRID', section: 'MAIN', rows: ['A'], seatsPerRow: seatCount, category: 'REGULAR' },
  });
  if (bulk.status !== 201) throw new Error(`bulk seats failed: ${bulk.status} ${bulk.bodyText}`);
  const ev = await api('POST', '/events', { token: org.token, body: { title: `${tag} Event`, category: 'MUSIC' } });
  const show = await createShowAt(org, ev.data.id, venue.data.id, Date.now() + 5 * 86400_000);
  const pub = await api('POST', `/events/${ev.data.id}/publish`, { token: org.token });
  if (pub.status !== 200) throw new Error(`publish failed: ${pub.status} ${pub.bodyText}`);
  const map = await api('GET', `/shows/${show.data.id}/seats`);
  const seatIds: string[] = map.data.sections.flatMap((s: any) => s.rows.flatMap((r: any) => r.seats)).map((s: any) => s.id);
  return { org, user, eventId: ev.data.id, venueId: venue.data.id, showId: show.data.id, seatIds };
}

export const hold = (u: User, showId: string, key: string, seatIds: string[]) =>
  api('POST', `/shows/${showId}/reservations`, { token: u.token, key, body: { seatIds } });
export const checkout = (u: User, resId: string) => api('POST', `/reservations/${resId}/checkout`, { token: u.token });
export const release = (u: User, resId: string) => api('DELETE', `/reservations/${resId}`, { token: u.token });
export const confirmMock = (u: User, bId: string) => api('POST', `/bookings/${bId}/confirm-mock`, { token: u.token });
export const cancelEvent = (org: User, eventId: string) => api('POST', `/events/${eventId}/cancel`, { token: org.token });


// ---------------------------------------------------------------------------
// Sweeper drain helper
// ---------------------------------------------------------------------------

import { runSweepOnce } from '../src/modules/sweeper/sweeper.service';

/**
 * Calls runSweepOnce() in a loop until a run reports all zeros (nothing left
 * to clean). A run rejected by the in-process guard (skippedBecauseRunning) is
 * not proof of drain: wait briefly and retry. Caps at 20 iterations to avoid
 * infinite loops.
 */
export async function drainSweeper(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const r = await runSweepOnce();
    if (r.skippedBecauseRunning) {
      await sleep(250);
      continue;
    }
    if (
      r.reservationsExpired === 0 &&
      r.bookingsExpired === 0 &&
      r.seatsFreed === 0 &&
      r.skippedShows === 0 &&
      r.errors === 0 &&
      r.shows === 0
    ) {
      return;
    }
  }
  throw new Error('drainSweeper: sweeper did not drain after 20 iterations');
}
