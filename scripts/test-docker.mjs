/**
 * FlashSeat — run the test battery against the docker compose stack.
 *
 * The sweeper tests drive runSweepOnce() themselves; a running sweeper container
 * would steal their expired rows (docs/todo.md). So: stop the sweeper container,
 * run `npm test` (extra args are passed through), then start the sweeper again,
 * whether or not the tests passed. Exits with the test run's exit code.
 *
 * Usage:
 *   npm run test:docker
 *   npm run test:docker -- tests/sweeper.test.ts
 *
 * DOCKER_BIN overrides the docker binary, like the other project scripts.
 */
import { spawnSync } from 'node:child_process';

const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';
// shell on Windows so npm.cmd / docker.exe resolve the same way they do in a terminal.
const run = (cmd, args) =>
  spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1;

console.log('[test:docker] stopping the sweeper container...');
if (run(DOCKER_BIN, ['compose', 'stop', 'sweeper']) !== 0) {
  console.error('[test:docker] could not stop the sweeper container; not running tests.');
  process.exit(1);
}

let testStatus = 1;
try {
  testStatus = run('npm', ['test', '--', ...process.argv.slice(2)]);
} finally {
  console.log('[test:docker] starting the sweeper container again...');
  const startStatus = run(DOCKER_BIN, ['compose', 'start', 'sweeper']);
  if (startStatus !== 0) {
    console.error('[test:docker] FAILED to restart the sweeper container: run `docker compose start sweeper`.');
    if (testStatus === 0) testStatus = 1;
  }
}

console.log(`[test:docker] tests ${testStatus === 0 ? 'PASSED' : 'FAILED'}`);
process.exit(testStatus);
