import { Router } from 'express';
import * as bookingsController from './bookings.controller';
import { requireAuth } from '../../middleware/auth';
import { admissionGate } from '../../middleware/admissionControl';

export const bookingsRouter = Router();

// a) POST /reservations/:reservationId/checkout
bookingsRouter.post(
  '/reservations/:reservationId/checkout',
  requireAuth,
  admissionGate,
  bookingsController.checkout
);

// b) POST /bookings/:bookingId/confirm-mock
bookingsRouter.post(
  '/bookings/:bookingId/confirm-mock',
  requireAuth,
  admissionGate,
  bookingsController.confirmMock
);

// c) GET /bookings/mine (must be registered BEFORE /bookings/:bookingId)
bookingsRouter.get(
  '/bookings/mine',
  requireAuth,
  bookingsController.getMyBookings
);

// d) GET /bookings/:bookingId
bookingsRouter.get(
  '/bookings/:bookingId',
  requireAuth,
  bookingsController.getBooking
);
