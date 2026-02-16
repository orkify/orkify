import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_WINDOWS } from './setup.js';
import {
  httpGet,
  sleep,
  waitForHttpReady,
  waitForProcessOnline,
  waitForProcessRemoved,
  waitForProcessStopped,
  orkify,
} from './test-utils.js';

describe('Graceful Shutdown', () => {
  const appName = 'test-graceful';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-graceful-test-')));
    scriptPath = join(tempDir, 'app.js');

    // Create an app with a slow endpoint that takes 2 seconds
    writeFileSync(
      scriptPath,
      `
        const http = require('http');
        let activeRequests = 0;

        const server = http.createServer((req, res) => {
          if (req.url === '/slow') {
            activeRequests++;
            setTimeout(() => {
              activeRequests--;
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ completed: true }));
            }, 2000);
            return;
          }
          if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', active: activeRequests }));
            return;
          }
          res.writeHead(404);
          res.end();
        });

        server.listen(3008, () => {

        });

        process.on('SIGTERM', () => {
          server.close(() => process.exit(0));
        });
      `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('drains active connections before stopping', async () => {
    // Start the app
    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);

    // Start a slow request
    const slowRequest = fetch('http://localhost:3008/slow')
      .then((r) => r.json())
      .then((data) => ({ completed: data.completed, error: null }))
      .catch((err) => ({ completed: false, error: err.cause?.code || err.code }));

    // Give it time to start
    await sleep(200);

    // Stop the process while request is in flight
    orkify(`down ${appName}`);

    // Graceful shutdown behavior differs by platform:
    // - Linux/macOS: Server.close() waits for active connections to drain
    // - Windows: TCP connections may be reset immediately (ECONNRESET)
    // This is due to differences in how the OS handles socket shutdown
    const result = await slowRequest;
    if (IS_WINDOWS) {
      // On Windows, either graceful completion or connection reset is acceptable
      expect(result.completed || result.error === 'ECONNRESET').toBe(true);
    } else {
      // On Unix, expect graceful drain
      expect(result.completed).toBe(true);
    }
  }, 15000);
});

