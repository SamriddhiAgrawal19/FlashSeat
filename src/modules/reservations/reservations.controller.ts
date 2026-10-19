import { Request, Response, NextFunction } from 'express';
import {
  idempotencyKeyHeaderSchema,
  createReservationBodySchema,
  showIdParamSchema,
  reservationIdParamSchema,
} from './reservations.schema';
import * as reservationsService from './reservations.service';

export async function createReservation(req: Request, res: Response, next: NextFunction) {
  try {
    const { showId } = showIdParamSchema.parse(req.params);
    const idempotencyKey = idempotencyKeyHeaderSchema.parse(req.header('idempotency-key'));
    const { seatIds } = createReservationBodySchema.parse(req.body);
    const userId = req.user!.userId;

    const { reservation, replayed } = await reservationsService.createReservation(
      userId,
      showId,
      idempotencyKey,
      seatIds
    );

    res.status(replayed ? 200 : 201).json({ reservation });
  } catch (err) {
    next(err);
  }
}

export async function getReservation(req: Request, res: Response, next: NextFunction) {
  try {
    const { reservationId } = reservationIdParamSchema.parse(req.params);
    const userId = req.user!.userId;

    const result = await reservationsService.getReservation(userId, reservationId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function deleteReservation(req: Request, res: Response, next: NextFunction) {
  try {
    const { reservationId } = reservationIdParamSchema.parse(req.params);
    const userId = req.user!.userId;

    await reservationsService.releaseReservation(userId, reservationId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
