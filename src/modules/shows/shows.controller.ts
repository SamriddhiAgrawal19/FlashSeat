import { Request, Response, NextFunction } from 'express';
import { createShowSchema, eventIdParamSchema, showIdParamSchema } from './shows.schema';
import * as showsService from './shows.service';
import { withTransaction, pool } from '../../db/pool';

export async function createShow(req: Request, res: Response, next: NextFunction) {
  try {
    const { eventId } = eventIdParamSchema.parse(req.params);
    const data = createShowSchema.parse(req.body);
    const userId = req.user!.userId;

    const result = await showsService.createShow(userId, eventId, data);

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getShowDetails(req: Request, res: Response, next: NextFunction) {
  try {
    const { showId } = showIdParamSchema.parse(req.params);
    
    const client = await pool.connect();
    try {
      const result = await showsService.getShowDetails(client, showId);
      res.json(result);
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}
