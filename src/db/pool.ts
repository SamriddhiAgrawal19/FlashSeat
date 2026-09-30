import { Pool, PoolClient } from 'pg';
import { env } from '../config/env';
import pino from 'pino';

const logger = pino({ name: 'db' });

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

/**
 * A helper to run a block of database operations within a single transaction.
 * It automatically handles BEGIN, COMMIT, and ROLLBACK, and ensures the client
 * is always released back to the pool, preventing connection leaks.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ err: error }, 'Transaction failed, rolled back.');
    throw error;
  } finally {
    client.release();
  }
}
