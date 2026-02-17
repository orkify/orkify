import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXAMPLES, IS_WINDOWS } from './setup.js';
import { orkify, sleep, waitForDaemonKilled, waitForProcessOnline } from './test-utils.js';

describe('daemon-crash-recovery', () => {
  const APP_NAME = 'test-crash-recover';
  const DAEMON_PID_FILE = join(homedir(), '.orkify', 'daemon.pid');

  afterAll(() => {
    // Clean up — kill any remaining daemon/processes
    try {
      orkify('down all');
    } catch {
      /* cleanup */
    }
    try {
      orkify('delete all');
    } catch {
      /* cleanup */
    }
    try {
      orkify('kill');
    } catch {
      /* cleanup */
    }
  });

  it.skipIf(IS_WINDOWS)(
    'recovers processes after daemon crash (SIGUSR2)',
    async () => {
      // Start a process
      orkify(`up ${join(EXAMPLES, 'basic', 'app.js')} -n ${APP_NAME}`);
      await waitForProcessOnline(APP_NAME);

      // Read daemon PID
      const daemonPid = parseInt(readFileSync(DAEMON_PID_FILE, 'utf-8').trim(), 10);
      expect(daemonPid).toBeGreaterThan(0);

      // Send SIGUSR2 to trigger an uncaught exception in the daemon
      // (the daemon registers a SIGUSR2 handler that throws for crash testing)
      process.kill(daemonPid, 'SIGUSR2');

      // Wait for daemon to die
      await waitForDaemonKilled(10000);

      // Wait for crash recovery to kick in and restore the process
      await sleep(5000);

      // Verify process is back online
      await waitForProcessOnline(APP_NAME, 15000);

      const list = orkify('list');
      expect(list).toContain(APP_NAME);
      expect(list).toContain('online');

      // Kill daemon so next test gets a fresh one without ORKIFY_CRASH_RECOVERY set
      orkify('kill');
      await waitForDaemonKilled();
    },
    45000
  );

  it('recovers processes after daemon crash (IPC)', async () => {
    // Start a process
    orkify(`up ${join(EXAMPLES, 'basic', 'app.js')} -n ${APP_NAME}`);
    await waitForProcessOnline(APP_NAME);

    // Send CRASH_TEST IPC message to trigger an uncaught exception in the daemon.
    // The handler throws via setTimeout, which exercises the
    // crashRecovery → gracefulShutdown → exit path on all platforms.
    orkify('_crash-test');

    // Wait for daemon to die
    await waitForDaemonKilled(10000);

    // Wait for crash recovery to kick in and restore the process
    await sleep(5000);

    // Verify process is back online
    await waitForProcessOnline(APP_NAME, 15000);

    const list = orkify('list');
    expect(list).toContain(APP_NAME);
    expect(list).toContain('online');
  }, 45000);
});
