import { Router } from 'express';
import * as showsController from './shows.controller';
import { requireAuth, requireRole } from '../../middleware/auth';

export const showsRouter = Router({ mergeParams: true }); // mergeParams needed to access eventId

showsRouter.post('/', requireAuth, requireRole('ORGANIZER'), showsController.createShow);
showsRouter.get('/:showId', showsController.getShowDetails);
