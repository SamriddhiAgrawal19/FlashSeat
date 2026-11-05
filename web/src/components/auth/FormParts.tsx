/** Message for errors that aren't about one field. */
export function describeNetworkOrRateLimit(code: string, retryAfterSeconds?: number): string | null {
  if (code === 'RATE_LIMITED') {
    return retryAfterSeconds
      ? `Too many attempts. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`
      : 'Too many attempts. Try again in a moment.';
  }
  if (code === 'NETWORK_ERROR' || code.startsWith('HTTP_5')) return "We couldn't reach FlashSeat. Check your connection and try again.";
  return null;
}
