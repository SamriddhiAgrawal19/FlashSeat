import { Router } from 'express';
import * as showSeatsController from './show-seats.controller';

export const showSeatsRouter = Router();

showSeatsRouter.get('/:showId/seats', showSeatsController.getSeatMap);
