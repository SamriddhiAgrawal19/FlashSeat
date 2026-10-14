import { Request, Response, NextFunction } from 'express';
import { createEventSchema, updateEventSchema, listEventsQuerySchema } from './events.schema';
import * as eventsService from './events.service';
import { withTransaction, pool } from '../../db/pool';

export async function createEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createEventSchema.parse(req.body);
    const userId = req.user!.userId;

    const result = await withTransaction(async (client) => {
      return await eventsService.createEvent(client, userId, data);
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateEventSchema.parse(req.body);
    const userId = req.user!.userId;
    const eventId = req.params.eventId as string;

    const result = await withTransaction(async (client) => {
      return await eventsService.updateEvent(client, userId, eventId, data);
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function publishEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const eventId = req.params.eventId as string;

    await withTransaction(async (client) => {
      await eventsService.publishEvent(client, userId, eventId);
    });

    res.json({ success: true, message: 'Event published successfully' });
  } catch (err) {
    next(err);
  }
}

export async function cancelEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const eventId = req.params.eventId as string;

    await withTransaction(async (client) => {
      await eventsService.cancelEvent(client, userId, eventId);
    });

    res.json({ success: true, message: 'Event cancelled successfully' });
  } catch (err) {
    next(err);
  }
}

export async function getEvents(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listEventsQuerySchema.parse(req.query);
    
    // Using pool directly for GET endpoints to avoid full transaction overhead if not needed
    const client = await pool.connect();
    try {
      const result = await eventsService.listPublicEvents(client, query);
      res.json(result);
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

export async function getEventDetails(req: Request, res: Response, next: NextFunction) {
  try {
    const eventId = req.params.eventId as string;
    
    const client = await pool.connect();
    try {
      const result = await eventsService.getPublicEventDetails(client, eventId);
      res.json(result);
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

export async function getMyEvents(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;

    const client = await pool.connect();
    try {
      const result = await eventsService.getMyEvents(client, userId);
      res.json(result);
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}
