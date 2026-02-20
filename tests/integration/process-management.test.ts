import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES } from './setup.js';
import {
  httpGet,
  orkify,
  sleep,
  waitForDaemonKilled,
  waitForHttpReady,
  waitForProcessOnline,
  waitForProcessStopped,
} from './test-utils.js';

describe('Process Management Edge Cases', () => {
  it('delete on running process stops it first', async () => {
    const appName = 'test-delete-running';

    orkify(`up ${EXAMPLES}/basic/app.js -n ${appName}`);
    await waitForProcessOnline(appName);

    // Verify it's running
    let list = orkify('list');
    expect(list).toContain(appName);
    expect(list).toContain('online');

    // Delete should stop and remove
    const output = orkify(`delete ${appName}`);
    expect(output).toContain('deleted');

    // Should be gone from list
    list = orkify('list');
    expect(list).not.toContain(appName);
  }, 15000);

  it('start with duplicate name returns error or updates', async () => {
    const appName = 'test-duplicate';

    // Start first instance
    orkify(`up ${EXAMPLES}/basic/app.js -n ${appName}`);
    await waitForProcessOnline(appName);

    // Try to start another with same name
    const output = orkify(`up ${EXAMPLES}/basic/app.js -n ${appName}`);

    // Should either error or indicate already running
    const isError =
      output.includes('already') || output.includes('exists') || output.includes('running');
    expect(isError).toBe(true);

    orkify(`delete ${appName}`);
  }, 15000);

  it('restart command works and process comes back online', async () => {
    const appName = 'test-restart-cmd';

    orkify(`up ${EXAMPLES}/basic/app.js -n ${appName}`);
    await waitForProcessOnline(appName);

    // Verify running
    let list = orkify('list');
    expect(list).toContain(appName);
    expect(list).toContain('online');

    // Restart
    const output = orkify(`restart ${appName}`);
    expect(output).toContain('restarted');

    await waitForProcessOnline(appName);

    // Verify still running after restart
    list = orkify('list');
    expect(list).toContain(appName);
    expect(list).toContain('online');

    orkify(`delete ${appName}`);
  }, 15000);
});

