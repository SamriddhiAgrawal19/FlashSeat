import { z } from 'zod';
import { env } from '../../config/env';
import { uuidParam } from '../../utils/zod';

export const createVenueSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  city: z.string().min(1),
});

// section / category: trimmed, 1-30 chars, stored uppercase
const seatTag = (fallback: string) => z.string().trim().min(1).max(30).toUpperCase().default(fallback);

// Row labels are stored uppercase, so 'a' and 'A' would be the same row: reject
// any duplicate (exact or case-insensitive) instead of silently merging them.
const rowLabels = z
  .array(z.string().regex(/^[A-Za-z0-9]{1,4}$/, 'Row label must be 1-4 letters or digits').toUpperCase())
  .min(1)
  .superRefine((rows, ctx) => {
    const dupes = [...new Set(rows.filter((r, i) => rows.indexOf(r) !== i))];
    if (dupes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate row labels (case-insensitive): ${dupes.join(', ')}`,
      });
    }
  });

export const bulkSeatsSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('GRID'),
      section: seatTag('MAIN'),
      rows: rowLabels,
      seatsPerRow: z.number().int().min(1).max(500),
      category: seatTag('REGULAR'),
    })
    .refine((d) => d.rows.length * d.seatsPerRow <= env.MAX_SEATS_PER_BULK_CALL, {
      message: `A single bulk call may create at most ${env.MAX_SEATS_PER_BULK_CALL} seats (rows x seatsPerRow)`,
      path: ['seatsPerRow'],
    }),
  z.object({
    mode: z.literal('GENERAL_ADMISSION'),
    section: seatTag('MAIN'),
    count: z.number().int().min(1).max(env.MAX_SEATS_PER_BULK_CALL, {
      message: `A single bulk call may create at most ${env.MAX_SEATS_PER_BULK_CALL} seats`,
    }),
    category: seatTag('REGULAR'),
  }),
]);

export const venueIdParamSchema = z.object({
  venueId: uuidParam('Invalid venue ID'),
});

export type CreateVenueRequest = z.infer<typeof createVenueSchema>;
export type BulkSeatsRequest = z.infer<typeof bulkSeatsSchema>;
