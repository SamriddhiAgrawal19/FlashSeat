// Server time from HTTP Date headers, so hold countdowns don't trust the device clock.
//
// A Date header has 1 s resolution: the server's clock read D..D+1s when it wrote the header,
// and that happened somewhere between when we sent the request and when the response arrived
// (both on the device clock). So each response bounds the offset (server - device):
//
//   D - receivedAt  <  offset  <  D + 1000 - sentAt
//
// Intersecting the bounds of every response narrows the window quickly (typically to a few
// hundred ms after a handful of requests). The estimate is the middle of the window. If a new
// sample doesn't overlap the window (the device clock was changed), start again from it.

let lower = Number.NEGATIVE_INFINITY;
let upper = Number.POSITIVE_INFINITY;

/** Feed one response's Date header with the device-clock times around the request. */
export function observeServerDate(dateHeader: string | null, sentAt: number, receivedAt: number): void {
  if (!dateHeader) return;
  const serverMs = Date.parse(dateHeader);
  if (Number.isNaN(serverMs)) return;

  const sampleLower = serverMs - receivedAt;
  const sampleUpper = serverMs + 1000 - sentAt;
  const nextLower = Math.max(lower, sampleLower);
  const nextUpper = Math.min(upper, sampleUpper);
  if (nextLower <= nextUpper) {
    lower = nextLower;
    upper = nextUpper;
  } else {
    lower = sampleLower;
    upper = sampleUpper;
  }
}

/** Estimated server time minus device time, in ms (0 before any response). */
export function clockOffsetMs(): number {
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return 0;
  return Math.round((lower + upper) / 2);
}

/** Uncertainty of the estimate (half the window), in ms; Infinity before any response. */
export function clockUncertaintyMs(): number {
  return (upper - lower) / 2;
}

/** Current server time, estimated, in epoch ms. */
export function serverNow(): number {
  return Date.now() + clockOffsetMs();
}
