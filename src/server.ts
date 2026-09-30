import { app } from './app';
import { env } from './config/env';
import { pool } from './db/pool';
import pino from 'pino';

const logger = pino({ name: 'server' });

const server = app.listen(env.PORT, () => {
  logger.info(`Server is running on port ${env.PORT}`);
});

// Graceful shutdown logic
async function shutdown() {
  logger.info('Shutting down server...');
  
  server.close(async (err) => {
    if (err) {
      logger.error({ err }, 'Error during server close');
      process.exitCode = 1;
    } else {
      logger.info('HTTP server closed.');
    }

    try {
      await pool.end();
      logger.info('Database pool closed.');
    } catch (dbErr) {
      logger.error({ err: dbErr }, 'Error during database pool close');
      process.exitCode = 1;
    }

    process.exit();
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
