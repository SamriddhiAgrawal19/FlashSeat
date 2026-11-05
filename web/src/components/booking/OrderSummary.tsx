import type { Booking } from '../../lib/api';
import { seatCode } from '../../lib/booking/seats';
import { formatCategory, formatPaise, formatShowDate } from '../../lib/format';

/** Event, date, venue, the seats with category and price, and the total. */
export function OrderSummary({ booking }: { booking: Booking }) {
  const sections = new Set(booking.seats.map((s) => s.section));
  return (
    <div>
      <p className="label-mono text-text-2">Order summary</p>
      <h2 className="mt-4 text-title font-medium text-text">{booking.event.title}</h2>
      <p className="label-mono mt-3 text-text-2">
        {formatShowDate(booking.show.startsAt)} · {booking.show.venue.name} · {booking.show.venue.city}
      </p>

      <ul className="mt-8 border-t border-rule">
        {booking.seats.map((seat) => (
          <li key={seat.id} className="flex items-baseline justify-between gap-6 border-b border-rule py-4">
            <div className="min-w-0">
              <p className="text-[17px] font-medium tracking-[-0.02em] text-text">
                Row {seat.row}, seat {seat.number}
                <span className="label-mono ml-3 text-text-2">{seatCode(seat)}</span>
              </p>
              <p className="label-mono mt-1 text-text-2">
                {sections.size > 1 ? `${formatCategory(seat.section)} · ` : ''}
                {formatCategory(seat.category)}
              </p>
            </div>
            <p className="font-mono text-[15px] text-text">{formatPaise(seat.pricePaise)}</p>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-6 pt-5">
        <p className="label-mono text-text-2">Total</p>
        <p className="text-title font-medium text-text">{formatPaise(booking.totalPaise)}</p>
      </div>
    </div>
  );
}
