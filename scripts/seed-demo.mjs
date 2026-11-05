/**
 * FlashSeat — fill the local stack with realistic demo content.
 *
 *   npm run seed:demo            (after: npm run db:reset-local -- --yes)
 *   npm run demo:fresh           (both, in order)
 *
 * Everything goes through the PUBLIC HTTP API at http://localhost:3000, so every
 * validation rule, ownership check and booking invariant is enforced exactly as
 * for a real client. No SQL.
 *
 * - Respects the production rate limits even though the local .env loosens some:
 *   register 30/min/IP, login 10/min/IP + 5/min/email, holds 20/min/user. Tokens
 *   returned by register are reused; login is only used if a token expires.
 * - Passwords: DEMO_PASSWORD from the environment, else a local-only default
 *   that is printed at the end.
 * - Refuses to run if the demo accounts already exist (run db:reset-local first).
 * - All names, venues, organisations and events are fictional.
 *
 * Note: the demo ACTIVE hold and PENDING_PAYMENT booking live HOLD_DURATION_SECONDS
 * (10 min locally); after that the sweeper expires them. Re-run demo:fresh to get
 * them back.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://localhost:3000';
const DEFAULT_PASSWORD = 'LocalDemoOnly#2026';
const DOMAIN = 'flashseat.test';

// Production policy (src/config/env.ts defaults), slightly under the limit.
const LIMITS = {
  register: { n: 28, windowMs: 60_000 },
  loginIp: { n: 9, windowMs: 60_000 },
  holdsPerUser: { n: 18, windowMs: 60_000 },
};
const GUEST_COUNT = 20;
const PARALLEL_GUESTS = 5;

// ---------------------------------------------------------------- safety
const fileEnv = existsSync(join(ROOT, '.env')) ? dotenv.parse(readFileSync(join(ROOT, '.env'))) : {};
// DEMO_PASSWORD from the shell, else from .env; an unfilled <PLACEHOLDER> counts as unset.
const DEMO_PASSWORD = [process.env.DEMO_PASSWORD, fileEnv.DEMO_PASSWORD].find((v) => v && !v.startsWith('<'));
const PASSWORD = DEMO_PASSWORD || DEFAULT_PASSWORD;
if ([process.env.NODE_ENV, fileEnv.NODE_ENV].some((v) => (v || '').toLowerCase() === 'production')) {
  console.error('[seed:demo] REFUSING TO RUN: NODE_ENV is "production".');
  process.exit(1);
}
if (PASSWORD.length < 8) {
  console.error('[seed:demo] DEMO_PASSWORD must be at least 8 characters (the API rejects shorter ones).');
  process.exit(1);
}

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[seed:demo]', ...a);

// Deterministic PRNG so the seat spread looks the same on every fresh run.
let rngState = 0x5eed2026;
function rand() {
  rngState |= 0; rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

/** Sliding-window client-side throttle: waits until another call fits in the window. */
function throttle({ n, windowMs }) {
  const stamps = [];
  return async () => {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] >= windowMs) stamps.shift();
      if (stamps.length < n) { stamps.push(now); return; }
      const wait = windowMs - (now - stamps[0]) + 50;
      log(`  rate-limit pacing: waiting ${Math.ceil(wait / 1000)}s`);
      await sleep(wait);
    }
  };
}
const registerThrottle = throttle(LIMITS.register);
const loginThrottle = throttle(LIMITS.loginIp);

class ApiError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} -> ${status} ${body?.error?.code ?? ''} ${body?.error?.message ?? JSON.stringify(body)}`);
    this.status = status;
    this.code = body?.error?.code;
    this.body = body;
  }
}

const RETRYABLE = new Set(['RATE_LIMITED', 'SERVICE_BUSY', 'LOCK_TIMEOUT', 'RETRYABLE_CONFLICT', 'DB_UNAVAILABLE', 'DB_TIMEOUT']);

/** One API call. Retries (with Retry-After) on 429 / busy / lock conflicts; re-logs in once on an expired token. */
async function api(method, path, { body, user, headers = {} } = {}) {
  for (let attempt = 1; ; attempt++) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (user) h.Authorization = `Bearer ${user.token}`;
    const res = await fetch(API + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (res.ok) return json;
    const err = new ApiError(method, path, res.status, json);
    if (RETRYABLE.has(err.code) && attempt <= 8) {
      const wait = Number(res.headers.get('retry-after') || 1) * 1000 + 100;
      log(`  ${err.code} on ${method} ${path}; retrying in ${Math.ceil(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (err.code === 'TOKEN_EXPIRED' && user && attempt === 1) {
      await login(user);
      continue;
    }
    throw err;
  }
}

