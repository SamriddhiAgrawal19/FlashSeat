import { z } from 'zod';

export const reservationIdParamSchema = z.object({
  reservationId: z.string().uuid('Invalid reservation ID'),
});

export const bookingIdParamSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID'),
});

export const listBookingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
