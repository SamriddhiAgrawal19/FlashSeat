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
  },
});