async function login(user) {
  await loginThrottle();
  const r = await api('POST', '/auth/login', { body: { email: user.email, password: PASSWORD } });
  user.token = r.accessToken;
}

const accounts = [];
async function register({ name, email, role = 'ATTENDEE', organization_name }) {
  await registerThrottle();
  let r;
  try {
    r = await api('POST', '/auth/register', {
      body: { name, email, password: PASSWORD, role, ...(organization_name ? { organization_name } : {}) },
    });
  } catch (e) {
    if (e.code === 'EMAIL_TAKEN') {
      console.error(`\n[seed:demo] Demo account ${email} already exists. This script seeds an EMPTY database only.`);
      console.error('[seed:demo] Wipe local data first:  npm run db:reset-local -- --yes   (or: npm run demo:fresh)\n');
      process.exit(1);
    }
    throw e;
  }
  const user = { id: r.user.id, name, email, role, org: organization_name, token: r.accessToken, holdStamps: [] };
  accounts.push(user);
  return user;
}

// ---------------------------------------------------------------- dates (IST)
const IST_OFFSET_MS = 330 * 60_000;
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const todayIst = new Date(Date.now() + IST_OFFSET_MS); // UTC fields now read as IST wall-clock
/** The nth (0-based) given weekday at least 2 days from today, at an IST wall-clock time. */
function on(dow, nth, hhmm) {
  const d = new Date(Date.UTC(todayIst.getUTCFullYear(), todayIst.getUTCMonth(), todayIst.getUTCDate() + 2));
  while (d.getUTCDay() !== DOW[dow]) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * nth);
  return new Date(`${d.toISOString().slice(0, 10)}T${hhmm}:00+05:30`);
}
const plusHours = (date, h) => new Date(date.getTime() + h * 3_600_000);
/** n days from now at 10:00 IST. */
function salesOpenIn(days) {
  const d = new Date(Date.UTC(todayIst.getUTCFullYear(), todayIst.getUTCMonth(), todayIst.getUTCDate() + days));
  return new Date(`${d.toISOString().slice(0, 10)}T10:00:00+05:30`);
}
const fmtIst = (d) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') + ' IST';

// ---------------------------------------------------------------- content
const ORGANIZERS = {
  saptak: { name: 'Meera Iyer', email: `demo-meera@${DOMAIN}`, organization_name: 'Saptak Sound Collective' },
  chaupal: { name: 'Kabir Deshpande', email: `demo-kabir@${DOMAIN}`, organization_name: 'Chaupal Theatre Company' },
  lehar: { name: 'Nikhil Reddy', email: `demo-nikhil@${DOMAIN}`, organization_name: 'Lehar Fest Committee, Godavari Valley Institute of Technology' },
};

// Row helpers. Theatres conventionally skip row I.
const rows = (from, to) => {
  const out = [];
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) if (c !== 73) out.push(String.fromCharCode(c));
  return out;
};

const VENUES = {
  rangdeep: {
    org: 'chaupal', name: 'Rangdeep Theatre', city: 'Pune', address: 'Lane 4, Prabhat Road, Erandwane, Pune 411004',
    layout: [ // 300 seats: 60 VIP + 100 PREMIUM + 140 REGULAR
      { mode: 'GRID', rows: rows('A', 'C'), seatsPerRow: 20, section: 'STALLS', category: 'VIP' },
      { mode: 'GRID', rows: rows('D', 'H'), seatsPerRow: 20, section: 'STALLS', category: 'PREMIUM' },
      { mode: 'GRID', rows: rows('J', 'P'), seatsPerRow: 20, section: 'STALLS', category: 'REGULAR' },
    ],
  },
  backbench: {
    org: 'chaupal', name: 'The Back Bench Comedy Room', city: 'Mumbai', address: '2nd Floor, Sitara Building, Off Linking Road, Bandra West, Mumbai 400050',
    layout: [ // 120 seats
      { mode: 'GRID', rows: rows('A', 'C'), seatsPerRow: 15, section: 'FLOOR', category: 'PREMIUM' },
      { mode: 'GRID', rows: rows('D', 'H'), seatsPerRow: 15, section: 'FLOOR', category: 'REGULAR' },
    ],
  },
  neelgiri: {
    org: 'saptak', name: 'Neelgiri Auditorium', city: 'Bengaluru', address: '8 Cunningham Crescent, Vasanth Nagar, Bengaluru 560052',
    layout: [ // 500 seats: 100 VIP + 150 PREMIUM + 250 REGULAR
      { mode: 'GRID', rows: rows('A', 'D'), seatsPerRow: 25, section: 'MAIN HALL', category: 'VIP' },
      { mode: 'GRID', rows: rows('E', 'K'), seatsPerRow: 25, section: 'MAIN HALL', category: 'PREMIUM' },
      { mode: 'GRID', rows: rows('L', 'U'), seatsPerRow: 25, section: 'MAIN HALL', category: 'REGULAR' },
    ],
  },
  ninefold: {
    org: 'saptak', name: 'Studio Ninefold', city: 'Delhi', address: 'B-27, Second Floor, Shahpur Jat, New Delhi 110049',
    layout: [{ mode: 'GRID', rows: rows('A', 'F'), seatsPerRow: 10, section: 'STUDIO', category: 'REGULAR' }], // 60
  },
  banyan: {
    org: 'lehar', name: 'Banyan Grounds', city: 'Hyderabad', address: 'Survey No. 112, Nanakramguda Road, Gachibowli, Hyderabad 500032',
    layout: [{ mode: 'GENERAL_ADMISSION', count: 600, section: 'GROUND', category: 'GENERAL' }],
  },
  deccanArena: {
    org: 'lehar', name: 'Deccan Indoor Arena (East Stand)', city: 'Hyderabad', address: 'Plot 7, Sports Village Road, Kondapur, Hyderabad 500084',
    layout: [ // 280 seats: courtside pavilion + upper east stand
      { mode: 'GRID', rows: rows('A', 'D'), seatsPerRow: 20, section: 'PAVILION', category: 'PREMIUM' },
      { mode: 'GRID', rows: rows('A', 'H'), seatsPerRow: 25, section: 'EAST STAND', category: 'REGULAR' },
    ],
  },
};

