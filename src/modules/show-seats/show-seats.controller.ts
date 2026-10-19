import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as showSeatsService from './show-seats.service';
import { pool } from '../../db/pool';

const showIdParamSchema = z.object({
  showId: z.string().uuid(),
});

export async function getSeatMap(req: Request, res: Response, next: NextFunction) {
  try {
    const { showId } = showIdParamSchema.parse(req.params);

    res.setHeader('Cache-Control', 'no-store');

    const result = await showSeatsService.getSeatMap(pool, showId);

    res.json(result);
  } catch (err) {
    next(err);
  }
}
