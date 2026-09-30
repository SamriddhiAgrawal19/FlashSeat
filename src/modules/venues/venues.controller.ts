import { Request, Response, NextFunction } from 'express';
import { createVenueSchema, bulkSeatsSchema } from './venues.schema';
import * as venuesService from './venues.service';
import { withTransaction } from '../../db/pool';

export async function createVenue(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createVenueSchema.parse(req.body);
    const userId = req.user!.userId;

    const result = await withTransaction(async (client) => {
      return await venuesService.createVenue(client, userId, data);
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function bulkCreateSeats(req: Request, res: Response, next: NextFunction) {
  try {
    const data = bulkSeatsSchema.parse(req.body);
    const userId = req.user!.userId;
    const { venueId } = req.params;

    await withTransaction(async (client) => {
      await venuesService.bulkInsertSeats(client, userId, venueId, data);
    });

    res.status(201).json({ success: true, message: 'Seats generated successfully' });
  } catch (err) {
    next(err);
  }
}

export async function getMyVenues(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;

    const result = await withTransaction(async (client) => {
      return await venuesService.getMyVenues(client, userId);
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}