const rupees = (r) => r * 100;
const P = (o) => Object.entries(o).map(([category, r]) => ({ category, pricePaise: rupees(r) }));

// fill: fraction of seats sold to demo guests (front rows first).
const EVENTS = [
  {
    key: 'ragas', org: 'saptak', category: 'MUSIC', title: 'Monsoon Ragas: An Evening of Hindustani Classical',
    description: 'A two-part evening of khayal and thumri, led by a young vocalist from the Gwalior tradition with tabla and harmonium accompaniment. The first half explores evening ragas; the second closes with lighter monsoon compositions. Doors open 30 minutes before the performance.',
    shows: [
      { venue: 'neelgiri', start: on('sat', 0, '19:00'), hours: 2.5, prices: P({ VIP: 2499, PREMIUM: 1499, REGULAR: 799 }), fill: 0.5 },
      { venue: 'neelgiri', start: on('sat', 2, '19:00'), hours: 2.5, prices: P({ VIP: 2499, PREMIUM: 1499, REGULAR: 799 }), fill: 0.3 },
    ],
  },
  {
    key: 'indie', org: 'saptak', category: 'MUSIC', title: 'Indie Nights Vol. 7',
    description: 'Three up-and-coming indie acts share one stage for a night of guitar-driven songwriting, dream pop and a little bit of Konkani folk. Each set runs about 40 minutes. Ticket sales open a few days before the show, so set a reminder.',
    shows: [
      { venue: 'neelgiri', start: on('fri', 3, '20:00'), hours: 3, prices: P({ VIP: 1199, PREMIUM: 899, REGULAR: 599 }), salesOpenAt: salesOpenIn(3) },
    ],
  },
  {
    key: 'strings', org: 'saptak', category: 'MUSIC', title: 'Strings Across Borders: Sitar and Cello',
    description: 'A sitarist and a cellist trade melodies across Hindustani and Western classical forms in an intimate duo recital. Expect a few original compositions alongside reimagined film classics. Suitable for all ages.',
    shows: [
      { venue: 'neelgiri', start: on('sun', 1, '18:30'), hours: 2, prices: P({ VIP: 1999, PREMIUM: 1299, REGULAR: 699 }), fill: 0.2 },
    ],
  },
  {
    key: 'tabla', org: 'saptak', category: 'WORKSHOP', title: "Beginner's Tabla Circle",
    description: 'A hands-on, two-hour introduction to tabla for complete beginners. Learn basic bols, simple thekas and how to keep time in teentaal. Instruments are provided; please arrive ten minutes early.',
    shows: [
      { venue: 'ninefold', start: on('sat', 0, '11:00'), hours: 2, prices: P({ REGULAR: 999 }), fill: 0.45 },
      { venue: 'ninefold', start: on('sat', 1, '11:00'), hours: 2, prices: P({ REGULAR: 999 }), fill: 0.25 },
      { venue: 'ninefold', start: on('sat', 2, '11:00'), hours: 2, prices: P({ REGULAR: 999 }) },
    ],
  },
  {
    key: 'homestudio', org: 'saptak', category: 'WORKSHOP', title: 'Home Studio Recording 101',
    description: 'Learn to record clean vocals and guitar at home with a laptop, one microphone and free software. The session covers room treatment on a budget, gain staging and a simple mixing chain. Bring headphones if you have them.',
    shows: [
      { venue: 'ninefold', start: on('sun', 1, '14:00'), hours: 3, prices: P({ REGULAR: 1499 }), fill: 0.3 },
      { venue: 'ninefold', start: on('sun', 3, '14:00'), hours: 3, prices: P({ REGULAR: 1499 }) },
    ],
  },
  {
    key: 'lasttrain', org: 'chaupal', category: 'THEATRE', title: 'The Last Train to Lonavala',
    description: 'Six strangers, one delayed overnight train and a suitcase nobody will admit to owning. This bilingual comedy-drama in Hindi and English follows a night on the platform that slowly turns into a confession. Running time is about two hours with one interval.',
    shows: [
      { venue: 'rangdeep', start: on('sat', 0, '19:30'), hours: 2.5, prices: P({ VIP: 1499, PREMIUM: 899, REGULAR: 499 }), fill: 0.55 },
      { venue: 'rangdeep', start: on('sun', 0, '17:00'), hours: 2.5, prices: P({ VIP: 1499, PREMIUM: 899, REGULAR: 499 }), fill: 0.4 },
      { venue: 'rangdeep', start: on('fri', 1, '19:30'), hours: 2.5, prices: P({ VIP: 1499, PREMIUM: 899, REGULAR: 499 }), fill: 0.22 },
      { venue: 'rangdeep', start: on('sat', 1, '19:30'), hours: 2.5, prices: P({ VIP: 1499, PREMIUM: 899, REGULAR: 499 }), fill: 0.1 },
    ],
  },
  {
    key: 'chai', org: 'chaupal', category: 'THEATRE', title: 'Chai, Chess and Other Arguments',
    description: 'Two retired neighbours in an old Pune wada have been playing the same game of chess for eleven years. When a new tenant moves in upstairs, the board is not the only thing that gets rearranged. A warm, talky two-hander in Marathi with English surtitles.',
    shows: [
      { venue: 'rangdeep', start: on('fri', 2, '19:30'), hours: 2, prices: P({ VIP: 1299, PREMIUM: 799, REGULAR: 399 }), fill: 0.2 },
      { venue: 'rangdeep', start: on('sat', 4, '19:30'), hours: 2, prices: P({ VIP: 1299, PREMIUM: 799, REGULAR: 399 }), salesOpenAt: salesOpenIn(5) },
    ],
  },
  {
    key: 'openmic', org: 'chaupal', category: 'COMEDY', title: 'Tuesday Open Mic at The Back Bench',
    description: 'Ten new comics, five minutes each, and a host who keeps it moving. Some of it will be brilliant and some of it will be brave. Food and drinks are served at the tables throughout the show.',
    shows: [
      { venue: 'backbench', start: on('tue', 0, '20:00'), hours: 1.5, prices: P({ PREMIUM: 349, REGULAR: 299 }), fill: 0.35 },
      { venue: 'backbench', start: on('tue', 1, '20:00'), hours: 1.5, prices: P({ PREMIUM: 349, REGULAR: 299 }), fill: 0.15 },
      { venue: 'backbench', start: on('tue', 2, '20:00'), hours: 1.5, prices: P({ PREMIUM: 349, REGULAR: 299 }) },
    ],
  },
  {
    key: 'overthinkers', org: 'chaupal', category: 'COMEDY', title: 'Overthinkers Anonymous: A Stand-up Hour',
    description: 'An hour of observational stand-up about group chats, rent agreements and replying "noted" to your manager at 11 PM. Contains strong language; recommended for ages 16 and above. Latecomers may be part of the show.',
    shows: [
      { venue: 'backbench', start: on('fri', 1, '21:00'), hours: 1.5, prices: P({ PREMIUM: 799, REGULAR: 499 }), fill: 0.6 },
      { venue: 'backbench', start: on('sat', 1, '21:00'), hours: 1.5, prices: P({ PREMIUM: 799, REGULAR: 499 }), fill: 0.35 },
    ],
  },
  {
    key: 'improv', org: 'chaupal', category: 'COMEDY', title: 'Improv Jam: Make It Up As We Go',
    description: 'Short-form improv games built entirely from audience suggestions, performed by the Chaupal ensemble. No two nights are the same. Shout loud and you might end up on stage.',
    shows: [
      { venue: 'backbench', start: on('thu', 2, '20:00'), hours: 1.5, prices: P({ PREMIUM: 599, REGULAR: 399 }), fill: 0.2 },
      { venue: 'backbench', start: on('thu', 3, '20:00'), hours: 1.5, prices: P({ PREMIUM: 599, REGULAR: 399 }) },
    ],
  },
  {
    key: 'leharday', org: 'lehar', category: 'FESTIVAL', title: 'Lehar 2026: Weekend Day Pass',
    description: 'The annual cultural fest of Godavari Valley Institute of Technology opens to the public for one weekend. Expect band competitions, a street-dance face-off, food stalls run by student clubs and a closing DJ set. Each ticket is valid for one day; gates open at 4 PM.',
    shows: [
      { venue: 'banyan', start: on('sat', 3, '16:00'), hours: 7, prices: P({ GENERAL: 699 }), fill: 0.2 },
      { venue: 'banyan', start: on('sun', 3, '16:00'), hours: 7, prices: P({ GENERAL: 699 }), fill: 0.12 },
    ],
  },
  {
    key: 'folk', org: 'lehar', category: 'FESTIVAL', title: 'Food and Folk Carnival',
    description: 'A family-friendly day of regional food stalls, folk music from five states and craft workshops for children. Seating is unreserved on the lawns. Entry closes at 8 PM.',
    shows: [
      { venue: 'banyan', start: on('sat', 5, '12:00'), hours: 10, prices: P({ GENERAL: 299 }), fill: 0.08 },
    ],
  },
  {
    key: 'basketball', org: 'lehar', category: 'SPORTS', title: 'Inter-College Basketball Finals',
    description: 'The top four college teams from across the Deccan play the third-place match and the final back to back. Pavilion seats sit right behind the team benches. Halftime features a three-point shootout open to ticket holders.',
    shows: [
      { venue: 'deccanArena', start: on('sat', 2, '18:00'), hours: 3, prices: P({ PREMIUM: 599, REGULAR: 299 }), fill: 0.35 },
    ],
  },
  {
    key: 'futsal', org: 'lehar', category: 'SPORTS', title: 'Deccan Futsal Cup: Semi-finals and Final',
    description: 'Eight weeks of league futsal come down to one weekend: both semi-finals on Saturday and the final on Sunday. Fast five-a-side football with rolling substitutions and plenty of goals. Under-12s must be accompanied by an adult.',
    shows: [
      { venue: 'deccanArena', start: on('sat', 4, '17:00'), hours: 3, prices: P({ PREMIUM: 499, REGULAR: 249 }), fill: 0.15 },
      { venue: 'deccanArena', start: on('sun', 4, '17:00'), hours: 3, prices: P({ PREMIUM: 499, REGULAR: 249 }), fill: 0.25 },
    ],
  },
];

