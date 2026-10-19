import { z } from 'zod';
import { uuidParam } from '../../utils/zod';

export const createEventSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  category: z.string().min(1),
  posterUrl: z.string().url().optional(),
});

export const updateEventSchema = createEventSchema.partial();

export const listEventsQuerySchema = z.object({
  category: z.string().optional(),
  city: z.string().optional(),
  dateFrom: z.string().datetime().optional(), // ISODate string
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export const eventIdParamSchema = z.object({
  eventId: uuidParam('Invalid event ID'),
});

export type CreateEventRequest = z.infer<typeof createEventSchema>;
export type UpdateEventRequest = z.infer<typeof updateEventSchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
