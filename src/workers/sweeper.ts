/**
 * Sweeper worker entry point — runs runSweepOnce() on a setTimeout chain.
 *
 * Safe to run multiple instances: every lock-acquiring query uses SKIP LOCKED,
 * so two sweepers process disjoint rows without blocking each other.
 */
import './set-app-name'; // must be first — sets DB_APPLICATION_NAME before env/pool load
import { env } from '../config/env';
import { pool } from '../db/pool';
import { runSweepOnce } from '../modules/sweeper/sweeper.service';
import { runPaymentJobsOnce } from '../modules/payments/payment-jobs.service';
import pino from 'pino';

const logger = pino({ name: 'sweeper-worker' });

let stopping = false;
let sweepPromise: Promise<unknown> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule() {
  if (stopping) return;
  timer = setTimeout(async () => {
    timer = null;
    sweepPromise = (async () => {
      try {
        await runSweepOnce();
      } catch (err) {
        // runSweepOnce should never throw (it catches per-show), but just in case
        logger.error({ err }, 'Unexpected error from runSweepOnce');
      }
      // Refund payouts, webhook retries, refund-row discovery (no-op for the mock provider).
      try {
        const r = await runPaymentJobsOnce();
        if (r.refundsProcessed + r.refundsFailedAttempts + r.refundsDiscovered + r.webhooksRetried > 0) {
          logger.info(r, 'Payment jobs completed');
        }
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Unexpected error from runPaymentJobsOnce');
      }
    })();
    await sweepPromise;
    sweepPromise = null;
    schedule();
  }, env.SWEEPER_INTERVAL_MS);
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  logger.info('Shutting down sweeper...');

  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  // Wait for any running sweep to finish (bounded by SHUTDOWN_TIMEOUT_MS)
  if (sweepPromise) {
    const deadline = setTimeout(() => {
      logger.error('Shutdown deadline exceeded; forcing exit');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    deadline.unref();
    await sweepPromise;
    clearTimeout(deadline);
  }

  await pool.end();
  logger.info('Sweeper shut down cleanly.');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'unhandledRejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException');
  process.exit(1);
});

logger.info(
  { intervalMs: env.SWEEPER_INTERVAL_MS, batchSize: env.SWEEPER_BATCH_SIZE, maxRunMs: env.SWEEPER_MAX_RUN_MS },
  'Sweeper worker starting'
);
schedule();
