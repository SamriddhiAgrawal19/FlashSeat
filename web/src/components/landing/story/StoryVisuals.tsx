import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { cn } from '../../../lib/cn';

// Illustrative product previews for the "Why FlashSeat" showcase. All data here is
// sample data for the landing page; nothing is interactive or talks to the API.

/** A minimal app screen: hairline frame, a title bar with a mono label, then the content. */
function Screen({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('w-full overflow-hidden rounded-[4px] border border-rule bg-surface', className)}>
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <p className="label-mono text-text-2">{title}</p>
        <p className="label-mono text-text-2">Sample</p>
      </div>
      {children}
    </div>
  );
}

// --- 01 Discover ---------------------------------------------------------------

const DISCOVER_CHIPS = ['All', 'Music', 'Comedy', 'Theatre', 'Sports', 'Workshops', 'Fests'];
// Date blocks instead of photos: they read as a real listing and keep this section free of
// photographs already used by the hero and the category explorer.
const DISCOVER_ROWS: Array<{ day: string; date: string; category: string; title: string; meta: string; price: string }> = [
  { day: 'Fri', date: '13', category: 'Comedy', title: 'Late Night Stand-up', meta: '9:00 PM · The Loft', price: '₹399' },
  { day: 'Sat', date: '14', category: 'Music', title: 'An Evening of Jazz', meta: '8:00 PM · Main Hall', price: '₹499' },
  { day: 'Sat', date: '14', category: 'Workshops', title: 'Wheel & Clay for Beginners', meta: '11:00 AM · Studio 4', price: '₹1,200' },
  { day: 'Sun', date: '15', category: 'Fests', title: 'Riverside Music Festival', meta: '4:00 PM · Riverside Grounds', price: '₹899' },
];