const DRAFT_EVENT = {
  key: 'draft', org: 'chaupal', category: 'THEATRE', title: 'A Midsummer Monsoon (work in progress)',
  description: 'A Mumbai-set adaptation of a classic comedy of mistaken lovers, moved to a rain-soaked wedding weekend in Khandala. Casting is still being finalised. This listing is a draft and is not visible to the public yet.',
  shows: [
    { venue: 'rangdeep', start: on('sat', 5, '19:30'), hours: 2.5, prices: P({ VIP: 1499, PREMIUM: 999, REGULAR: 599 }) },
  ],
};

const CANCELLED_EVENT = {
  key: 'jazz', org: 'saptak', category: 'MUSIC', title: 'Sunset Jazz Quartet',
  description: 'A four-piece jazz ensemble playing standards and originals in an early-evening set. This show was cancelled by the organiser after tickets went on sale. Ticket holders will be refunded.',
  shows: [
    { venue: 'neelgiri', start: on('fri', 1, '19:30'), hours: 2, prices: P({ VIP: 1799, PREMIUM: 1199, REGULAR: 599 }), fill: 0.12 },
  ],
};

// ---------------------------------------------------------------- seat selection
async function seatMap(showId) {
  return api('GET', `/shows/${showId}/seats`);
}

/** Flatten a seat map into rows with a 0..1 "frontness" rank (0 = front of its section). */
function mapRows(map) {
  const out = [];
  for (const section of map.sections) {
    section.rows.forEach((r, i) => {
      out.push({
        section: section.section, row: r.row, rank: section.rows.length > 1 ? i / (section.rows.length - 1) : 0,
        seats: r.seats.map((s) => ({ ...s, taken: s.status !== 'AVAILABLE' })),
      });
    });
  }
  return out;
}

