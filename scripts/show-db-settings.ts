import { pool } from '../src/db/pool';

// Whitelisted setting names only — never interpolate user input here.
const SETTINGS = [
  'statement_timeout',
  'lock_timeout',
  'idle_in_transaction_session_timeout',
  'application_name',
];

async function main() {
  const client = await pool.connect();
  try {
    for (const setting of SETTINGS) {
      const result = await client.query(`SHOW ${setting}`);
      console.log(`${setting} = ${result.rows[0][setting]}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
