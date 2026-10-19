import { Request, Response, NextFunction } from 'express';
import {
  reservationIdParamSchema,
  bookingIdParamSchema,
  listBookingsQuerySchema,
} from './bookings.schema';
import * as bookingsService from './bookings.service';

export async function checkout(req: Request, res: Response, next: NextFunction) {
  try {
    const { reservationId } = reservationIdParamSchema.parse(req.params);
    const userId = req.user!.userId;

    const { booking, replayed } = await bookingsService.checkout(userId, reservationId);
    res.status(replayed ? 200 : 201).json({ booking });
  } catch (err) {
    next(err);
  }
}

export async function confirmMock(req: Request, res: Response, next: NextFunction) {
  try {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const userId = req.user!.userId;

    const { booking } = await bookingsService.confirmMockBooking(userId, bookingId);
    res.status(200).json({ booking });
  } catch (err) {
    next(err);
  }
}

export async function getMyBookings(req: Request, res: Response, next: NextFunction) {
  try {
    const query = listBookingsQuerySchema.parse(req.query);
    const userId = req.user!.userId;

    const result = await bookingsService.getMyBookings(userId, query);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const { bookingId } = bookingIdParamSchema.parse(req.params);
    const userId = req.user!.userId;

    const result = await bookingsService.getBooking(userId, bookingId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
