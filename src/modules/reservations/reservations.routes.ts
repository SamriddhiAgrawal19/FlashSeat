import { Router } from 'express';
import * as reservationsController from './reservations.controller';
import { requireAuth } from '../../middleware/auth';

export const reservationsRouter = Router();

reservationsRouter.post(
  '/shows/:showId/reservations',
  requireAuth,
  reservationsController.createReservation
);

reservationsRouter.get(
  '/reservations/:reservationId',
  requireAuth,
  reservationsController.getReservation
);

reservationsRouter.delete(
  '/reservations/:reservationId',
  requireAuth,
  reservationsController.deleteReservation
);
