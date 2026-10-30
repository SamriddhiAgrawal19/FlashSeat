import { z } from 'zod';
import { env } from '../../config/env';
import { uuidParam } from '../../utils/zod';

export const idempotencyKeyHeaderSchema = z
  .string({ message: 'Idempotency-Key header is required' })
  .min(8, 'Idempotency-Key must be between 8 and 128 characters')
  .max(128, 'Idempotency-Key must be between 8 and 128 characters')
  .regex(/^[\x20-\x7E]+$/, 'Idempotency-Key must contain only printable ASCII characters');

export const createReservationBodySchema = z.object({
  seatIds: z
    .array(uuidParam('Each seatId must be a valid UUID'))
    .min(1, 'seatIds must contain at least 1 seat')
    .max(env.MAX_SEATS_PER_RESERVATION, `Cannot reserve more than ${env.MAX_SEATS_PER_RESERVATION} seats`)
    // Element transform runs first, so dedupe sees normalized (lowercase) ids.
    .refine((seats) => new Set(seats).size === seats.length, {
      message: 'Duplicate seat IDs are not allowed',
    }),
});

export const showIdParamSchema = z.object({
  showId: uuidParam('Invalid show ID'),
});

export const reservationIdParamSchema = z.object({
  reservationId: uuidParam('Invalid reservation ID'),
});