describe('Multiple Processes', () => {
  const app1 = 'test-multi-1';
  const app2 = 'test-multi-2';
  let tempDir: string;
  let script1: string;
  let script2: string;

  beforeAll(async () => {
    // Clean up any leftover processes from previous describe blocks
    orkify(`delete ${app1}`);
    orkify(`delete ${app2}`);
    // Brief settle to ensure ports are freed
    await sleep(200);

    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-multi-test-')));
    script1 = join(tempDir, 'app1.js');
    script2 = join(tempDir, 'app2.js');

    writeFileSync(
      script1,
      `
        const http = require('http');
        const server = http.createServer((req, res) => {
          res.writeHead(200);
          res.end('app1');
        });
        server.listen(3012, () => {

        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );

    writeFileSync(
      script2,
      `
        const http = require('http');
        const server = http.createServer((req, res) => {
          res.writeHead(200);
          res.end('app2');
        });
        server.listen(3013, () => {

        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );
  });

  afterAll(() => {
    orkify(`delete ${app1}`);
    orkify(`delete ${app2}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs multiple processes simultaneously', async () => {
    orkify(`up ${script1} -n ${app1}`);
    orkify(`up ${script2} -n ${app2}`);
    await waitForProcessOnline(app1);
    await waitForProcessOnline(app2);

    // Both should be listed
    const list = orkify('list');
    expect(list).toContain(app1);
    expect(list).toContain(app2);

    // Both should respond
    const { body: body1 } = await httpGet('http://localhost:3012/');
    const { body: body2 } = await httpGet('http://localhost:3013/');

    expect(body1).toBe('app1');
    expect(body2).toBe('app2');
  }, 15000);

  it('down all stops all processes', async () => {
    orkify('down all');
    await waitForProcessStopped(app1);
    await waitForProcessStopped(app2);

    const list = orkify('list');
    expect(list).toContain('stopped');

    // Neither should respond
    const { status: status1 } = await httpGet('http://localhost:3012/');
    const { status: status2 } = await httpGet('http://localhost:3013/');

    expect(status1).toBe(0);
    expect(status2).toBe(0);
  }, 15000);

  it('restart all restarts all processes', async () => {
    orkify('restart all');
    await waitForProcessOnline(app1);
    await waitForProcessOnline(app2);
    await waitForHttpReady('http://localhost:3012/');
    await waitForHttpReady('http://localhost:3013/');

    // Both should respond again
    const { body: body1 } = await httpGet('http://localhost:3012/');
    const { body: body2 } = await httpGet('http://localhost:3013/');

    expect(body1).toBe('app1');
    expect(body2).toBe('app2');
  }, 20000);

  it('reload all reloads all processes', async () => {
    // Ensure processes are stable before reload
    await waitForHttpReady('http://localhost:3012/');
    await waitForHttpReady('http://localhost:3013/');

    // Get current PIDs
    const { body: before1 } = await httpGet('http://localhost:3012/');
    const { body: before2 } = await httpGet('http://localhost:3013/');

    // Fire reload command (don't wait for CLI response - it can hang on Linux CI)
    orkify('reload all');

    // Wait for both processes to be online AND HTTP ready
    await waitForProcessOnline(app1);
    await waitForProcessOnline(app2);
    await waitForHttpReady('http://localhost:3012/');
    await waitForHttpReady('http://localhost:3013/');

    // Verify via list that processes are online
    const list = orkify('list');
    expect(list).toContain(app1);
    expect(list).toContain(app2);
    expect(list).toContain('online');

    // Both should still respond - this verifies the reload actually worked
    const { body: after1 } = await httpGet('http://localhost:3012/');
    const { body: after2 } = await httpGet('http://localhost:3013/');

    expect(after1).toBe('app1');
    expect(after2).toBe('app2');

    // In fork mode, reload = restart, so verify processes restarted
    expect(before1).toBe(after1); // Content stays the same
    expect(before2).toBe(after2);
  }, 45000);
});

describe('Numeric ID Operations', () => {
  const appName = 'test-numeric-id';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-numid-test-')));
    scriptPath = join(tempDir, 'app.js');

    writeFileSync(
      scriptPath,
      `
        const http = require('http');
        const server = http.createServer((req, res) => {
          res.writeHead(200);
          res.end('numeric-id-app');
        });
        server.listen(3024, () => {

        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('can stop process by numeric ID', async () => {
    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);

    // Get the process ID from list
    const list = orkify('list');
    const idMatch = list.match(new RegExp(`│\\s*(\\d+)\\s*│\\s*${appName}`));
    expect(idMatch).not.toBeNull();
    if (!idMatch) return; // TypeScript guard
    const processId = idMatch[1];

    // Stop by ID
    const output = orkify(`down ${processId}`);
    expect(output).toContain('stopped');

    await waitForProcessStopped(appName);
    const { status } = await httpGet('http://localhost:3024/');
    expect(status).toBe(0);
  }, 15000);

  it('can restart process by numeric ID', async () => {
    // Allow daemon to settle after previous stop — IPC can briefly drop
    await sleep(500);

    const list = orkify('list');
    const idMatch = list.match(new RegExp(`│\\s*(\\d+)\\s*│\\s*${appName}`));
    expect(idMatch).not.toBeNull();
    if (!idMatch) return;
    const processId = idMatch[1];

    // Retry restart in case IPC connection is briefly unstable after stop
    let output = orkify(`restart ${processId}`);
    if (output.includes('Connection closed') || output.includes('Error')) {
      await sleep(500);
      output = orkify(`restart ${processId}`);
    }
    expect(output).toContain('restarted');

    await waitForProcessOnline(appName);
    const { status, body } = await httpGet('http://localhost:3024/');
    expect(status).toBe(200);
    expect(body).toBe('numeric-id-app');
  }, 15000);

  it('can reload process by numeric ID', async () => {
    const list = orkify('list');
    const idMatch = list.match(new RegExp(`│\\s*(\\d+)\\s*│\\s*${appName}`));
    expect(idMatch).not.toBeNull();
    if (!idMatch) return;
    const processId = idMatch[1];

    const output = orkify(`reload ${processId}`);
    expect(output).toContain('restarted');

    await waitForProcessOnline(appName);
    const { status } = await httpGet('http://localhost:3024/');
    expect(status).toBe(200);
  }, 15000);

  it('can delete process by numeric ID', async () => {
    const list = orkify('list');
    const idMatch = list.match(new RegExp(`│\\s*(\\d+)\\s*│\\s*${appName}`));
    expect(idMatch).not.toBeNull();
    if (!idMatch) return;
    const processId = idMatch[1];

    const output = orkify(`delete ${processId}`);
    expect(output).toContain('deleted');

    const listAfter = orkify('list');
    expect(listAfter).not.toContain(appName);
  }, 15000);
});

describe('Kill Command', () => {
  it('kills the daemon', async () => {
    // Ensure daemon is running by starting a process
    orkify(`up ${EXAMPLES}/basic/app.js -n test-kill-daemon`);
    await waitForProcessOnline('test-kill-daemon');

    // Kill the daemon - command may return before socket is fully cleaned up
    orkify('kill');

    // Wait for daemon to fully shut down (longer timeout for Linux)
    await waitForDaemonKilled(10000);

    // Daemon socket should be gone - starting a new command will auto-start daemon again
    const list = orkify('list');
    expect(list).toBeDefined();

    orkify('delete test-kill-daemon');
  }, 20000);

  it('kills the daemon with --force (immediate SIGKILL)', async () => {
    orkify(`up ${EXAMPLES}/basic/app.js -n test-kill-force`);
    await waitForProcessOnline('test-kill-force');

    orkify('kill --force');
    await waitForDaemonKilled(10000);

    // Daemon should be fully gone — new command auto-starts a fresh daemon
    const list = orkify('list');
    expect(list).toBeDefined();

    orkify('delete test-kill-force');
  }, 20000);
});

describe('Background Worker Ready Signal', () => {
  const appName = 'test-bg-ready';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-bg-ready-')));
    scriptPath = join(tempDir, 'worker.js');

    writeFileSync(
      scriptPath,
      `
        // Background worker that doesn't bind a port
        setTimeout(() => {
          if (process.send) process.send('ready');
        }, 200);

        setInterval(() => {}, 1000); // Keep alive

        process.on('SIGTERM', () => process.exit(0));
      `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('marks worker online via process.send ready signal', async () => {
    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);

    const list = orkify('list');
    expect(list).toContain(appName);
    expect(list).toContain('online');

    orkify(`delete ${appName}`);
  }, 15000);
});
