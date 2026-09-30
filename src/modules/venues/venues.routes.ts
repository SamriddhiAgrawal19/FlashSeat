import { Router } from 'express';
import * as venuesController from './venues.controller';
import { requireAuth, requireRole } from '../../middleware/auth';

export const venuesRouter = Router();

// Apply auth middleware to all venue routes
venuesRouter.use(requireAuth, requireRole('ORGANIZER'));

venuesRouter.post('/', venuesController.createVenue);
venuesRouter.post('/:venueId/seats/bulk', venuesController.bulkCreateSeats);
venuesRouter.get('/mine', venuesController.getMyVenues);