/** All start indices of n consecutive free seats in a row. */
function runs(row, n) {
  const starts = [];
  for (let i = 0; i + n <= row.seats.length; i++) {
    if (row.seats.slice(i, i + n).every((s) => !s.taken)) starts.push(i);
  }
  return starts;
}

function take(row, start, n) {
  const seats = row.seats.slice(start, start + n);
  seats.forEach((s) => { s.taken = true; });
  return seats;
}

/** Best n adjacent seats for a demo attendee: front-most row (optionally of one category), as central as possible. */
function bestSeats(rowsList, n, category) {
  for (const row of rowsList) {
    if (category && row.seats[0]?.category !== category) continue;
    const starts = runs(row, n);
    if (!starts.length) continue;
    const mid = (row.seats.length - n) / 2;
    starts.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    return take(row, starts[0], n);
  }
  throw new Error(`no ${n} adjacent seats${category ? ' in ' + category : ''}`);
}

const GROUP_SIZES = [1, 2, 2, 2, 2, 2, 3, 3, 4, 4, 4, 5, 6];
/** Split `target` seats into groups of 1-6 adjacent seats, favouring front rows (weight e^(-3*rank)). */
function planGroups(rowsList, target) {
  const groups = [];
  let left = target;
  while (left > 0) {
    let size = Math.min(pick(GROUP_SIZES), left);
    let placed = false;
    while (!placed && size >= 1) {
      const candidates = rowsList.map((r) => ({ r, starts: runs(r, size) })).filter((c) => c.starts.length);
      if (!candidates.length) { size--; continue; }
      const weights = candidates.map((c) => Math.exp(-3 * c.r.rank) * (0.6 + 0.4 * rand()));
      let x = rand() * weights.reduce((a, b) => a + b, 0);
      let i = 0;
      while ((x -= weights[i]) > 0 && i < candidates.length - 1) i++;
      const { r, starts } = candidates[i];
      groups.push(take(r, pick(starts), size).map((s) => s.id));
      left -= size;
      placed = true;
    }
    if (!placed) break; // show is full
  }
  return groups;
}

