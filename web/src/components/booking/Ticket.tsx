import { useMemo } from 'react';
import QRCode from 'qrcode';
import type { Booking, BookingSeat } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatCategory, formatPaise, formatShowDay, formatTime } from '../../lib/format';
import type { EventPhoto } from './useEventPhoto';

/** The ticket code as a QR code: one SVG path drawn from the module matrix (no network, no innerHTML). */
function QrCode({ value, size = 96 }: { value: string; size?: number }) {
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
      className="bk-qr"
    >
      <path d={path} fill="#08080A" />
    </svg>
  );
}

interface TicketProps {
  booking: Booking;
  seat: BookingSeat;
  photo: EventPhoto | null;
  /** Cancelled event (REFUND_PENDING / REFUNDED): greyed with a VOID stamp. */
  void?: boolean;
  className?: string;
}

/**
 * One seat's ticket (docs/booking-flow-design.html): white card, event photo strip, ADMIT ONE ·
 * CATEGORY, title, date / time / venue, ROW / SEAT / price, a dashed perforation, and the real QR
 * code of the ticket code.
 */
export function Ticket({ booking, seat, photo, void: isVoid = false, className }: TicketProps) {
  const code = seat.ticketCode;
  const when = [formatShowDay(booking.show.startsAt), formatTime(booking.show.startsAt)].filter(Boolean).join(' · ');
  return (
    <article aria-label={`Ticket: row ${seat.row}, seat ${seat.number}${isVoid ? ' (void)' : ''}`} className={cn('bk-ticket', isVoid && 'is-void', className)}>
      <div className="bk-ticket-photo">{photo && <img src={photo.src} alt="" decoding="async" />}</div>
      <div className="bk-ticket-body">
        <span className="bk-ticket-kicker">ADMIT ONE · {formatCategory(seat.category).toUpperCase()}</span>
        <h3 className="bk-ticket-title">{booking.event.title}</h3>
        <span className="bk-ticket-meta">
          {when} · {booking.show.venue.name}, {booking.show.venue.city}
        </span>
        <div className="bk-ticket-facts">
          {new Set(booking.seats.map((s) => s.section)).size > 1 && <span>{seat.section}</span>}
          <span>ROW {seat.row}</span>
          <span>SEAT {seat.number}</span>
          <span>{formatPaise(seat.pricePaise)}</span>
        </div>
      </div>
      <div aria-hidden="true" className="bk-ticket-perf" />
      <div className="bk-ticket-stub">
        {code && !isVoid ? (
          <QrCode value={code} />
        ) : (
          <div aria-hidden="true" className="bk-qr-none">
            NO CODE
          </div>
        )}
        <div className="bk-ticket-code">
          <span>TICKET CODE</span>
          <span>{code ?? '—'}</span>
        </div>
      </div>
      {isVoid && (
        <p aria-hidden="true" className="bk-void">
          VOID
        </p>
      )}
    </article>
  );
}
