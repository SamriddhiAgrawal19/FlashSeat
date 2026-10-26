import { PoolClient } from 'pg';
import { withTransaction, pool } from '../../db/pool';
import { env } from '../../config/env';
import * as repo from './reservations.repository';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  UnprocessableEntityError,
} from '../../utils/errors';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FormattedReservation {
  id: string;
  showId: string;
  status: string;
  expiresAt: string;
  seats: Array<{
    id: string;
    section: string;
    row: string;
    number: number;
    category: string;
    pricePaise: number;
  }>;
  totalPricePaise: number;
}

export interface CreateReservationResult {
  reservation: FormattedReservation;
  replayed: boolean;
}

function sortSeatsInRowOrder<T extends { section: string; row_label: string; seat_number: number }>(
  seats: T[]
): T[] {
  return [...seats].sort((a, b) => {
    if (a.section !== b.section) return a.section.localeCompare(b.section);
    if (a.row_label.length !== b.row_label.length) return a.row_label.length - b.row_label.length;
    if (a.row_label !== b.row_label) return a.row_label.localeCompare(b.row_label);
    return a.seat_number - b.seat_number;
  });
}

function formatReservationDetails(rows: repo.ReservationSeatDetailRow[]): FormattedReservation {
  const first = rows[0];
  let totalPricePaise = 0;
  const seats = rows.map((r) => {
    totalPricePaise += r.price_paise;
    return {
      id: r.seat_id,
      section: r.section,
      row: r.row_label,
      number: r.seat_number,
      category: r.category,
      pricePaise: r.price_paise,
    };
  });

  return {
    id: first.id,
    showId: first.show_id,
    status: first.effective_status,
    expiresAt: new Date(first.expires_at).toISOString(),
    seats,
    totalPricePaise,
  };
}

// Shared by both replay branches: payload equality first (422), then liveness.
// A replay only succeeds while the hold is live — after a dead hold the client
// must use a NEW Idempotency-Key to hold seats again.
function assertReplayIsLive(existing: { effective_status: string }): void {
  if (existing.effective_status !== 'ACTIVE') {
    throw new ConflictError('Reservation is not active', 'RESERVATION_NOT_ACTIVE', {
      status: existing.effective_status,
    });
  }
}

type ExistingReservation = NonNullable<Awaited<ReturnType<typeof repo.findReservationByKey>>>;

// Replay of a reservation already created under this Idempotency-Key: the same
// show and seat set (else 422), and still live (else 409).
async function replayExisting(
  client: PoolClient,
  userId: string,
  showId: string,
  seatIds: string[],
  existing: ExistingReservation
): Promise<CreateReservationResult> {
  const requestedSorted = [...seatIds].sort();
  const existingSorted = [...existing.seat_ids].sort();
  const isSameSeatSet =
    requestedSorted.length === existingSorted.length &&
    requestedSorted.every((id, idx) => id === existingSorted[idx]);

  if (existing.show_id !== showId || !isSameSeatSet) {
    throw new UnprocessableEntityError(
      'Idempotency key already used for a different reservation request',
      'IDEMPOTENCY_KEY_REUSED'
    );
  }

  assertReplayIsLive(existing);

  const details = await repo.getReservationWithSeats(client, userId, existing.id);
  return {
    reservation: formatReservationDetails(details),
    replayed: true,
  };
}

// Re-checks after a uq_one_active_reservation violation (see step 4).
const KEY_RECHECK_ATTEMPTS = 3;
const KEY_RECHECK_DELAY_MS = 20;

