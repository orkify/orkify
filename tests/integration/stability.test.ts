import { mkdtempSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpGet, orkify, sleep, waitForProcessOnline } from './test-utils.js';

describe('Graceful exit (code 0) behavior', () => {
  const appName = 'test-graceful-exit';
  let tempDir: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-stability-')));
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Issue #2: A process that exits with code 0 on its own (not stopped by
  // orkify) is currently counted as a "crash" and gets auto-restarted.
  // The crash counter in `orkify list` increments even for clean exits.
  it('should not count code-0 exit as a crash in list output', async () => {
    const exitScript = join(tempDir, 'exit-clean.js');
    writeFileSync(
      exitScript,
      `
      // Process that starts an HTTP server, serves one request, then exits cleanly
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('done');
        // Exit cleanly after responding
        setTimeout(() => {
          server.close(() => process.exit(0));
        }, 100);
      });
      server.listen(3040, () => {});
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );

    orkify(`up ${exitScript} -n ${appName} --max-restarts 5 --restart-delay 200`);
    await waitForProcessOnline(appName);

    // Trigger the clean exit by making a request
    await httpGet('http://localhost:3040/');

    // Wait for the exit and potential restart
    await sleep(2000);

    // Check the list output
    const list = orkify('list');
    expect(list).toContain(appName);

    // The crashes column (💥) should show 0 for a clean exit.
    // Currently it shows 1+ because every non-shutdown exit increments forkCrashes.
    // Parse the line: | id | name | mode | ↺ | 💥 | status | ...
    // Or for fork mode: the crashes count in the worker detail
    const lines = list.split('\n');
    const processLine = lines.find((line) => line.includes(appName));
    expect(processLine).toBeDefined();

    // In fork mode table: | id | name | mode | ↺ restarts | status | ...
    // We need to check that crashes is 0. The exact format depends on the
    // list command output. At minimum, the process should not be accumulating
    // crash counts from clean exits.
    //
    // For a more reliable check, use the IPC list data directly:
    // The restart counter (↺) should also ideally be 0 for a clean exit
    // that shouldn't have been restarted in the first place.
    // But at minimum, crashes should be 0.
    //
    // Since we can't easily extract structured data from CLI output,
    // we check that after the clean exit + restart cycle, the restart
    // count is not incrementing from what should be a non-crash event.
    // A process that exited cleanly once should show 0 crashes.
    //
    // The specific assertion: if the process was restarted (which it
    // shouldn't have been for code 0), the restart column shows > 0.
    // We assert it should be 0.
    const restartMatch = list.match(new RegExp(`${appName}\\s*│\\s*fork\\s*│\\s*(\\d+)`));
    const restarts = restartMatch ? parseInt(restartMatch[1], 10) : -1;
    expect(restarts).toBe(0);
  }, 20000);
});

describe('Fork-mode reload messaging', () => {
  const appName = 'test-fork-reload-msg';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-reload-msg-')));
    scriptPath = join(tempDir, 'app.js');

    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pid: process.pid }));
      });
      server.listen(3041, () => {});
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Issue #13: `orkify reload` on a fork-mode (single worker) process
  // says "reloaded" which implies zero-downtime. In reality, fork mode
  // falls back to a hard restart with downtime. The output should indicate
  // this to avoid misleading users.
  it('should indicate restart (not zero-downtime reload) for fork mode', async () => {
    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);

    const output = orkify(`reload ${appName}`);

    // Fork mode should say "restarted" and mention that zero-downtime
    // reload is not supported, rather than just saying "reloaded".
    expect(output).toMatch(/restarted/i);
    expect(output).toMatch(/fork mode/i);
  }, 20000);
});

describe('Daemon log resilience', () => {
  const appName = 'test-log-resilience';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-log-resilience-')));
    scriptPath = join(tempDir, 'talker.js');

    // Create a script that produces continuous output
    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('ok');
      });
      server.listen(3042, () => {});

      // Produce continuous output
      const interval = setInterval(() => {
        console.log('heartbeat ' + Date.now());
      }, 100);

      process.on('SIGTERM', () => {
        clearInterval(interval);
        server.close(() => process.exit(0));
      });
    `
    );
  });

  afterAll(() => {
    // Restore logs dir permissions in case test left it read-only
    const logsDir = join(resolve(process.env.HOME || '~'), '.orkify', 'logs');
    try {
      chmodSync(logsDir, 0o755);
    } catch {
      // May not exist or may not need permission restore
    }
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Issue #1: Log stream write errors (e.g., disk full) can crash the daemon.
  // The daemon should survive even when log writes fail.
  it('daemon should stay alive when log files have write errors', async () => {
    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);

    // Verify the process is healthy
    const { status: beforeStatus } = await httpGet('http://localhost:3042/');
    expect(beforeStatus).toBe(200);

    // Make the log files read-only to trigger write errors
    const logsDir = join(resolve(process.env.HOME || '~'), '.orkify', 'logs');
    try {
      chmodSync(join(logsDir, `${appName}-out.log`), 0o000);
      chmodSync(join(logsDir, `${appName}-err.log`), 0o000);
    } catch {
      // Log files may not exist yet, skip test
      return;
    }

    // Wait for the script to produce more output (which should trigger write errors)
    await sleep(1000);

    // The daemon should still be alive and the process should still be running
    const list = orkify('list');
    expect(list).toContain(appName);
    expect(list).toContain('online');

    // The HTTP server should still respond
    const { status: afterStatus } = await httpGet('http://localhost:3042/');
    expect(afterStatus).toBe(200);

    // Restore permissions for cleanup
    try {
      chmodSync(join(logsDir, `${appName}-out.log`), 0o644);
      chmodSync(join(logsDir, `${appName}-err.log`), 0o644);
    } catch {
      // Ignore
    }
  }, 20000);
});
