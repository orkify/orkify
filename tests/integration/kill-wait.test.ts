import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORKIFY_HOME } from './setup.js';
import { orkify, waitForProcessOnline } from './test-utils.js';

/**
 * Tests that `orkify kill` blocks until the daemon process is fully dead.
 * Without this guarantee, `systemctl restart` (ExecStop + ExecStart) races:
 * the new daemon fails to acquire the PID lock or connects to a dying socket.
 */
describe('kill waits for daemon exit', () => {
  let tempDir: string;
  let scriptPath: string;
  const APP_NAME = 'test-kill-wait';

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-kill-wait-')));
    scriptPath = join(tempDir, 'app.js');

    // App with a slow graceful shutdown — widens the race window
    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('ok');
      });
      server.listen(0, () => {});
      process.on('SIGTERM', () => {
        setTimeout(() => server.close(() => process.exit(0)), 1000);
      });
    `
    );
  });

  afterAll(() => {
    orkify('kill');
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('daemon is dead when orkify kill returns', async () => {
    // Start a process and snapshot it
    orkify(`up ${scriptPath} -n ${APP_NAME}`);
    await waitForProcessOnline(APP_NAME);
    orkify('snap');

    // Read the daemon PID before killing
    const pidFile = join(ORKIFY_HOME, 'daemon.pid');
    const daemonPid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    expect(daemonPid).toBeGreaterThan(0);

    // Kill — should block until daemon is fully dead
    orkify('kill');

    // Immediately after kill returns: PID file must be gone
    expect(existsSync(pidFile)).toBe(false);

    // The process must be dead (kill -0 should throw)
    expect(() => process.kill(daemonPid, 0)).toThrow();
  }, 30000);

  it('orkify restore works immediately after orkify kill', async () => {
    // Precondition: previous test left a snapshot file
    const snapshotFile = join(ORKIFY_HOME, 'snapshot.yml');
    expect(existsSync(snapshotFile)).toBe(true);

    // Start fresh, save, kill, restore — no waitForDaemonKilled in between
    orkify(`up ${scriptPath} -n ${APP_NAME}`);
    await waitForProcessOnline(APP_NAME);
    orkify('snap');

    const output = orkify('kill') + '\n' + orkify('restore');

    expect(output).toContain('daemon killed');
    expect(output).toContain('Restored');
    expect(output).toContain(APP_NAME);

    await waitForProcessOnline(APP_NAME);
  }, 30000);

  it('kill --force also waits for daemon exit', async () => {
    const pidFile = join(ORKIFY_HOME, 'daemon.pid');
    // Daemon should be running from previous test
    const daemonPid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);

    orkify('kill --force');

    expect(existsSync(pidFile)).toBe(false);
    expect(() => process.kill(daemonPid, 0)).toThrow();
  }, 30000);
});
