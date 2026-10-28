/**
 * FlashSeat — Test A: correctness under maximum contention.
 *
 * 1000 VUs share 5000 iterations against ONE show with 100 seats. Each iteration
 * picks one random seat and tries to hold it exactly once with a unique
 * Idempotency-Key. Expected: exactly 100 holds succeed (201), every other attempt
 * is a clean 409, and the DB ends with exactly 100 HELD seats / 100 ACTIVE
 * reservations for the show.
 *
 * Users are pre-registered (load/register-users.mjs -> fixtures/tokens-contention.json)
 * so the measured run ONLY calls POST /shows/:showId/reservations. Token sizing:
 * VU n always uses token n-1, and a VU runs its iterations one after another, so
 * no two in-flight requests ever share a token. 1000 VUs need 1000 tokens; the
 * fixture has 1200 so a VU-count bump does not silently start sharing tokens.
 * A user that already won a seat gets 409 ACTIVE_RESERVATION_EXISTS on its later
 * attempts (one ACTIVE hold per user per show), which is also a correct rejection.
 *
 * No sleeps (except a jittered reconnect after a refused TCP connect, see
 * lib/reserve.js), no thresholds that abort.
 *
 * Run via `npm run load:contention` (load/run.mjs), which also runs the DB check.
 */
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { reserve } from './lib/reserve.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const RUN_ID = __ENV.RUN_ID || `${Date.now()}`;

const fixture = new SharedArray('contention', () => JSON.parse(open('./fixtures/contention.json')));
const tokens = new SharedArray('tokens', () => JSON.parse(open('./fixtures/tokens-contention.json')).tokens);
const SHOW = fixture[0];

export const options = {
  scenarios: {
    contention: {
      executor: 'shared-iterations',
      vus: 1000,
      iterations: 5000,
      maxDuration: '2m',
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  // Always-passing threshold: never aborts, only forces the per-endpoint sub-metric
  // into the end-of-run summary.
  thresholds: {
    'http_req_duration{name:reserve}': ['max>=0'],
  },
};

export function setup() {
  if (tokens.length < 1000) throw new Error(`need >= 1000 tokens (one per VU), have ${tokens.length}`);
}

export default function () {
  const vu = exec.vu.idInTest;
  const iter = exec.scenario.iterationInTest;
  const token = tokens[(vu - 1) % tokens.length];
  const seatId = SHOW.seatIds[Math.floor(Math.random() * SHOW.seatIds.length)];
  reserve(BASE_URL, SHOW.showId, seatId, token, `lt-a-${RUN_ID}-${vu}-${iter}`);
}
