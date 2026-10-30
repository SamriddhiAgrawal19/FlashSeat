import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().min(1),
  REFRESH_TOKEN_EXPIRY_DAYS: z.coerce.number().positive(),
  HOLD_DURATION_SECONDS: z.coerce.number().int().positive().default(600),
  MAX_SEATS_PER_RESERVATION: z.coerce.number().int().positive().default(6),
  MAX_SEATS_PER_BULK_CALL: z.coerce.number().int().positive().default(2000),
  MAX_SEATS_PER_VENUE: z.coerce.number().int().positive().default(20000),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(1000),
  DB_IDLE_IN_TX_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  SWEEPER_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  SWEEPER_BATCH_SIZE: z.coerce.number().int().positive().default(200),
  SWEEPER_MAX_RUN_MS: z.coerce.number().int().positive().default(10000),
  DB_APPLICATION_NAME: z.string().default('flashseat-api'),
  ENABLE_MOCK_PAYMENT: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .default(false),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  // Redis is advisory everywhere it's used (rate limiting, the seat-map cache);
  // this flag lets rate limiting be switched off without a redeploy if it's
  // ever misbehaving. Both this and ENABLE_SEAT_MAP_CACHE default on — they're
  // the production defaults, enforced for real in the full regression battery
  // (see tests/rate-limit.test.ts and the two tests it names as the only
  // known conflicts: auth.test.ts's login-timing-oracle case paces itself to
  // stay under the login limits, and the seat-map-freshness tests account for
  // the documented staleness window).
  ENABLE_RATE_LIMITING: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .default(true),
  RATE_LIMIT_LOGIN_IP_LIMIT: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_LOGIN_IP_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_LOGIN_EMAIL_LIMIT: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_LOGIN_EMAIL_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  // Real policy: 30 registrations per IP per 60s. That tolerates a modest
  // shared-NAT burst (campus, venue Wi-Fi) while still stopping a scripted
  // signup flood. The local .env sets 400 ONLY because the integration suite
  // registers ~300 users from one IP (127.0.0.1) within a single window — it
  // is a dev/test value, never a production setting (see .env.example).
  RATE_LIMIT_REGISTER_IP_LIMIT: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_REGISTER_IP_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_RESERVATION_USER_LIMIT: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_RESERVATION_USER_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  // Approximate admission cap in front of the reservation/checkout/confirm
  // routes only — see src/middleware/admissionControl.ts for how this number
  // was chosen from the Step 7 load-test numbers (docs: load/RESULTS.md).
  MAX_INFLIGHT_BOOKING_REQUESTS: z.coerce.number().int().positive().default(150),
  INFLIGHT_SAFETY_TTL_SECONDS: z.coerce.number().int().positive().default(10),
  // Seat map is documented (Step 3) as advisory, not authoritative for booking,
  // so caching it briefly can never cause overselling — only a stale read of
  // availability. On by default (the production setting); the flag exists so
  // the cache can be switched off without a redeploy. Tests that read the seat
  // map right after a mutation (hold/confirm) account for the staleness window.
  ENABLE_SEAT_MAP_CACHE: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .default(true),
  SEAT_MAP_CACHE_TTL_MS: z.coerce.number().int().positive().default(2000),
}).refine(
  (data) => !(data.NODE_ENV === 'production' && data.ENABLE_MOCK_PAYMENT),
  {
    message: 'ENABLE_MOCK_PAYMENT cannot be true in production',
    path: ['ENABLE_MOCK_PAYMENT'],
  }
);

// Parse and validate process.env. If it fails, Zod will throw an error and crash the app immediately.
const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;
