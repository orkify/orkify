import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BIN = join(process.cwd(), 'bin', 'orkify');
const SOCKET_PATH = join(homedir(), '.orkify', 'orkify.sock');

function orkify(args: string): void {
  try {
    execSync(`node ${BIN} ${args}`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'pipe',
    });
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Runs once before the entire integration test suite.
 * Cleans up orphaned processes/daemon from a previous run.
 * Skips cleanup if no daemon socket exists (e.g., unit test runs, fresh CI).
 */
export function setup(): void {
  if (!existsSync(SOCKET_PATH)) return;
  orkify('kill --force');
}

/**
 * Runs once after the entire integration test suite.
 * Cleans up all processes and kills the daemon.
 */
export function teardown(): void {
  if (!existsSync(SOCKET_PATH)) return;
  orkify('kill --force');
}
