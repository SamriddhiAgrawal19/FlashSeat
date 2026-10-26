/**
 * One-shot sweeper — runs a single sweep, prints the result, and exits.
 * Useful for cron-based operation or manual testing.
 */
import './set-app-name'; // must be first — sets DB_APPLICATION_NAME before env/pool load
import '../config/env';
import { pool } from '../db/pool';
import { runSweepOnce } from '../modules/sweeper/sweeper.service';

async function main() {
  try {
    const result = await runSweepOnce();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
