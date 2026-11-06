import type { Booking, ReservationSeat } from '../../lib/api';
import { seatCode } from '../../lib/booking/seats';
import { formatCategory, formatPaise, formatShowDay, formatTime } from '../../lib/format';
import type { ReactNode } from 'react';
import { seatCategoryLabel } from './seatLayout';
import type { EventPhoto } from './useEventPhoto';

/** "PAVILION · " when a booking spans several sections, so "A5" stays unambiguous. */
function sectionPrefix(seats: ReservationSeat[], seat: ReservationSeat): string {
  return new Set(seats.map((s) => s.section)).size > 1 ? `${formatCategory(seat.section)} · ` : '';
}

/** The hold page's seat lines (coral seat tag, category, price) and the total. */
export function SeatLines({ seats, totalPaise }: { seats: ReservationSeat[]; totalPaise: number }) {
  return (
    <div className="bk-lines">
      <ul aria-label={`Your seats · ${seats.length}`}>
        {seats.map((seat) => (
          <li key={seat.id} className="bk-line">
            <span className="bk-line-left">
              <span className="bk-tag" aria-label={`Row ${seat.row}, seat ${seat.number}`}>
                {seatCode(seat)}
              </span>
              <span className="bk-line-cat">
                {sectionPrefix(seats, seat)}
                {seatCategoryLabel(seat.category)}
              </span>
            </span>
            <span>{formatPaise(seat.pricePaise)}</span>
          </li>
        ))}
      </ul>
      <div className="bk-line-total">
        <span>Total</span>
        <span>{formatPaise(totalPaise)}</span>
      </div>
    </div>
  );
}

/** The pay page's order: event photo, title, date · venue, the seats, the total and the clock. */
export function OrderSummary({ booking, photo, onPhotoError, clock }: { booking: Booking; photo: EventPhoto | null; onPhotoError: () => void; clock?: ReactNode }) {
  const when = [formatShowDay(booking.show.startsAt), formatTime(booking.show.startsAt)].filter(Boolean).join(' · ');
  return (
    <section aria-labelledby="order-title" className="bk-order">
      <span className="site-eyebrow">STEP 3 OF 4 · ORDER</span>
      <div className="bk-order-head">
        <div className="bk-thumb">{photo && <img src={photo.src} alt="" onError={onPhotoError} decoding="async" />}</div>
        <div className="bk-order-title">
          <h2 id="order-title">{booking.event.title}</h2>
          <span>
            {when} · {booking.show.venue.name}, {booking.show.venue.city}
          </span>
        </div>
      </div>
      <div className="bk-lines">
        <ul aria-label={`Your seats · ${booking.seats.length}`}>
          {booking.seats.map((seat) => (
            <li key={seat.id} className="bk-line is-plain">
              <span className="bk-line-cat">
                {sectionPrefix(booking.seats, seat)}
                {seatCode(seat)} · {seatCategoryLabel(seat.category)}
              </span>
              <span>{formatPaise(seat.pricePaise)}</span>
            </li>
          ))}
        </ul>
        <div className="bk-line-total is-lg">
          <span>Total</span>
          <span>{formatPaise(booking.totalPaise)}</span>
        </div>
      </div>
      {clock}
    </section>
  );
}
