/**
 * Shared k6 helpers: one hold attempt + status bookkeeping.
 *
 * Connection-refused retries: Windows client editions cap the listen backlog, so a
 * burst of new TCP connections can be refused before Express ever sees them (run 1
 * lost 4752/5000 attempts this way). A refused connection carries no request, so
 * retrying it cannot create a second reservation attempt at the application level.
 * Only "connection refused" is retried; a reset or timeout after the request was
 * sent is NOT retried (the server may have processed it) and is counted as-is.
 *
 * Reconnects back off exponentially with full jitter (100 ms doubling to a 5 s
 * cap): a tight retry loop turned a server stall into a ~16k/s reconnect storm in
 * throughput run 2 and starved the API of CPU on the shared machine.
 *
 * Each request has a 30 s client timeout. A status-0 result that was NOT a refused
 * connect (timeout, reset) may still have been processed by the server, so it is
 * counted as reserve_unknown_outcome: the DB check uses it to bound the gap between
 * k6's 201 count and the DB's ACTIVE reservations.
 *
 * reserve_latency records only responses that reached the server (status != 0),
 * so refused-and-retried connects do not drag the latency numbers toward 0 ms.
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const MAX_CONNECT_RETRIES = 30;
const BACKOFF_BASE_S = 0.1;
const BACKOFF_CAP_S = 5;
const REQUEST_TIMEOUT = '30s';

const connectRefusedRetries = new Counter('connect_refused_retries');
const connectGaveUp = new Counter('connect_gave_up');
const reserveLatency = new Trend('reserve_latency', true);

const attempts = new Counter('reserve_attempts'); // requests that reached the server
const c201 = new Counter('reserve_201');
const c200 = new Counter('reserve_200_replay'); // must stay 0: every key is unique
const c409 = new Counter('reserve_409');
const c409Seats = new Counter('reserve_409_SEATS_UNAVAILABLE');
const c409Lock = new Counter('reserve_409_LOCK_TIMEOUT');
const c409Active = new Counter('reserve_409_ACTIVE_RESERVATION_EXISTS');
const c409Other = new Counter('reserve_409_other_code');
const c429 = new Counter('reserve_429');
const c5xx = new Counter('reserve_5xx');
const c503 = new Counter('reserve_503');
const cOther = new Counter('reserve_other'); // other 4xx, or status 0 (gave up / reset / timeout)
const cUnknown = new Counter('reserve_unknown_outcome'); // status 0 that may have reached the server

// 409 is a correct business answer (seat taken, lock timeout, user already holds on
// this show), not a transport failure: keep http_req_failed for everything else.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409));

function errorCode(res) {
  try {
    return res.json('error.code');
  } catch {
    return null;
  }
}

function record(res) {
  const s = res.status;
  if (s === 201) c201.add(1);
  else if (s === 200) c200.add(1);
  else if (s === 409) {
    c409.add(1);
    const code = errorCode(res);
    if (code === 'SEATS_UNAVAILABLE') c409Seats.add(1);
    else if (code === 'LOCK_TIMEOUT') c409Lock.add(1);
    else if (code === 'ACTIVE_RESERVATION_EXISTS') c409Active.add(1);
    else c409Other.add(1, { code: String(code) });
  } else if (s === 429) c429.add(1);
  else if (s >= 500) {
    c5xx.add(1);
    if (s === 503) c503.add(1);
  } else cOther.add(1, { status: String(s) });
}

export function reserve(baseUrl, showId, seatId, token, idempotencyKey) {
  for (let attempt = 0; ; attempt++) {
    const res = http.post(
      `${baseUrl}/shows/${showId}/reservations`,
      JSON.stringify({ seatIds: [seatId] }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
        },
        tags: { name: 'reserve' },
        timeout: REQUEST_TIMEOUT,
      }
    );

    const refused = res.status === 0 && /refused/i.test(res.error || '');
    if (!refused) {
      if (res.status !== 0) {
        attempts.add(1);
        reserveLatency.add(res.timings.duration);
      } else {
        cUnknown.add(1);
      }
      record(res);
      return res;
    }
    if (attempt >= MAX_CONNECT_RETRIES) {
      connectGaveUp.add(1);
      record(res);
      return res;
    }
    connectRefusedRetries.add(1);
    // full-jitter exponential backoff, only after a refused connect
    sleep(Math.random() * Math.min(BACKOFF_CAP_S, BACKOFF_BASE_S * 2 ** attempt));
  }
}
