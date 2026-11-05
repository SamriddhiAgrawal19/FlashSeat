import { useMemo } from 'react';
import QRCode from 'qrcode';
import type { Booking, BookingSeat } from '../../lib/api';
import { seatCode } from '../../lib/booking/seats';
import { cn } from '../../lib/cn';
import { formatCategory, formatFullDate, formatPaise, formatTime } from '../../lib/format';

/** The ticket code as a QR code: one SVG path drawn from the module matrix (no network, no innerHTML). */
function QrCode({ value, size = 132 }: { value: string; size?: number }) {
  const { path, count } = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
    let d = '';
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { path: d, count: modules.size };
  }, [value]);
  const quiet = 2;
  return (
    <svg
      role="img"
      aria-label={`QR code for ticket ${value}`}
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`}
      shapeRendering="crispEdges"
      className="block bg-text"
    >
      <path d={path} fill="#0c0c0c" />
    </svg>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="label-mono text-bg/55">{label}</p>
      <p className="mt-1 truncate text-[17px] font-medium tracking-[-0.02em]">{value}</p>
    </div>
  );
}

interface TicketProps {
  booking: Booking;
  seat: BookingSeat;
  /** Cancelled event (REFUND_PENDING / REFUNDED): greyed with a VOID stamp. */
  void?: boolean;
}

/**
 * One seat's ticket: warm-white paper, sharp corners, a dashed perforation with side notches,
 * and a stub with the QR code and ticket code. Stacks vertically on narrow screens.
 */
export function Ticket({ booking, seat, void: isVoid = false }: TicketProps) {
  const code = seat.ticketCode;
  return (
    <article
      aria-label={`Ticket: row ${seat.row}, seat ${seat.number}${isVoid ? ' (void)' : ''}`}
      className={cn('relative flex flex-col overflow-hidden bg-text text-bg md:flex-row', isVoid && 'opacity-55 grayscale')}
    >
      <div className="flex-1 p-6 md:p-8">
        <p className="label-mono flex items-center justify-between gap-4 text-bg/55">
          <span>FlashSeat · Admit one</span>
          <span>{seatCode(seat)}</span>
        </p>
        <h3 className="mt-4 text-title font-medium">{booking.event.title}</h3>
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Field label="Date" value={formatFullDate(booking.show.startsAt) ?? ''} className="col-span-2" />
          <Field label="Time" value={formatTime(booking.show.startsAt) ?? ''} />
          <Field label="Price" value={formatPaise(seat.pricePaise)} />
          <Field label="Venue" value={`${booking.show.venue.name}, ${booking.show.venue.city}`} className="col-span-2" />
          <Field label="Row · Seat" value={`${seat.row} · ${seat.number}`} />
          <Field label="Category" value={formatCategory(seat.category)} />
        </div>
      </div>

      {/* Perforation: dashed rule with a notch cut at each end. */}
      <div aria-hidden="true" className="relative mx-0 h-0 border-t-2 border-dashed border-bg/25 md:h-auto md:w-0 md:border-t-0 md:border-l-2">
        <span className="absolute -top-[13px] -left-3 size-6 rounded-full bg-bg md:-top-3 md:-left-[13px]" />
        <span className="absolute -top-[13px] -right-3 size-6 rounded-full bg-bg md:top-auto md:right-auto md:-bottom-3 md:-left-[13px]" />
      </div>

      <div className="flex items-center gap-5 p-6 md:w-60 md:flex-col md:items-start md:justify-center md:p-8">
        {code && !isVoid ? (
          <QrCode value={code} />
        ) : (
          <div aria-hidden="true" className="grid size-[132px] shrink-0 place-items-center border border-dashed border-bg/30 label-mono text-bg/45">
            No code
          </div>
        )}
        <div className="min-w-0">
          <p className="label-mono text-bg/55">Ticket code</p>
          <p className="mt-1 font-mono text-[12px] leading-snug break-all">{code ?? '—'}</p>
        </div>
      </div>

      {isVoid && (
        <p
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 border-4 border-bg px-5 py-1 font-mono text-[2.5rem] font-bold tracking-[0.2em] text-bg"
        >
          VOID
        </p>
      )}
    </article>
  );
}
