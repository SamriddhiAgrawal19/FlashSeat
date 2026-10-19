import { PoolClient } from 'pg';
import { withTransaction, pool } from '../../db/pool';
import { env } from '../../config/env';
import * as repo from './bookings.repository';
import { ListBookingsQuery } from './bookings.schema';
import {
  NotFoundError,
  ConflictError,
} from '../../utils/errors';
import pino from 'pino';

const logger = pino({ name: 'bookings-service' });

export interface FormattedBookingResponse {
  id: string;
  status: string;
  totalPaise: number;
  createdAt: string;
  confirmedAt: string | null;
  payBefore?: string;
  event: {
    id: string;
    title: string;
  };
  show: {
    id: string;
    startsAt: string;
    venue: {
      name: string;
      city: string;
    };
  };
  seats: Array<{
    id: string;
    section: string;
    row: string;
    number: number;
    category: string;
    pricePaise: number;
    ticketCode?: string;
  }>;
}

function formatBooking(row: repo.BookingDetailRow): FormattedBookingResponse {
  const seats = row.seats.map((s) => {
    const seatObj: FormattedBookingResponse['seats'][0] = {
      id: s.id,
      section: s.section,
      row: s.row,
      number: s.number,
      category: s.category,
      pricePaise: s.pricePaise,
    };
    if (row.status === 'CONFIRMED' && s.ticketCode) {
      seatObj.ticketCode = s.ticketCode;
    }
    return seatObj;
  });

  const resObj: FormattedBookingResponse = {
    id: row.id,
    status: row.status,
    totalPaise: Number(row.total_amount_paise),
    createdAt: new Date(row.created_at).toISOString(),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
    event: {
      id: row.event_id,
      title: row.event_title,
    },
    show: {
      id: row.show_id,
      startsAt: new Date(row.show_starts_at).toISOString(),
      venue: {
        name: row.venue_name,
        city: row.venue_city,
      },
    },
    seats,
  };

  if (row.status === 'PENDING_PAYMENT' && row.reservation_expires_at) {
    resObj.payBefore = new Date(row.reservation_expires_at).toISOString();
  }

  return resObj;
}

/**
 * checkout
 * Creates a PENDING_PAYMENT booking row for an active reservation.
 * Lock order: reservation -> booking -> show_seats (Rule A).
 * Tickets (booking_seats) are NOT inserted here (Rule B).
 */
export async function checkout(
  userId: string,
  reservationId: string
): Promise<{ booking: FormattedBookingResponse; replayed: boolean }> {
  return await withTransaction(async (client) => {
    // 1. SELECT reservation FOR UPDATE (owner check)
    const reservation = await repo.getReservationForCheckout(client, userId, reservationId);
    if (!reservation) {
      throw new NotFoundError('Reservation not found');
    }

    // 2. SELECT booking FOR UPDATE (idempotent double-click safety)
    const existingBooking = await repo.getBookingByReservationForUpdate(client, reservationId);
    if (existingBooking) {
      const detail = await repo.getBookingDetailById(client, existingBooking.id);
      return {
        booking: formatBooking(detail!),
        replayed: true,
      };
    }

    // 3. Verify reservation status and DB clock expiry
    if (!reservation.is_active_valid) {
      let msg = 'Reservation is not active';
      if (reservation.status === 'RELEASED') {
        msg = 'Reservation has been released';
      } else if (reservation.status === 'EXPIRED' || new Date(reservation.expires_at) <= new Date()) {
        msg = 'Reservation has expired';
      }
      throw new ConflictError(msg, 'RESERVATION_NOT_ACTIVE');
    }

    // 4. Verify show bookability using FOR SHARE lock
    const show = await repo.getShowBookableStatus(client, reservation.show_id);
    if (!show || show.event_status === 'DRAFT') {
      throw new NotFoundError('Show not found');
    }
    const isBookable =
      show.status === 'SCHEDULED' &&
      show.event_status === 'PUBLISHED' &&
      show.not_started;

    if (!isBookable) {
      throw new ConflictError('Show is not bookable', 'SHOW_NOT_BOOKABLE');
    }

    // 5. Lock seats in ascending ID order and verify Rule D
    const { seats: lockedSeats, expectedCount } = await repo.lockReservationSeatsInOrder(
      client,
      reservationId
    );

    const isHoldValid =
      lockedSeats.length === expectedCount &&
      expectedCount > 0 &&
      lockedSeats.every(
        (s) => s.status === 'HELD' && s.reservation_id === reservationId && s.hold_valid === true
      );

    if (!isHoldValid) {
      throw new ConflictError('Seat hold has expired or was lost', 'HOLD_LOST');
    }

    // 6. INSERT the booking with status PENDING_PAYMENT (Rule B: do NOT insert booking_seats yet)
    const totalAmountPaise = lockedSeats.reduce((sum, s) => sum + s.price_paise, 0);
    const newBooking = await repo.insertBooking(
      client,
      userId,
      reservation.show_id,
      reservationId,
      totalAmountPaise
    );

    // 7. Return 201 { booking } including payBefore
    const detail = await repo.getBookingDetailById(client, newBooking.id);
    return {
      booking: formatBooking(detail!),
      replayed: false,
    };
  });
}

