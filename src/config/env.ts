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
