import { z } from 'zod';
import { uuidParam } from '../../utils/zod';

export const reservationIdParamSchema = z.object({
  reservationId: uuidParam('Invalid reservation ID'),
});

export const bookingIdParamSchema = z.object({
  bookingId: uuidParam('Invalid booking ID'),
});

export const listBookingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
