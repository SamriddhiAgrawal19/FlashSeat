import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test FILES share one API server + one database (pg_terminate_backend and
    // row-lock blockers would clobber parallel files), so files run strictly
    // serially. Concurrency *inside* a test is intentional and fine.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Test code that calls src/ directly (the sweeper) uses the production pool,
    // but under its own connection name: terminateApiBackends() kills
    // 'flashseat-api' only, and must never hit the test process's own clients.
    // (dotenv does not override variables that are already set.)
    env: { DB_APPLICATION_NAME: 'flashseat-test' },
  },
});
