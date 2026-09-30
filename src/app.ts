import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from './db/pool';
import { authRouter } from './modules/auth/auth.routes';
import { requireAuth, requireRole } from './middleware/auth';

export const app = express();

app.use(express.json());
app.use(cookieParser());

app.use('/auth', authRouter);

// Protected test route for verification
app.get('/protected-test', requireAuth, requireRole('ORGANIZER'), (req, res) => {
  res.json({ success: true, message: 'You are an organizer!', user: req.user });
});

// Health check endpoint to verify DB connection
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});
