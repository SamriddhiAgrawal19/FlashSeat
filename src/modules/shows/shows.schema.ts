import { z } from 'zod';

export const createShowSchema = z.object({
  venueId: z.string().uuid(),
  startsAt: z.string().datetime(), // ISODate string
  endsAt: z.string().datetime(),
  salesOpenAt: z.string().datetime().optional(),
  categoryPrices: z.array(z.object({
    category: z.string().min(1),
    pricePaise: z.number().int().nonnegative(),
  })).min(1).refine(
    (prices) => {
      const categories = prices.map(p => p.category);
      return new Set(categories).size === categories.length;
    },
    {
      message: 'Duplicate category in prices',
    }
  ),
}).refine(data => new Date(data.endsAt) > new Date(data.startsAt), {
  message: 'endsAt must be after startsAt',
  path: ['endsAt']
});

export type CreateShowRequest = z.infer<typeof createShowSchema>;