describe('Auto-Restart on Crash', () => {
  const appName = 'test-auto-restart';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-crash-test-')));
    scriptPath = join(tempDir, 'crasher.js');

    // Create an app that crashes after receiving a specific request
    writeFileSync(
      scriptPath,
      `
        const http = require('http');
        let requestCount = 0;

        const server = http.createServer((req, res) => {
          requestCount++;
          if (req.url === '/crash') {
            res.writeHead(200);
            res.end('crashing...');
            setTimeout(() => process.exit(1), 100);
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ pid: process.pid, requests: requestCount }));
        });

        server.listen(3017, () => {

        });

        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('auto-restarts after process crash', async () => {
    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);

    // Get initial PID
    const { body: before } = await httpGet('http://localhost:3017/');
    const pidBefore = JSON.parse(before).pid;
    expect(pidBefore).toBeGreaterThan(0);

    // Trigger crash
    await httpGet('http://localhost:3017/crash');

    // Wait for auto-restart - process online AND HTTP ready
    await waitForProcessOnline(appName);
    await waitForHttpReady('http://localhost:3017/');

    // Should be back online with different PID
    const { status, body: after } = await httpGet('http://localhost:3017/');
    expect(status).toBe(200);

    const pidAfter = JSON.parse(after).pid;
    expect(pidAfter).toBeGreaterThan(0);
    expect(pidAfter).not.toBe(pidBefore);
  }, 20000);

  it('increments restart counter after crash', async () => {
    // Get current restart count from the list output
    // Fork mode table format: | id | name | mode | ↺ | status | cpu | mem | uptime |
    // Example: | 0  | test-auto-restart | fork | 1 | online | 0.0% | 40.2 MB | 7s |
    let list = orkify('list');

    // Find the restart count (↺ column) - comes after "fork |"
    const beforeMatch = list.match(new RegExp(`${appName}\\s*│\\s*fork\\s*│\\s*(\\d+)`));
    const restartsBefore = beforeMatch ? parseInt(beforeMatch[1], 10) : 0;

    // Trigger another crash
    await httpGet('http://localhost:3017/crash');
    await waitForProcessOnline(appName);

    // Restart counter should have incremented
    list = orkify('list');

    // The list output should show the process is online and has more restarts
    expect(list).toContain(appName);
    expect(list).toContain('online');

    // Verify restart count increased
    const afterMatch = list.match(new RegExp(`${appName}\\s*│\\s*fork\\s*│\\s*(\\d+)`));
    const restartsAfter = afterMatch ? parseInt(afterMatch[1], 10) : 0;
    expect(restartsAfter).toBeGreaterThan(restartsBefore);
  }, 15000);

  it('shows process as online after restart', async () => {
    // Delete and recreate
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    // Create a script that crashes once then stays up
    const crashOncePath = join(tempDir, 'crash-once.js');
    const markerFile = join(tempDir, 'crash-marker');

    // Clean up marker file if it exists
    if (existsSync(markerFile)) {
      rmSync(markerFile);
    }

    writeFileSync(
      crashOncePath,
      `
        const http = require('http');
        const fs = require('fs');
        const markerFile = '${markerFile.replace(/\\/g, '\\\\')}';

        // Check if we've already crashed
        if (!fs.existsSync(markerFile)) {
          fs.writeFileSync(markerFile, 'crashed');
          console.log('First run - crashing');
          process.exit(1);
        }

        console.log('Second run - staying up');
        const server = http.createServer((req, res) => {
          res.writeHead(200);
          res.end('ok');
        });
        server.listen(3019, () => {

        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );

    orkify(`up ${crashOncePath} -n ${appName}`);

    // Wait for crash and restart (with longer timeout as process crashes and restarts)
    await waitForProcessOnline(appName, 15000);

    // Should be online after recovering from crash
    const list = orkify('list');
    expect(list).toContain(appName);
    expect(list).toContain('online');

    // Verify the server is actually responding
    const { status } = await httpGet('http://localhost:3019/');
    expect(status).toBe(200);
  }, 20000);
});

describe('Max Restarts Limit', () => {
  const appName = 'test-max-restarts';
  let tempDir: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-maxrestart-test-')));
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('stops restarting after max-restarts exceeded', async () => {
    // Create a script that crashes after a brief delay (past min-uptime)
    const alwaysCrashScript = join(tempDir, 'always-crash.js');
    writeFileSync(
      alwaysCrashScript,
      `
        console.log('Starting... will crash after 200ms');
        setTimeout(() => {
          console.log('Crashing now');
          process.exit(1);
        }, 200);
      `
    );

    // Start with very low max-restarts
    // min-uptime of 100ms means crashes after 200ms count against the limit
    orkify(
      `up ${alwaysCrashScript} -n ${appName} --max-restarts 3 --min-uptime 100 --restart-delay 200`
    );

    // Wait for it to exhaust all restart attempts and stop
    // (initial start + 3 restarts, each running ~200ms + 200ms delay)
    await waitForProcessStopped(appName, 10000);

    // Should be in stopped/errored state, not online
    const list = orkify('list');
    expect(list).toContain(appName);

    // Should NOT be online after exhausting restarts
    expect(list).not.toMatch(new RegExp(`${appName}.*online`));

    // Should show it's stopped or errored
    expect(list).toMatch(/stopped|errored/i);
  }, 15000);

  it('shows restart count reached limit', () => {
    const list = orkify('list');

    // The restart counter should show the max restarts were attempted
    expect(list).toContain(appName);

    // Find the line with our process
    const lines = list.split('\n');
    const processLine = lines.find((line) => line.includes(appName));
    expect(processLine).toBeDefined();

    // The line should contain "3" for the restart count (↺ column)
    // and "stopped" for the status
    expect(processLine).toMatch(/3.*stopped|stopped.*3/i);
  });
});
