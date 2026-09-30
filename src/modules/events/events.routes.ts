import { Router } from 'express';
import * as eventsController from './events.controller';
import { requireAuth, requireRole } from '../../middleware/auth';
import { showsRouter } from '../shows/shows.routes';

export const eventsRouter = Router();

// Public routes
eventsRouter.get('/', eventsController.getEvents);
// Protected routes (Organizer only)
eventsRouter.get('/mine', requireAuth, requireRole('ORGANIZER'), eventsController.getMyEvents);
eventsRouter.post('/', requireAuth, requireRole('ORGANIZER'), eventsController.createEvent);

// Public route that takes a param (must be after /mine)
eventsRouter.get('/:eventId', eventsController.getEventDetails);
eventsRouter.patch('/:eventId', requireAuth, requireRole('ORGANIZER'), eventsController.updateEvent);
eventsRouter.post('/:eventId/publish', requireAuth, requireRole('ORGANIZER'), eventsController.publishEvent);
eventsRouter.post('/:eventId/cancel', requireAuth, requireRole('ORGANIZER'), eventsController.cancelEvent);

// Mount shows router under events/:eventId
eventsRouter.use('/:eventId/shows', showsRouter);
