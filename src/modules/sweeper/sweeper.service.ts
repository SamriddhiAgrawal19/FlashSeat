/**
 * Sweeper service — orchestrates one sweep cycle across all shows with expired state.
 * Imported by the sweeper worker entry point and by tests.
 */
import pino from 'pino';
import { env } from '../../config/env';
import { pool, withTransaction } from '../../db/pool';
import * as repo from './sweeper.repository';

const logger = pino({ name: 'sweeper' });

export interface SweepResult {
  shows: number;
  reservationsExpired: number;
  bookingsExpired: number;
  seatsFreed: number;
  skippedShows: number;
  errors: number;
  /**
   * true when runSweepOnce() did no work because another sweep was already in
   * progress in this process. The zero counts are then NOT evidence that there
   * is nothing left to clean.
   */
  skippedBecauseRunning?: boolean;
}

export interface SweepOptions {
  batchSize?: number;
  maxRunMs?: number;
}

const emptyResult = (): SweepResult => ({
  shows: 0, reservationsExpired: 0, bookingsExpired: 0, seatsFreed: 0, skippedShows: 0, errors: 0,
});

let running = false;

/**
 * Public entry point (worker loop, sweeper-once, tests). Guarded: a call made
 * while this process's previous sweep is still running returns immediately
 * with skippedBecauseRunning=true. The guard is per process only — separate
 * sweeper processes are kept apart by SKIP LOCKED, not by this flag.
 */
export async function runSweepOnce(opts?: SweepOptions): Promise<SweepResult> {
  if (running) {
    logger.debug('Sweep already in progress, skipping');
    return { ...emptyResult(), skippedBecauseRunning: true };
  }
  running = true;
  try {
    return await sweepOnceInternal(opts);
  } finally {
    running = false;
  }
}

/**
 * INTERNAL / TEST-ONLY: the real sweep with NO in-process guard. Production code
 * must call runSweepOnce(). Exported so tests can run two sweeps truly
 * concurrently (the same situation as two sweeper processes).
 */
export async function sweepOnceInternal(opts?: SweepOptions): Promise<SweepResult> {
  const batchSize = opts?.batchSize ?? env.SWEEPER_BATCH_SIZE;
  const maxRunMs = opts?.maxRunMs ?? env.SWEEPER_MAX_RUN_MS;

  const startMs = Date.now();
  const totals = emptyResult();
  // Excluded for the rest of this run: shows drained in one batch, shows whose
  // row was locked by someone else (skipped), and shows that errored. Shows that
  // still had leftovers (a full batch) are NOT excluded so they get processed
  // again until drained or the time budget ends.
  const excludedShowIds: string[] = [];

  outer:
  while (true) {
    if (Date.now() - startMs >= maxRunMs) break;

    // Discover candidate shows outside any transaction (plain read).
    const client = await pool.connect();
    let candidates: string[];
    try {
      candidates = await repo.findShowsWithExpiredState(client, 100, excludedShowIds);
    } finally {
      client.release();
    }

    if (candidates.length === 0) break;

    for (const showId of candidates) {
      if (Date.now() - startMs >= maxRunMs) break outer;

      try {
        await withTransaction(async (txClient) => {
          // 1. Lock show (hierarchy level 3) — SKIP LOCKED so we don't block
          const locked = await repo.lockShowShareSkipLocked(txClient, showId);
          if (!locked) {
            // Someone holds the show FOR UPDATE (e.g. cancelEvent). Leave it for
            // the next cycle; rediscovering it now would spin on it until the
            // time budget runs out and starve every other dirty show.
            totals.skippedShows++;
            excludedShowIds.push(showId);
            return;
          }

          // 2. Lock expired reservations (hierarchy level 4)
          const resIds = await repo.lockExpiredReservations(txClient, showId, batchSize);

          // 3. Lock their pending bookings (hierarchy level 5)
          const bookingIds = await repo.lockPendingBookings(txClient, resIds);

          // 4. Lock expired held seats (hierarchy level 6)
          const seatIds = await repo.lockExpiredHeldSeats(txClient, showId, batchSize);

          // 5. Mutate
          const resExpired = await repo.expireReservations(txClient, resIds);
          const bookExpired = await repo.expireBookings(txClient, bookingIds);
          const freed = await repo.freeSeats(txClient, seatIds);

          totals.shows++;
          totals.reservationsExpired += resExpired;
          totals.bookingsExpired += bookExpired;
          totals.seatsFreed += freed;

          // If nothing was left over (batch not full), exclude from further rounds
          if (resIds.length < batchSize && seatIds.length < batchSize) {
            excludedShowIds.push(showId);
          }
        });
      } catch (err: any) {
        totals.errors++;
        // Lock timeouts (55P03) are expected under contention
        if (err?.code === '55P03') {
          logger.debug({ showId, code: err.code }, 'Lock timeout on show, continuing');
        } else {
          logger.error({ showId, err }, 'Error sweeping show');
        }
        excludedShowIds.push(showId);
      }
    }
  }

  const durationMs = Date.now() - startMs;
  const changed = totals.reservationsExpired + totals.bookingsExpired + totals.seatsFreed;
  if (changed > 0) {
    logger.info({ ...totals, durationMs }, 'Sweep completed');
  } else {
    logger.debug({ ...totals, durationMs }, 'Sweep completed (nothing to do)');
  }

  return totals;
}
