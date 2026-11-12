/**
 * Demo catalog content shared by scripts/seed-demo.mjs (local: catalog + bookings)
 * and scripts/seed-catalog.mjs (production: catalog only). Pure data and date
 * helpers: no I/O. All names, venues, organisations and events are fictional.
 *
 * Show dates are relative to 'now' (IST), so a fresh seed always has upcoming shows.
 */
export const DOMAIN = 'flashseat.test';

// ---------------------------------------------------------------- dates (IST)
export const IST_OFFSET_MS = 330 * 60_000;
export const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
export const todayIst = new Date(Date.now() + IST_OFFSET_MS); // UTC fields now read as IST wall-clock
/** The nth (0-based) given weekday at least 2 days from today, at an IST wall-clock time. */
export function on(dow, nth, hhmm) {
  const d = new Date(Date.UTC(todayIst.getUTCFullYear(), todayIst.getUTCMonth(), todayIst.getUTCDate() + 2));
  while (d.getUTCDay() !== DOW[dow]) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * nth);
  return new Date(`${d.toISOString().slice(0, 10)}T${hhmm}:00+05:30`);
}
export const plusHours = (date, h) => new Date(date.getTime() + h * 3_600_000);
/** n days from now at 10:00 IST. */
export function salesOpenIn(days) {
  const d = new Date(Date.UTC(todayIst.getUTCFullYear(), todayIst.getUTCMonth(), todayIst.getUTCDate() + days));
  return new Date(`${d.toISOString().slice(0, 10)}T10:00:00+05:30`);
}
export const fmtIst = (d) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ') + ' IST';

// ---------------------------------------------------------------- content
export const ORGANIZERS = {
  saptak: { name: 'Meera Iyer', email: `demo-meera@${DOMAIN}`, organization_name: 'Saptak Sound Collective' },
  chaupal: { name: 'Kabir Deshpande', email: `demo-kabir@${DOMAIN}`, organization_name: 'Chaupal Theatre Company' },
  lehar: { name: 'Nikhil Reddy', email: `demo-nikhil@${DOMAIN}`, organization_name: 'Lehar Fest Committee, Godavari Valley Institute of Technology' },
};

// Row helpers. Theatres conventionally skip row I.
export const rows = (from, to) => {
  const out = [];
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) if (c !== 73) out.push(String.fromCharCode(c));
  return out;
};

export const VENUES = {
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

export const rupees = (r) => r * 100;
export const P = (o) => Object.entries(o).map(([category, r]) => ({ category, pricePaise: rupees(r) }));

// fill: fraction of seats sold to demo guests (front rows first).
export const EVENTS = [
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

export const DRAFT_EVENT = {
  key: 'draft', org: 'chaupal', category: 'THEATRE', title: 'A Midsummer Monsoon (work in progress)',
  description: 'A Mumbai-set adaptation of a classic comedy of mistaken lovers, moved to a rain-soaked wedding weekend in Khandala. Casting is still being finalised. This listing is a draft and is not visible to the public yet.',
  shows: [
    { venue: 'rangdeep', start: on('sat', 5, '19:30'), hours: 2.5, prices: P({ VIP: 1499, PREMIUM: 999, REGULAR: 599 }) },
  ],
};

export const CANCELLED_EVENT = {
  key: 'jazz', org: 'saptak', category: 'MUSIC', title: 'Sunset Jazz Quartet',
  description: 'A four-piece jazz ensemble playing standards and originals in an early-evening set. This show was cancelled by the organiser after tickets went on sale. Ticket holders will be refunded.',
  shows: [
    { venue: 'neelgiri', start: on('fri', 1, '19:30'), hours: 2, prices: P({ VIP: 1799, PREMIUM: 1199, REGULAR: 599 }), fill: 0.12 },
  ],
};
