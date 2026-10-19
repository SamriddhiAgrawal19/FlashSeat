import { z } from 'zod';
import { env } from '../../config/env';

export const idempotencyKeyHeaderSchema = z
  .string({ message: 'Idempotency-Key header is required' })
  .min(8, 'Idempotency-Key must be between 8 and 128 characters')
  .max(128, 'Idempotency-Key must be between 8 and 128 characters')
  .regex(/^[\x20-\x7E]+$/, 'Idempotency-Key must contain only printable ASCII characters');

export const createReservationBodySchema = z.object({
  seatIds: z
    .array(z.string().uuid('Each seatId must be a valid UUID'))
    .min(1, 'seatIds must contain at least 1 seat')
    .max(env.MAX_SEATS_PER_RESERVATION, `Cannot reserve more than ${env.MAX_SEATS_PER_RESERVATION} seats`)
    .refine((seats) => new Set(seats).size === seats.length, {
      message: 'Duplicate seat IDs are not allowed',
    }),
});

export const showIdParamSchema = z.object({
  showId: z.string().uuid('Invalid show ID'),
});

export const reservationIdParamSchema = z.object({
  reservationId: z.string().uuid('Invalid reservation ID'),
});

export type CreateReservationBody = z.infer<typeof createReservationBodySchema>;
