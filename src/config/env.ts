import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRY: z.string().min(1),
  REFRESH_TOKEN_EXPIRY_DAYS: z.coerce.number().positive(),
});

// Parse and validate process.env. If it fails, Zod will throw an error and crash the app immediately.
const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;
