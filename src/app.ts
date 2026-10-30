import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from './db/pool';
import { lifecycle } from './utils/lifecycle';
import { authRouter } from './modules/auth/auth.routes';
import { venuesRouter } from './modules/venues/venues.routes';
import { eventsRouter } from './modules/events/events.routes';
import { showSeatsRouter } from './modules/show-seats/show-seats.routes';
import { reservationsRouter } from './modules/reservations/reservations.routes';
import { bookingsRouter } from './modules/bookings/bookings.routes';
import { errorHandler } from './middleware/errorHandler';

export const app = express();

app.use(express.json());
app.use(cookieParser());

app.use('/auth', authRouter);
app.use('/venues', venuesRouter);
app.use('/events', eventsRouter);
app.use('/shows', showSeatsRouter);
app.use('/', reservationsRouter);
app.use('/', bookingsRouter);

// Health check endpoint to verify DB connection
app.get('/health', async (req, res, next) => {
  // 503 while draining so a load balancer takes this instance out of rotation.
  if (lifecycle.shuttingDown) {
    return res.status(503).json({ error: { message: 'Shutting down', code: 'SHUTTING_DOWN' } });
  }
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    // Central mapper turns connection failures into 503; timeouts are bounded by
    // the pool's connection/statement timeouts so this cannot hang.
    next(err);
  }
});

app.use(errorHandler);
