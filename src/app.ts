import express from 'express';
import { pool } from './db/pool';

export const app = express();

app.use(express.json());

// Health check endpoint to verify DB connection
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});
