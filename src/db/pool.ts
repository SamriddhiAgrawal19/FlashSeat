import { Pool, PoolClient } from 'pg';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import pino from 'pino';

const logger = pino({ name: 'db' });

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  // Bounded wait for a pooled client / new connection: requests fail fast instead
  // of queueing forever behind a wedged pool.
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
  application_name: env.DB_APPLICATION_NAME,
  // Server-side session guards (pg sends these in the startup packet). Deliberately
  // NOT query_timeout: it only abandons the query client-side and leaves it running
  // on the server.
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
  lock_timeout: env.DB_LOCK_TIMEOUT_MS,
  idle_in_transaction_session_timeout: env.DB_IDLE_IN_TX_TIMEOUT_MS,
});

// Idle client failures (e.g. pg_terminate_backend, DB restart) must log and keep
// the process alive: an unhandled pool 'error' event takes the process down.
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected idle client error on the pool');
});

// pg-pool detaches its own 'error' listener while a client is checked out
// (pg-pool/index.js _acquireClient), so a connection dying mid-request would emit
// an unhandled client 'error' event and crash the process. Keep one listener
// attached for the client's whole life.
pool.on('connect', (client) => {
  client.on('error', (err) => {
    logger.error({ err }, 'Pooled client connection error');
  });
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
  let destroyClient = false;
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
      // An AppError below 500 (SEATS_UNAVAILABLE, INVALID_CREDENTIALS, ...) is an
      // expected answer to the client, not a fault: debug, so that error-level
      // lines only ever mean something actually went wrong.
      if (error instanceof AppError && error.statusCode < 500) {
        logger.debug({ err: error }, 'Transaction failed, rolled back.');
      } else {
        logger.error({ err: error }, 'Transaction failed, rolled back.');
      }
    } catch (rollbackErr) {
      // The connection is suspect (e.g. the backend was terminated mid-flight):
      // destroy it instead of pooling it, and rethrow the ORIGINAL error below.
      destroyClient = true;
      logger.error({ err: rollbackErr }, 'Transaction ROLLBACK failed; destroying client.');
    }
    throw error;
  } finally {
    if (destroyClient) {
      client.release(true);
    } else {
      client.release();
    }
  }
}
