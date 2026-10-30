import { Router } from 'express';
import * as reservationsController from './reservations.controller';
import { requireAuth } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rateLimit';
import { admissionGate } from '../../middleware/admissionControl';
import { env } from '../../config/env';

export const reservationsRouter = Router();

// Generous enough for normal retry/idempotency use; tight enough to block
// seat-hold griefing (repeatedly holding and releasing MAX_SEATS_PER_RESERVATION
// seats to deny others).
const reservationUserLimit = rateLimit({
  name: 'reservation-user',
  keyFn: (req) => req.user?.userId ?? null,
  limit: env.RATE_LIMIT_RESERVATION_USER_LIMIT,
  windowSeconds: env.RATE_LIMIT_RESERVATION_USER_WINDOW_SECONDS,
});

reservationsRouter.post(
  '/shows/:showId/reservations',
  requireAuth,
  reservationUserLimit,
  admissionGate,
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