/**
 * confirmBookingCore
 * Reusable core confirmation logic without ownership checks.
 * In Phase 3, the real payment webhook will call this exact core.
 * Adheres strictly to Global Lock Order: reservation -> booking -> seats.
 */
export async function confirmBookingCore(
  client: PoolClient,
  bookingId: string
): Promise<{ booking: FormattedBookingResponse; replayed: boolean }> {
  // 1. Read (without locking) the booking to get its reservation_id
  const bookingMeta = await repo.findBookingById(client, bookingId);
  if (!bookingMeta) {
    throw new NotFoundError('Booking not found');
  }

  // 2. Lock reservation row FOR UPDATE, then booking row FOR UPDATE (Rule A)
  const reservation = await repo.lockReservationForConfirm(client, bookingMeta.reservation_id);
  if (!reservation) {
    throw new NotFoundError('Reservation not found');
  }

  const booking = await repo.lockBookingForConfirm(client, bookingId);
  if (!booking) {
    throw new NotFoundError('Booking not found');
  }

  // 3. Idempotent replay if already CONFIRMED
  if (booking.status === 'CONFIRMED') {
    const detail = await repo.getBookingDetailById(client, bookingId);
    return {
      booking: formatBooking(detail!),
      replayed: true,
    };
  }

  if (booking.status !== 'PENDING_PAYMENT') {
    throw new ConflictError(
      `Booking is not in payable state (status: ${booking.status})`,
      'BOOKING_NOT_PAYABLE'
    );
  }

  // 4. Reservation must be ACTIVE and expires_at > now()
  if (!reservation.is_active_valid) {
    throw new ConflictError('Hold has expired or is no longer active', 'HOLD_LOST');
  }

  // 5. Lock seats in ID order and verify Rule D
  const { seats: lockedSeats, expectedCount } = await repo.lockReservationSeatsInOrder(
    client,
    booking.reservation_id
  );
  const isRuleDValid =
    lockedSeats.length === expectedCount &&
    expectedCount > 0 &&
    lockedSeats.every(
      (s) => s.status === 'HELD' && s.reservation_id === booking.reservation_id && s.hold_valid === true
    );

  if (!isRuleDValid) {
    throw new ConflictError('Seat hold has expired or was taken over', 'HOLD_LOST');
  }

  const seatIds = lockedSeats.map((s) => s.id);

  try {
    // 6. UPDATE show_seats to BOOKED
    const updatedCount = await repo.markSeatsBooked(client, bookingId, seatIds);
    if (updatedCount !== seatIds.length) {
      throw new Error(
        `Failed to update all seats to BOOKED: expected ${seatIds.length}, updated ${updatedCount}`
      );
    }

    // 7. INSERT INTO booking_seats (the actual tickets created only upon confirmation)
    const insertedTotalPrice = await repo.insertBookingSeats(client, bookingId, seatIds);
    if (insertedTotalPrice !== Number(booking.total_amount_paise)) {
      throw new Error(
        `Ticket price sum (${insertedTotalPrice}) does not match booking total (${booking.total_amount_paise})`
      );
    }

    // 8. UPDATE bookings to CONFIRMED and reservations to CONFIRMED
    await repo.setBookingAndReservationConfirmed(client, bookingId, booking.reservation_id);

    // 9. Return the confirmed booking
    const detail = await repo.getBookingDetailById(client, bookingId);
    return {
      booking: formatBooking(detail!),
      replayed: false,
    };
  } catch (err: any) {
    if (err.code === '23505' && err.constraint === 'uq_one_live_ticket_per_seat') {
      logger.error({ err, bookingId }, 'CRITICAL INVARIANT VIOLATION: uq_one_live_ticket_per_seat collision');
      throw new Error('A live ticket already exists for one of the seats in this booking');
    }
    throw err;
  }
}

/**
 * confirmMockBooking
 * Mock payment confirmation endpoint for developer testing.
 * Strictly verifies ownership, then delegates to confirmBookingCore.
 */
export async function confirmMockBooking(
  userId: string,
  bookingId: string
): Promise<{ booking: FormattedBookingResponse; replayed: boolean }> {
  if (!env.ENABLE_MOCK_PAYMENT) {
    throw new NotFoundError('Endpoint not available');
  }

  return await withTransaction(async (client) => {
    const meta = await repo.findBookingById(client, bookingId);
    if (!meta || meta.user_id !== userId) {
      throw new NotFoundError('Booking not found');
    }

    return await confirmBookingCore(client, bookingId);
  });
}

export async function getBooking(
  userId: string,
  bookingId: string
): Promise<{ booking: FormattedBookingResponse }> {
  const detail = await repo.getBookingDetailById(pool, bookingId);
  if (!detail || detail.user_id !== userId) {
    throw new NotFoundError('Booking not found');
  }
  return {
    booking: formatBooking(detail),
  };
}

export async function getMyBookings(
  userId: string,
  query: ListBookingsQuery
): Promise<{ bookings: FormattedBookingResponse[]; page: number; limit: number; total: number }> {
  const offset = (query.page - 1) * query.limit;
  const { rows, total } = await repo.listUserBookings(pool, userId, query.limit, offset);
  return {
    bookings: rows.map(formatBooking),
    page: query.page,
    limit: query.limit,
    total,
  };
}