// ---------------------------------------------------------------- booking flow
const stats = { holds: 0, confirmed: 0, confirmedSeats: 0, pending: 0, active: 0, confirmedByShow: {} };

async function respectHoldLimit(user) {
  const { n, windowMs } = LIMITS.holdsPerUser;
  for (;;) {
    const now = Date.now();
    while (user.holdStamps.length && now - user.holdStamps[0] >= windowMs) user.holdStamps.shift();
    if (user.holdStamps.length < n) { user.holdStamps.push(now); return; }
    await sleep(windowMs - (now - user.holdStamps[0]) + 50);
  }
}

/** hold (Idempotency-Key) -> optionally checkout -> optionally confirm-mock. */
async function book(user, showId, seatIds, upTo = 'confirm') {
  await respectHoldLimit(user);
  const { reservation } = await api('POST', `/shows/${showId}/reservations`, {
    user, body: { seatIds }, headers: { 'Idempotency-Key': `demo-${randomUUID()}` },
  });
  stats.holds++;
  if (upTo === 'hold') { stats.active++; return { reservation }; }
  const { booking } = await api('POST', `/reservations/${reservation.id}/checkout`, { user });
  if (upTo === 'checkout') { stats.pending++; return { reservation, booking }; }
  const confirmed = await api('POST', `/bookings/${booking.id}/confirm-mock`, { user });
  stats.confirmed++;
  stats.confirmedSeats += seatIds.length;
  stats.confirmedByShow[showId] = (stats.confirmedByShow[showId] || 0) + 1;
  return { reservation, booking: confirmed.booking };
}

/** Book planned groups with the guest pool: guests run in parallel, each books its groups one after another. */
async function bookWithGuests(guests, jobs) {
  const perGuest = guests.map(() => []);
  jobs.forEach((job, i) => perGuest[i % guests.length].push(job));
  let next = 0;
  const worker = async () => {
    while (next < guests.length) {
      const g = next++;
      for (const job of perGuest[g]) await book(guests[g], job.showId, job.seatIds);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_GUESTS }, worker));
}