/** 01 · A discovery screen: city, category filters and what's on this weekend. */
export function DiscoverVisual() {
  return (
    <Screen title="Discover · Pune · This weekend">
      <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-rule px-5 py-4">
        {DISCOVER_CHIPS.map((chip, i) => (
          <span
            key={chip}
            className={cn(
              'shrink-0 rounded-[2px] border px-3 py-1 text-[13px]',
              i === 0 ? 'border-lime text-lime' : 'border-rule text-text-2',
            )}
          >
            {chip}
          </span>
        ))}
      </div>
      <ul>
        {DISCOVER_ROWS.map((row) => (
          <li key={row.title} className="flex items-center gap-4 border-b border-rule px-5 py-4 last:border-b-0">
            <div className="flex w-12 shrink-0 flex-col items-center border-r border-rule pr-4">
              <span className="label-mono text-text-2">Dec</span>
              <span className="text-2xl leading-none font-medium tracking-[-0.04em] text-text">{row.date}</span>
              <span className="label-mono mt-0.5 text-text-2">{row.day}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="label-mono text-lime">{row.category}</p>
              <p className="mt-1 truncate text-[17px] font-medium tracking-[-0.02em] text-text">{row.title}</p>
              <p className="label-mono mt-1 truncate text-text-2">{row.meta}</p>
            </div>
            <p className="label-mono hidden shrink-0 text-text sm:block">From {row.price}</p>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

// --- 02 / 03 Seat map ----------------------------------------------------------

const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
// Three blocks per row (left, centre, right) separated by two aisles: seats 1–4, 5–12, 13–16.
const BLOCKS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8, 9, 10, 11, 12],
  [13, 14, 15, 16],
];
const SELECTED = 'D6';
// A fixed scatter of sold seats so the map reads as a real, partly sold show.
const SOLD = new Set([
  'A3', 'A4', 'A7', 'A8', 'A9', 'A10', 'B6', 'B7', 'B11', 'B14', 'C1', 'C8', 'C9', 'C10', 'C15',
  'D2', 'D7', 'D11', 'D12', 'E5', 'E9', 'E10', 'E13', 'E14', 'F3', 'F6', 'F7', 'F8', 'G10', 'G11', 'G16', 'H1', 'H2', 'H8',
]);

type SeatState = 'available' | 'sold' | 'selected';

function seatState(id: string): SeatState {
  if (id === SELECTED) return 'selected';
  return SOLD.has(id) ? 'sold' : 'available';
}

const seatClass: Record<SeatState, string> = {
  available: 'border border-text/35',
  sold: 'bg-text/15',
  selected: 'bg-lime',
};

function Seat({ state, className }: { state: SeatState; className?: string }) {
  return <span className={cn('block aspect-square rounded-t-[4px] rounded-b-[2px]', seatClass[state], className)} />;
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2">
      {(
        [
          ['available', 'Available'],
          ['selected', 'Selected'],
          ['sold', 'Sold'],
        ] as const
      ).map(([state, label]) => (
        <li key={state} className="label-mono flex items-center gap-2 text-text-2">
          <Seat state={state} className="size-3" />
          {label}
        </li>
      ))}
    </ul>
  );
}

function SeatGrid() {
  return (
    <div>
      <div className="mx-auto mb-7 w-3/4 border-t-2 border-text/50 pt-2 text-center">
        <span className="label-mono text-text-2">Stage</span>
      </div>
      <div className="flex flex-col gap-[5px]">
        {ROWS.map((row) => (
          <div key={row} className="flex items-center gap-2">
            <span className="label-mono w-3 shrink-0 text-text-2">{row}</span>
            <div className="flex min-w-0 flex-1 justify-center gap-[clamp(6px,2vw,14px)]">
              {BLOCKS.map((block, b) => (
                <div key={b} className="flex min-w-0 gap-[3px]" style={{ flex: block.length }}>
                  {block.map((n) => (
                    <Seat key={n} state={seatState(`${row}${n}`)} className="min-w-0 flex-1" />
                  ))}
                </div>
              ))}
            </div>
            <span className="label-mono w-3 shrink-0 text-right text-text-2">{row}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 02 · A top-down venue: stage, rows A–H in three blocks, sold seats, one selected seat. */
export function VenueVisual() {
  return (
    <Screen title="Main Hall · Sat 8:00 PM">
      <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,1fr)_11rem] sm:gap-8 sm:p-6">
        <div>
          <SeatGrid />
          <div className="mt-6">
            <Legend />
          </div>
        </div>
        <dl className="grid grid-cols-3 content-start gap-4 border-t border-rule pt-5 sm:grid-cols-1 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
          <div>
            <dt className="label-mono text-text-2">Seat</dt>
            <dd className="mt-1 text-3xl font-medium tracking-[-0.04em] text-lime">D6</dd>
          </div>
          <div>
            <dt className="label-mono text-text-2">Category</dt>
            <dd className="mt-1 text-[17px] text-text">Regular</dd>
          </div>
          <div>
            <dt className="label-mono text-text-2">Price</dt>
            <dd className="mt-1 text-[17px] text-text">₹499</dd>
          </div>
        </dl>
      </div>
    </Screen>
  );
}

/** 03 · The same seats up close: D6 is held for you, D7 was just taken by someone else, with the legend. */
export function ReservedVisual() {
  const rows = ['C', 'D', 'E'] as const;
  const seats = [3, 4, 5, 6, 7, 8, 9];
  return (
    <Screen title="Your selection">
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <div key={row} className="flex items-center justify-center gap-3">
              <span className="label-mono w-3 text-text-2">{row}</span>
              <div className="flex w-full max-w-[24rem] gap-2">
                {seats.map((n) => {
                  const id = `${row}${n}`;
                  return (
                    <span key={id} className="relative w-full max-w-12 min-w-0">
                      <Seat state={seatState(id)} />
                      {id === SELECTED && (
                        <Lock aria-hidden="true" strokeWidth={2.25} className="absolute inset-0 m-auto size-[38%] text-bg" />
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <Legend />
        </div>

        <ul className="mt-5 border-t border-rule">
          <li className="flex items-start gap-4 border-b border-rule py-4">
            <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-lime" />
            <div>
              <p className="text-[17px] font-medium text-text">D6 is reserved for you</p>
              <p className="mt-0.5 text-[15px] text-text-2">Held while you check out. Nobody else can book it.</p>
            </div>
          </li>
          <li className="flex items-start gap-4 py-4">
            <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-text/30" />
            <div>
              <p className="text-[17px] font-medium text-text">D7 was just booked</p>
              <p className="mt-0.5 text-[15px] text-text-2">Someone else got there first, so it's no longer available.</p>
            </div>
          </li>
        </ul>
      </div>
    </Screen>
  );
}

// --- 04 Ticket -------------------------------------------------------------------

const BARS = [3, 1, 2, 1, 1, 3, 2, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3];
// Two half-height mask layers, each with a circle cut out of its outer edge, at the perforation.
const NOTCHES_ROW =
  'radial-gradient(circle 14px at 70% 0, #0000 98%, #000) top / 100% 51% no-repeat, radial-gradient(circle 14px at 70% 100%, #0000 98%, #000) bottom / 100% 51% no-repeat';

function TicketField({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <p className="label-mono opacity-60">{label}</p>
      <p className={cn('mt-1 font-medium', big ? 'text-4xl tracking-[-0.04em]' : 'text-[15px] tracking-[-0.02em]')}>{value}</p>
    </div>
  );
}

/** 04 · A cream e-ticket on the dark page; it fades in when its step is chosen. */
export function TicketVisual({ active }: { active: boolean }) {
  let x = 0;
  const bars = BARS.map((w, i) => {
    const rect = i % 2 === 0 ? <rect key={i} x={x} width={w} height="40" /> : null;
    x += w;
    return rect;
  });

  return (
    <div
      className={cn(
        'flex w-full max-w-[40rem] flex-col bg-text text-bg transition-opacity duration-300 ease-out sm:flex-row sm:[mask:var(--notches)] sm:[-webkit-mask:var(--notches)]',
        active ? 'opacity-100' : 'opacity-0',
      )}
      style={{ ['--notches' as string]: NOTCHES_ROW }}
    >
      <div className="flex flex-col gap-7 p-6 sm:w-[70%] sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <p className="label-mono">FlashSeat · E-ticket</p>
          <p className="label-mono opacity-60">Sample</p>
        </div>
        <div>
          <p className="text-[clamp(1.5rem,2.6vw,2.25rem)] leading-[1.05] font-medium tracking-[-0.04em]">An Evening of Jazz</p>
          <p className="mt-2 text-[15px] opacity-70">Sat, 14 Dec 2026 · 8:00 PM</p>
          <p className="text-[15px] opacity-70">Main Hall, Pune</p>
        </div>
        <div className="grid grid-cols-3 gap-4 border-t border-bg/15 pt-5">
          <TicketField label="Row" value="D" />
          <TicketField label="Seat" value="6" />
          <TicketField label="Category" value="Regular" />
        </div>
      </div>
      <div className="mx-6 border-t-2 border-dashed border-bg/25 sm:mx-0 sm:my-0 sm:border-t-0 sm:border-l-2" />
      <div className="flex flex-1 flex-col justify-between gap-6 p-6 sm:p-7">
        <TicketField label="Seat" value="D6" big />
        <div>
          <svg viewBox={`0 0 ${x} 40`} preserveAspectRatio="none" className="h-12 w-full fill-current" aria-hidden="true">
            {bars}
          </svg>
          <p className="mt-2 font-mono text-[13px] tracking-[0.12em]">FS-7K2Q-D6</p>
        </div>
      </div>
    </div>
  );
}
