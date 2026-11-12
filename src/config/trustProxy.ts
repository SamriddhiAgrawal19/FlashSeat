/**
 * Parses TRUST_PROXY into the value Express's `trust proxy` setting takes.
 *
 * Off by default: without a proxy in front, X-Forwarded-For is whatever the client
 * sent, so trusting it would let anyone pick their own rate-limit key. Behind Caddy
 * (docker-compose.prod.yml) it is `1`: trust exactly one hop, so req.ip is the
 * address Caddy saw. Caddy discards a client-supplied X-Forwarded-For and sets its
 * own, and even if a header got through, Express with 1 hop takes only the
 * right-most entry (the one Caddy appended).
 *
 *   "" | "false" | "0"  -> false (ignore X-Forwarded-For; req.ip = socket address)
 *   "true"              -> true  (trust every hop; only safe if every path is a proxy)
 *   "<n>"               -> n     (trust the n closest hops)
 *   anything else       -> passed through: Express's comma-separated list of
 *                          addresses / subnets / names like "loopback, uniquelocal"
 */
export type TrustProxySetting = boolean | number | string;

export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = (raw ?? '').trim();
  if (value === '' || value.toLowerCase() === 'false' || value === '0') return false;
  if (value.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
