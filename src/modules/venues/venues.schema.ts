import { z } from 'zod';
import { uuidParam } from '../../utils/zod';

export const createVenueSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
});

export const bulkSeatsSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('GRID'),
    section: z.string().default('MAIN'),
    rows: z.array(z.string()).min(1),
    seatsPerRow: z.number().int().positive(),
    category: z.string().default('REGULAR'),
  }),
  z.object({
    mode: z.literal('GENERAL_ADMISSION'),
    section: z.string().default('MAIN'),
    count: z.number().int().positive(),
    category: z.string().default('REGULAR'),
  }),
]);

export const venueIdParamSchema = z.object({
  venueId: uuidParam('Invalid venue ID'),
});

export type CreateVenueRequest = z.infer<typeof createVenueSchema>;
export type BulkSeatsRequest = z.infer<typeof bulkSeatsSchema>;
