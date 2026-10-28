/**
 * FlashSeat — Test B: throughput and latency without artificial seat contention.
 *
 * Each iteration: pick a random show from the 200-show fixture, pick one random
 * seat on it, hold that seat with a unique Idempotency-Key. Seats are spread over
 * 10,000 seats on 200 independent shows, so there is no hot row to fight over.
 * Random collisions on already-held seats show up as 409 SEATS_UNAVAILABLE, and
 * their share grows as the 10,000-seat pool fills up during the run.
 *
 * Users are pre-registered (load/register-users.mjs -> fixtures/tokens-throughput.json):
 * the measured run ONLY calls POST /shows/:showId/reservations. VU n uses token
 * n-1 (one token per VU, 10,000 at peak), so no two in-flight requests share a user.
 *
 * Executor: ramping-vus (closed model). A VU only sends its next request once
 * the previous one has returned, so N active VUs == up to N requests in flight
 * at once. That is literally "10,000 concurrent requests". An arrival-rate
 * executor models "X requests/sec" instead: it keeps starting iterations no
 * matter how slowly the server answers, so its concurrency is an output, not
 * the input we want to control.
 *
 * Thresholds are informational: crossing one makes k6 exit 99, which
 * load/run.mjs reports as "thresholds crossed" without treating the run as broken.
 */
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { reserve } from './lib/reserve.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const RUN_ID = __ENV.RUN_ID || `${Date.now()}`;
const PEAK_VUS = Number(__ENV.PEAK_VUS || 10000);

const shows = new SharedArray('throughput', () => JSON.parse(open('./fixtures/throughput.json')));
const tokens = new SharedArray('tokens', () => JSON.parse(open('./fixtures/tokens-throughput.json')).tokens);

export const options = {
  scenarios: {
    throughput: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: PEAK_VUS }, // ramp up
        { duration: '1m', target: PEAK_VUS }, // hold
        { duration: '30s', target: 0 }, // ramp down
      ],
      // > the 30 s request timeout: every in-flight request finishes or times out
      // (and is counted) instead of being silently interrupted at ramp-down
      gracefulRampDown: '40s',
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    reserve_latency: ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:reserve}': ['p(95)<500', 'p(99)<1000'],
    'http_req_failed{name:reserve}': ['rate<0.01'],
  },
};

export function setup() {
  if (tokens.length < PEAK_VUS) throw new Error(`need >= ${PEAK_VUS} tokens (one per VU), have ${tokens.length}`);
}

export default function () {
  const vu = exec.vu.idInTest;
  const iter = exec.vu.iterationInScenario;
  const token = tokens[(vu - 1) % tokens.length];
  const show = shows[Math.floor(Math.random() * shows.length)];
  const seatId = show.seatIds[Math.floor(Math.random() * show.seatIds.length)];
  reserve(BASE_URL, show.showId, seatId, token, `lt-b-${RUN_ID}-${vu}-${iter}`);
}
