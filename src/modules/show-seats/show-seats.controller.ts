import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as showSeatsService from './show-seats.service';
import { pool } from '../../db/pool';
import { uuidParam } from '../../utils/zod';
import { redis, withRedisFallback } from '../../redis/client';
import { env } from '../../config/env';

const showIdParamSchema = z.object({
  showId: uuidParam('Invalid show ID'),
});

const cacheKey = (showId: string) => `seatmap:${showId}`;

export async function getSeatMap(req: Request, res: Response, next: NextFunction) {
  try {
    const { showId } = showIdParamSchema.parse(req.params);

    res.setHeader('Cache-Control', 'no-store');

    // Advisory cache only: the seat map is already documented (Step 3) as
    // advisory, not authoritative for booking — the hold API always
    // re-checks Postgres regardless of what this cache shows, so a short TTL
    // here can only produce a stale read of availability, never overselling.
    // ENABLE_SEAT_MAP_CACHE=false (and any Redis failure) falls straight
    // through to the DB query below, unchanged from before this step.
    if (env.ENABLE_SEAT_MAP_CACHE) {
      const cached = await withRedisFallback(
        () => redis.get(cacheKey(showId)),
        null,
        'seatmap-cache-get'
      );
      if (cached !== null) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(JSON.parse(cached));
      }
    }

    res.setHeader('X-Cache', 'MISS');
    const result = await showSeatsService.getSeatMap(pool, showId);

    if (env.ENABLE_SEAT_MAP_CACHE) {
      // Best-effort: the response is already decided either way, so a cache
      // write failure must never affect this request.
      void withRedisFallback(
        () => redis.set(cacheKey(showId), JSON.stringify(result), 'PX', env.SEAT_MAP_CACHE_TTL_MS),
        null,
        'seatmap-cache-set'
      );
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}
