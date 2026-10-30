import { app } from './app';
import { env } from './config/env';
import { pool } from './db/pool';
import { redis } from './redis/client';
import { lifecycle } from './utils/lifecycle';
import pino from 'pino';

const logger = pino({ name: 'server' });

const server = app.listen(env.PORT, () => {
  logger.info(`Server is running on port ${env.PORT}`);
});

server.on('error', (err) => {
  logger.fatal({ err }, 'HTTP server error');
  process.exit(1);
});

async function shutdown(exitCode: number) {
  if (lifecycle.shuttingDown) return; // ignore repeated signals / crashes
  lifecycle.shuttingDown = true;
  logger.info('Shutting down server...');

  // Hard deadline: if draining stalls (e.g. a stuck request), force-close and fail.
  const deadline = setTimeout(() => {
    logger.error({ timeoutMs: env.SHUTDOWN_TIMEOUT_MS }, 'Shutdown deadline exceeded; forcing exit');
    server.closeAllConnections();
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);
  deadline.unref();

  server.closeIdleConnections();
  server.close(async (err) => {
    if (err) {
      logger.error({ err }, 'Error during server close');
    } else {
      logger.info('HTTP server closed.');
    }

    try {
      await pool.end();
      logger.info('Database pool closed.');
    } catch (dbErr) {
      logger.error({ err: dbErr }, 'Error during database pool close');
    }

    try {
      await redis.quit();
      logger.info('Redis connection closed.');
    } catch (redisErr) {
      logger.error({ err: redisErr }, 'Error during Redis connection close');
    }

    process.exit(err ? 1 : exitCode);
  });
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandledRejection');
  void shutdown(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  void shutdown(1);
});