export async function createReservation(
  userId: string,
  showId: string,
  idempotencyKey: string,
  seatIds: string[]
): Promise<CreateReservationResult> {
  return await withTransaction(async (client) => {
    // 1. Check existing reservation by idempotency key
    const existing = await repo.findReservationByKey(client, userId, idempotencyKey);
    if (existing) {
      return replayExisting(client, userId, showId, seatIds, existing);
    }

    // 2. Verify show bookability using DB clock and FOR SHARE lock
    const show = await repo.getShowForBooking(client, showId);
    if (!show || show.event_status === 'DRAFT') {
      throw new NotFoundError('Show not found');
    }

    const isBookable =
      show.status === 'SCHEDULED' &&
      show.event_status === 'PUBLISHED' &&
      show.not_started &&
      show.sales_open;

    if (!isBookable) {
      throw new ConflictError('Show is not available for booking', 'SHOW_NOT_BOOKABLE');
    }

    // 3. Mark user's stale active reservations for this show as EXPIRED
    await repo.expireStaleActiveReservations(client, userId, showId);

    // 4. Insert reservation (claims idempotency key & validates active constraint early).
    // ON CONFLICT (user_id, idempotency_key) only absorbs a conflict on that index. A
    // concurrent request with the SAME key can instead hit uq_one_active_reservation
    // first (its row is checked against that index before it is visible in the key
    // index), which raises 23505. The savepoint keeps the transaction usable so we
    // can re-check by key: found => it is our own twin, replay it; still not found
    // => a genuinely different active hold => ACTIVE_RESERVATION_EXISTS.
    let res: Awaited<ReturnType<typeof repo.insertReservation>>;
    await client.query('SAVEPOINT claim_reservation');
    try {
      res = await repo.insertReservation(client, userId, showId, idempotencyKey, env.HOLD_DURATION_SECONDS);
      await client.query('RELEASE SAVEPOINT claim_reservation');
    } catch (err: any) {
      if (!(err.code === '23505' && err.constraint === 'uq_one_active_reservation')) throw err;
      await client.query('ROLLBACK TO SAVEPOINT claim_reservation');

      // The violation is raised only after the conflicting row committed, so a fresh
      // read normally sees it at once; the short bounded retry is a safety margin.
      for (let attempt = 1; attempt <= KEY_RECHECK_ATTEMPTS; attempt++) {
        const twin = await repo.findReservationByKey(client, userId, idempotencyKey);
        if (twin) return replayExisting(client, userId, showId, seatIds, twin);
        if (attempt < KEY_RECHECK_ATTEMPTS) await sleep(KEY_RECHECK_DELAY_MS);
      }
      throw new ConflictError('Finish or release your current hold for this show first', 'ACTIVE_RESERVATION_EXISTS');
    }

    if (!res) {
      // A concurrent request with the same key won: re-run findReservationByKey & verify payload
      const concurrentExisting = await repo.findReservationByKey(client, userId, idempotencyKey);
      if (concurrentExisting) {
        return replayExisting(client, userId, showId, seatIds, concurrentExisting);
      }
      throw new ConflictError('Concurrent reservation conflict occurred');
    }

    // 5. Lock seats in consistent ascending ID order to prevent deadlocks
    const sortedIds = [...seatIds].sort();
    const lockedRows = await repo.lockSeatsInOrder(client, showId, sortedIds);
    if (lockedRows.length !== seatIds.length) {
      throw new ValidationError('Some seats do not belong to this show');
    }

    // 6. Check availability (available or expired hold)
    const unavailable = lockedRows.filter((r) => !r.is_available);
    if (unavailable.length > 0) {
      throw new ConflictError('Selected seats are no longer available', 'SEATS_UNAVAILABLE', {
        unavailableSeatIds: unavailable.map((r) => r.id),
      });
    }

    // 7. Update seats to HELD and insert junction records
    const heldCount = await repo.holdSeats(client, res.id, res.expires_at, sortedIds);
    if (heldCount !== seatIds.length) {
      throw new Error(`Failed to hold all seats: expected ${seatIds.length}, held ${heldCount}`);
    }
    await repo.insertReservationSeats(client, res.id, sortedIds);

    // 8. Format return payload with seats in row order
    const sortedSeats = sortSeatsInRowOrder(lockedRows);
    let totalPricePaise = 0;
    const seats = sortedSeats.map((s) => {
      totalPricePaise += s.price_paise;
      return {
        id: s.id,
        section: s.section,
        row: s.row_label,
        number: s.seat_number,
        category: s.category,
        pricePaise: s.price_paise,
      };
    });

    return {
      reservation: {
        id: res.id,
        showId,
        status: res.status,
        expiresAt: new Date(res.expires_at).toISOString(),
        seats,
        totalPricePaise,
      },
      replayed: false,
    };
  });
}

export async function getReservation(userId: string, reservationId: string): Promise<{ reservation: FormattedReservation }> {
  const rows = await repo.getReservationWithSeats(pool, userId, reservationId);
  if (!rows || rows.length === 0) {
    throw new NotFoundError('Reservation not found');
  }
  return {
    reservation: formatReservationDetails(rows),
  };
}

export async function releaseReservation(userId: string, reservationId: string): Promise<void> {
  await withTransaction(async (client) => {
    // 0. Plain (non-locking) SELECT of show_id (owner check)
    const ref = await repo.getReservationOwnerShow(client, userId, reservationId);
    if (!ref) {
      throw new NotFoundError('Reservation not found');
    }

    // 1. Lock the show row FOR SHARE — only to respect the lock hierarchy
    // (show -> reservation -> booking -> seats); release never requires a
    // bookable show.
    await repo.lockShowForRelease(client, ref.show_id);

    // 2. Lock reservation row FOR UPDATE
    const reservation = await repo.getReservationForUpdate(client, userId, reservationId);
    if (!reservation) {
      throw new NotFoundError('Reservation not found');
    }

    // 3. Lock booking row of this reservation FOR UPDATE (enforcing lock hierarchy: reservation -> booking)
    const booking = await repo.getBookingByReservationForUpdate(client, reservationId);

    // 4. Paid / confirmed reservations cannot be released this way
    if (reservation.status === 'CONFIRMED') {
      throw new ConflictError('Cannot release a confirmed reservation', 'CANNOT_RELEASE_CONFIRMED');
    }

    // 5. Status RELEASED or EXPIRED -> return (idempotent 204)
    if (reservation.status === 'RELEASED' || reservation.status === 'EXPIRED') {
      return;
    }

    // 6. Status ACTIVE -> lock held seats in ID order, set AVAILABLE, mark reservation RELEASED, cancel pending booking
    if (reservation.status === 'ACTIVE') {
      await repo.lockHeldSeatsForReservation(client, reservationId);
      await repo.releaseHeldSeats(client, reservationId);
      await repo.setReservationReleased(client, reservationId);

      if (booking && booking.status === 'PENDING_PAYMENT') {
        await repo.cancelPendingBooking(client, booking.id);
      }
      return;
    }

    // 7. Any other status -> ConflictError
    throw new ConflictError(
      `Cannot release a reservation with status ${reservation.status}`,
      'CANNOT_RELEASE_RESERVATION'
    );
  });
}