// ---------------------------------------------------------------- main
async function main() {
  try {
    const res = await fetch(`${API}/health`);
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.status !== 'ok') throw new Error(`HTTP ${res.status} ${JSON.stringify(body)}`);
  } catch (e) {
    console.error(`[seed:demo] The API at ${API} is not healthy (${e.message}).`);
    console.error('[seed:demo] Start the stack first:  docker compose up -d   then check  curl http://localhost:3000/health');
    process.exit(1);
  }
  log(`API at ${API} is healthy.`);

  // Accounts (register returns a token; no logins needed). The first registration
  // doubles as the "already seeded?" check.
  log('Registering accounts...');
  const orgs = {};
  for (const [key, o] of Object.entries(ORGANIZERS)) orgs[key] = await register({ ...o, role: 'ORGANIZER' });
  const asha = await register({ name: 'Asha Kulkarni', email: `demo-asha@${DOMAIN}` });
  const rahul = await register({ name: 'Rahul Menon', email: `demo-rahul@${DOMAIN}` });
  const guests = [];
  for (let i = 1; i <= GUEST_COUNT; i++) {
    const nn = String(i).padStart(2, '0');
    guests.push(await register({ name: `Demo Guest ${nn}`, email: `demo-guest-${nn}@${DOMAIN}` }));
  }

  // Venues + seat layouts.
  log('Creating venues and seat layouts...');
  const venues = {};
  for (const [key, v] of Object.entries(VENUES)) {
    const owner = orgs[v.org];
    const row = await api('POST', '/venues', { user: owner, body: { name: v.name, address: v.address, city: v.city } });
    let seats = 0;
    for (const block of v.layout) {
      await api('POST', `/venues/${row.id}/seats/bulk`, { user: owner, body: block });
      seats += block.mode === 'GRID' ? block.rows.length * block.seatsPerRow : block.count;
    }
    venues[key] = { ...v, id: row.id, seats };
  }

  // Events + shows.
  async function createEvent(ev, publish) {
    const owner = orgs[ev.org];
    const row = await api('POST', '/events', { user: owner, body: { title: ev.title, category: ev.category, description: ev.description } });
    ev.id = row.id;
    for (const s of ev.shows) {
      const show = await api('POST', `/events/${ev.id}/shows`, {
        user: owner,
        body: {
          venueId: venues[s.venue].id,
          startsAt: s.start.toISOString(),
          endsAt: plusHours(s.start, s.hours).toISOString(),
          ...(s.salesOpenAt ? { salesOpenAt: s.salesOpenAt.toISOString() } : {}),
          categoryPrices: s.prices,
        },
      });
      s.id = show.id;
    }
    if (publish) await api('POST', `/events/${ev.id}/publish`, { user: owner });
    ev.status = publish ? 'PUBLISHED' : 'DRAFT';
  }
  log('Creating events and shows...');
  for (const ev of EVENTS) await createEvent(ev, true);
  await createEvent(DRAFT_EVENT, false);
  await createEvent(CANCELLED_EVENT, true);

  const ev = Object.fromEntries([...EVENTS, CANCELLED_EVENT].map((e) => [e.key, e]));
  const maps = new Map();
  const rowsFor = async (show) => {
    if (!maps.has(show.id)) maps.set(show.id, mapRows(await seatMap(show.id)));
    return maps.get(show.id);
  };

  // Named attendees first, so they get good seats (all CONFIRMED here).
  log('Booking for the demo attendees...');
  const named = [
    [asha, ev.lasttrain.shows[0], 2, 'PREMIUM'],
    [asha, ev.ragas.shows[0], 2, 'VIP'],
    [asha, ev.tabla.shows[0], 1, null],
    [asha, ev.jazz.shows[0], 2, 'VIP'], // becomes REFUND_PENDING when the event is cancelled
    [rahul, ev.overthinkers.shows[0], 3, 'PREMIUM'],
    [rahul, ev.leharday.shows[0], 4, null],
    [rahul, ev.basketball.shows[0], 2, 'PREMIUM'],
  ];
  for (const [user, show, n, cat] of named) {
    const seats = bestSeats(await rowsFor(show), n, cat);
    await book(user, show.id, seats.map((s) => s.id));
  }

  // Guest volume: front rows sell first.
  const jobs = [];
  for (const e of [...EVENTS, CANCELLED_EVENT]) {
    for (const show of e.shows) {
      if (!show.fill) continue;
      const rowsList = await rowsFor(show);
      const total = rowsList.reduce((a, r) => a + r.seats.length, 0);
      const already = rowsList.reduce((a, r) => a + r.seats.filter((s) => s.taken).length, 0);
      for (const seatIds of planGroups(rowsList, Math.max(0, Math.round(show.fill * total) - already))) {
        jobs.push({ showId: show.id, seatIds });
      }
    }
  }
  // Interleave shows so parallel guests spread across shows.
  jobs.sort(() => rand() - 0.5);
  log(`Booking ${jobs.reduce((a, j) => a + j.seatIds.length, 0)} seats in ${jobs.length} holds with ${GUEST_COUNT} guest accounts (hold -> checkout -> confirm-mock)...`);
  await bookWithGuests(guests, jobs);

  // Cancel the cancelled event through the API: its CONFIRMED bookings become REFUND_PENDING.
  log(`Cancelling "${CANCELLED_EVENT.title}"...`);
  await api('POST', `/events/${CANCELLED_EVENT.id}/cancel`, { user: orgs[CANCELLED_EVENT.org] });
  CANCELLED_EVENT.status = 'CANCELLED';
  const cancelledMap = await seatMap(CANCELLED_EVENT.shows[0].id);

  // Last, so they stay live as long as possible: Rahul's PENDING_PAYMENT booking and ACTIVE hold.
  log('Leaving Rahul with one PENDING_PAYMENT booking and one ACTIVE hold...');
  const pendingSeats = bestSeats(await rowsFor(ev.strings.shows[0]), 2, 'PREMIUM');
  const pending = await book(rahul, ev.strings.shows[0].id, pendingSeats.map((s) => s.id), 'checkout');
  const holdSeats = bestSeats(await rowsFor(ev.lasttrain.shows[1]), 2, 'VIP');
  const hold = await book(rahul, ev.lasttrain.shows[1].id, holdSeats.map((s) => s.id), 'hold');

  // ---------------------------------------------------------------- summary
  const refundPending = stats.confirmedByShow[CANCELLED_EVENT.shows[0].id] || 0;
  const line = (cols, widths) => cols.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  const table = (title, header, rowsData) => {
    const widths = header.map((h, i) => Math.max(h.length, ...rowsData.map((r) => String(r[i]).length)));
    console.log(`\n${title}`);
    console.log(line(header, widths));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    rowsData.forEach((r) => console.log(line(r, widths)));
  };

  console.log('\n================ FlashSeat demo data ================');
  table('Accounts', ['email', 'role', 'name / organisation', 'password'], [
    ...Object.values(orgs).map((u) => [u.email, u.role, u.org, PASSWORD]),
    [asha.email, 'ATTENDEE', asha.name, PASSWORD],
    [rahul.email, 'ATTENDEE', rahul.name, PASSWORD],
    [`demo-guest-01..${String(GUEST_COUNT).padStart(2, '0')}@${DOMAIN}`, 'ATTENDEE', `${GUEST_COUNT} volume buyers`, PASSWORD],
  ]);
  table('Venues', ['venue', 'city', 'seats', 'layout', 'owner'], Object.values(venues).map((v) => [
    v.name, v.city, v.seats,
    v.layout.map((b) => `${b.category}${b.mode === 'GENERAL_ADMISSION' ? ' (GA)' : ''}`).join('/'),
    ORGANIZERS[v.org].organization_name.split(',')[0],
  ]));
  const allEvents = [...EVENTS, DRAFT_EVENT, CANCELLED_EVENT];
  const eventRows = [];
  for (const e of allEvents) {
    let sold = '-';
    if (e.status !== 'DRAFT') {
      const counts = await Promise.all(e.shows.map(async (s) => (await seatMap(s.id)).summary));
      sold = counts.map((c) => `${Math.round((100 * c.booked) / c.total)}%`).join(' ');
    }
    const futureSales = e.shows.some((s) => s.salesOpenAt) ? ' (sales open later)' : '';
    eventRows.push([e.title.slice(0, 48), e.category, e.status, e.shows.length, fmtIst(e.shows[0].start), sold + futureSales]);
  }
  table('Events', ['event', 'category', 'status', 'shows', 'first show', 'booked per show'], eventRows);
  table('Bookings', ['what', 'count'], [
    ['holds created (hold with Idempotency-Key)', stats.holds],
    ['CONFIRMED bookings (incl. later cancelled)', stats.confirmed],
    ['seats sold (confirm-mock)', stats.confirmedSeats],
    [`  of which REFUND_PENDING ("${CANCELLED_EVENT.title}", ${cancelledMap.summary.booked} seats, 1 is Asha's)`, refundPending],
    [`PENDING_PAYMENT (Rahul, ${pending.booking.event.title}, pay before ${pending.booking.payBefore})`, stats.pending],
    [`ACTIVE hold (Rahul, ${hold.reservation.event.title}, expires ${hold.reservation.expiresAt})`, stats.active],
  ]);
  console.log(`\nPassword for every demo account: ${PASSWORD}${DEMO_PASSWORD ? ' (from DEMO_PASSWORD)' : '  (LOCAL-ONLY default; set DEMO_PASSWORD to change it)'}`);
  console.log('Rahul\'s ACTIVE hold and PENDING_PAYMENT booking expire after HOLD_DURATION_SECONDS (10 min locally); run `npm run demo:fresh` to get them back.');
  console.log('Web app: http://localhost:5173 (if running). Log in with any account above.\n');
}

main().catch((e) => {
  console.error('\n[seed:demo] FAILED:', e.message);
  if (e.body?.error?.details) console.error(JSON.stringify(e.body.error.details, null, 2));
  process.exit(1);
});
