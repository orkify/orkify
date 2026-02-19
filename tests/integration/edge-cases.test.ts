import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SavedState } from '../../src/types/index.js';
import { ORKIFY_HOME } from './setup.js';
import {
  httpGet,
  orkify,
  sleep,
  waitForDaemonKilled,
  waitForHttpReady,
  waitForProcessOnline,
  waitForProcessRemoved,
  waitForProcessStopped,
  waitForWorkersOnline,
} from './test-utils.js';

describe('Fork Mode Reload', () => {
  const appName = 'test-fork-reload';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-fork-reload-test-')));
    scriptPath = join(tempDir, 'app.js');

    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pid: process.pid }));
      });
      server.listen(3026, () => {

      });
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reload in fork mode performs restart', async () => {
    // Start in fork mode (single instance)
    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);

    // Get initial PID
    const { body: before } = await httpGet('http://localhost:3026/');
    const pidBefore = JSON.parse(before).pid;

    // Reload (which in fork mode means restart)
    const output = orkify(`reload ${appName}`);
    expect(output).toContain('restarted');

    await waitForProcessOnline(appName);

    // Should have new PID
    const { body: after } = await httpGet('http://localhost:3026/');
    const pidAfter = JSON.parse(after).pid;
    expect(pidAfter).not.toBe(pidBefore);
  }, 20000);

  it('reload on stopped process starts it again', async () => {
    // Ensure process exists and is running first
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);
    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);

    // Stop the process
    orkify(`down ${appName}`);
    await waitForProcessStopped(appName);

    // Verify it's stopped
    const { status: stoppedStatus } = await httpGet('http://localhost:3026/');
    expect(stoppedStatus).toBe(0);

    // Reload should start it again
    const output = orkify(`reload ${appName}`);
    expect(output).toContain('restarted');

    await waitForProcessOnline(appName);

    // Should be running again
    const { status, body } = await httpGet('http://localhost:3026/');
    expect(status).toBe(200);
    expect(JSON.parse(body).pid).toBeGreaterThan(0);
  }, 20000);

  it('restart on stopped process starts it again', async () => {
    // Stop the process (from previous test)
    orkify(`down ${appName}`);
    await waitForProcessStopped(appName);

    // Verify it's stopped
    const { status: stoppedStatus } = await httpGet('http://localhost:3026/');
    expect(stoppedStatus).toBe(0);

    // Restart should start it again
    const output = orkify(`restart ${appName}`);
    expect(output).toContain('restarted');

    await waitForProcessOnline(appName);

    // Should be running again
    const { status, body } = await httpGet('http://localhost:3026/');
    expect(status).toBe(200);
    expect(JSON.parse(body).pid).toBeGreaterThan(0);
  }, 15000);
});

describe('Node Args and Script Args', () => {
  const appName = 'test-args';
  const PORT = 3020;
  let tempDir: string;
  let scriptPath: string;

  beforeAll(async () => {
    // Clean up from previous test suite
    orkify('delete test-auto-restart');
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-args-test-')));
    scriptPath = join(tempDir, 'args-app.js');

    // Create an app that echoes node args and script args
    writeFileSync(
      scriptPath,
      `
      const http = require('http');

      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          nodeVersion: process.version,
          execArgv: process.execArgv,
          argv: process.argv.slice(2), // Skip node and script path
          env: {
            NODE_OPTIONS: process.env.NODE_OPTIONS || null,
          }
        }));
      });

      server.listen(${PORT}, () => {

      });

      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes --args to the script', async () => {
    // Ensure clean state
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    // Use arg values that don't look like flags to avoid Commander parsing issues
    const output = orkify(`up ${scriptPath} -n ${appName} --args="config.json production"`);
    expect(output).toContain('started');

    // Wait for server to be ready
    await waitForProcessOnline(appName);

    // Retry a few times in case server is slow to start
    let status = 0;
    let body = '';
    for (let i = 0; i < 5; i++) {
      const result = await httpGet(`http://localhost:${PORT}/`);
      status = result.status;
      body = result.body;
      if (status === 200) break;
      await sleep(100);
    }

    expect(status).toBe(200);

    const data = JSON.parse(body);
    expect(data.argv).toContain('config.json');
    expect(data.argv).toContain('production');
  }, 25000);

  it('passes --node-args to Node.js', async () => {
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    // Use --no-warnings as a safe node arg to test
    orkify(`up ${scriptPath} -n ${appName} --node-args="--no-warnings"`);
    await waitForProcessOnline(appName);

    const { status, body } = await httpGet(`http://localhost:${PORT}/`);
    expect(status).toBe(200);

    const data = JSON.parse(body);
    expect(data.execArgv).toContain('--no-warnings');
  }, 15000);

  it('passes both --node-args and --args together', async () => {
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    orkify(
      `up ${scriptPath} -n ${appName} --node-args="--no-warnings" --args="--config=test.json"`
    );
    await waitForProcessOnline(appName);

    const { status, body } = await httpGet(`http://localhost:${PORT}/`);
    expect(status).toBe(200);

    const data = JSON.parse(body);
    expect(data.execArgv).toContain('--no-warnings');
    expect(data.argv).toContain('--config=test.json');
  }, 15000);
});

describe('Edge Cases', () => {
  it('shows meaningful output for empty process list', async () => {
    // Kill daemon and delete all to ensure empty state
    orkify('down all');
    orkify('delete all');
    await sleep(100);

    const list = orkify('list');

    // Should either show "No processes" or an empty table, not an error
    expect(list.toLowerCase()).not.toContain('error');
    // Should still have table headers or a "no processes" message
    expect(list.length).toBeGreaterThan(0);
  }, 10000);

  it('auto-generates process name from script path', async () => {
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-autoname-test-')));
    const scriptPath = join(tempDir, 'my-awesome-app.js');

    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('ok');
      });
      server.listen(3027, () => {

      });
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );

    // Start WITHOUT -n flag - should auto-generate name from script
    const output = orkify(`up ${scriptPath}`);
    expect(output).toContain('started');

    await waitForProcessOnline('my-awesome-app');

    // Should appear in list with script-derived name (without extension)
    const list = orkify('list');
    expect(list).toContain('my-awesome-app');

    orkify('delete my-awesome-app');
    rmSync(tempDir, { recursive: true, force: true });
  }, 15000);

  it('handles cluster worker crash with auto-restart', async () => {
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-cluster-crash-test-')));
    const scriptPath = join(tempDir, 'crash-cluster.js');

    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const workerId = process.env.ORKIFY_WORKER_ID;

      const server = http.createServer((req, res) => {
        if (req.url === '/crash') {
          res.writeHead(200);
          res.end('crashing worker ' + workerId);
          setTimeout(() => process.exit(1), 100);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ worker: workerId, pid: process.pid }));
      });

      server.listen(3028, () => {

      });

      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );

    orkify(`up ${scriptPath} -n test-cluster-crash -w 2`);
    await waitForWorkersOnline('test-cluster-crash', 2);

    // Verify cluster is running with 2 workers
    let list = orkify('list');
    expect(list).toContain('test-cluster-crash');
    expect(list).toContain('cluster');
    // Count workers - should have 2 online workers
    const workerCountBefore = (list.match(/worker\s+\d+/g) || []).length;
    expect(workerCountBefore).toBe(2);

    // Verify cluster responds before crash
    const { status: statusBefore } = await httpGet('http://localhost:3028/');
    expect(statusBefore).toBe(200);

    // Trigger crash on one worker
    await httpGet('http://localhost:3028/crash');

    // Wait for auto-restart and HTTP ready
    await waitForWorkersOnline('test-cluster-crash', 2);
    await waitForHttpReady('http://localhost:3028/');

    // Cluster should still be healthy with 2 online workers
    // Note: worker IDs are cumulative, so we count ONLINE workers, not total entries
    list = orkify('list');
    const lines = list.split('\n');
    const onlineWorkerCount = lines.filter(
      (line) => line.includes('worker') && line.includes('online')
    ).length;
    expect(onlineWorkerCount).toBe(2);

    // Should still respond to requests
    const { status } = await httpGet('http://localhost:3028/');
    expect(status).toBe(200);

    orkify('delete test-cluster-crash');
    rmSync(tempDir, { recursive: true, force: true });
  }, 25000);

  it('restore restores cluster mode processes', async () => {
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-restore-cluster-test-')));
    const scriptPath = join(tempDir, 'cluster-app.js');

    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          worker: process.env.ORKIFY_WORKER_ID,
          clusterMode: process.env.ORKIFY_CLUSTER_MODE
        }));
      });
      server.listen(3029, () => {

      });
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );

    // Start in cluster mode
    orkify(`up ${scriptPath} -n test-restore-cluster -w 2`);
    await waitForWorkersOnline('test-restore-cluster', 2);

    // Verify cluster is running
    let list = orkify('list');
    expect(list).toContain('test-restore-cluster');
    expect(list).toContain('cluster');

    // Save state
    orkify('snap');

    // Kill daemon
    orkify('kill');
    await waitForDaemonKilled();

    // Restore
    const output = orkify('restore');
    expect(output).toContain('Restored');
    expect(output).toContain('test-restore-cluster');

    // Wait for cluster to come up
    await waitForWorkersOnline('test-restore-cluster', 2);

    // Should be in cluster mode again
    list = orkify('list');
    expect(list).toContain('cluster');
    expect(list).toContain('worker 0');
    expect(list).toContain('worker 1');

    // Verify it responds
    const { status, body } = await httpGet('http://localhost:3029/');
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(data.clusterMode).toBe('true');

    orkify('delete test-restore-cluster');
    rmSync(tempDir, { recursive: true, force: true });
  }, 30000);

  it('snap with no processes does not error', async () => {
    // Ensure no processes
    orkify('down all');
    orkify('delete all');
    await sleep(100);

    const output = orkify('snap');

    // Should not error, might say "saved" or "no processes"
    expect(output.toLowerCase()).not.toContain('error');
  }, 10000);

  it('restore with no saved state handles gracefully', async () => {
    // Remove snapshot file if it exists
    const stateFile = join(ORKIFY_HOME, 'snapshot.yml');
    if (existsSync(stateFile)) {
      rmSync(stateFile);
    }

    // Kill daemon to ensure fresh state
    orkify('kill');
    await waitForDaemonKilled();

    const output = orkify('restore');

    // Should handle gracefully - either "no saved state" or empty restoration
    expect(output.toLowerCase()).not.toMatch(/exception|crash|fatal/i);
  }, 10000);
});

describe('Snap --no-env', () => {
  const stateFile = join(ORKIFY_HOME, 'snapshot.yml');
  const appName = 'test-no-env';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-no-env-test-')));
    scriptPath = join(tempDir, 'app.js');

    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pid: process.pid }));
      });
      server.listen(3031, () => {

      });
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    orkify('delete test-no-env-nodeargs');
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('snap --no-env produces snapshot file without env vars', async () => {
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);

    const output = orkify('snap --no-env');
    expect(output.toLowerCase()).not.toContain('error');

    const content = readFileSync(stateFile, 'utf-8');
    const { parse } = await import('yaml');
    const state: SavedState = parse(content);

    const proc = state.processes.find((p) => p.name === appName);
    expect(proc).toBeDefined();
    if (!proc) throw new Error('unreachable');
    expect(proc.env).toEqual({});
  }, 20000);

  it('snap (default) still saves env vars', async () => {
    // Process should still be running from previous test
    const output = orkify('snap');
    expect(output.toLowerCase()).not.toContain('error');

    const content = readFileSync(stateFile, 'utf-8');
    const { parse } = await import('yaml');
    const state: SavedState = parse(content);

    const proc = state.processes.find((p) => p.name === appName);
    expect(proc).toBeDefined();
    if (!proc) throw new Error('unreachable');
    // Default save should have env values (at minimum the orkify-injected vars)
    expect(Object.keys(proc.env).length).toBeGreaterThan(0);
  }, 15000);

  it('full cycle: snap --no-env → kill → restore works', async () => {
    // Ensure process is running
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);

    // Verify it responds
    const { status: statusBefore } = await httpGet('http://localhost:3031/');
    expect(statusBefore).toBe(200);

    // Save without env
    orkify('snap --no-env');

    // Kill daemon
    orkify('kill');
    await waitForDaemonKilled();

    // Restore
    const output = orkify('restore');
    expect(output).toContain('Restored');
    expect(output).toContain(appName);

    // Wait for process to come back online
    await waitForProcessOnline(appName);

    // Should be running again
    const { status: statusAfter } = await httpGet('http://localhost:3031/');
    expect(statusAfter).toBe(200);
  }, 30000);

  it('--node-args survives snap --no-env', async () => {
    const nodeArgsApp = 'test-no-env-nodeargs';
    const nodeArgsScript = join(tempDir, 'nodeargs-app.js');

    writeFileSync(
      nodeArgsScript,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ execArgv: process.execArgv }));
      });
      server.listen(3032, () => {

      });
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );

    orkify(`delete ${nodeArgsApp}`);
    await waitForProcessRemoved(nodeArgsApp);

    orkify(`up ${nodeArgsScript} -n ${nodeArgsApp} --node-args="--no-warnings"`);
    await waitForProcessOnline(nodeArgsApp);

    orkify('snap --no-env');

    const content = readFileSync(stateFile, 'utf-8');
    const { parse } = await import('yaml');
    const state: SavedState = parse(content);

    const proc = state.processes.find((p) => p.name === nodeArgsApp);
    expect(proc).toBeDefined();
    if (!proc) throw new Error('unreachable');
    expect(proc.env).toEqual({});
    expect(proc.nodeArgs).toContain('--no-warnings');
  }, 20000);
});

describe('Workers Option Parsing', () => {
  const CPU_COUNT = cpus().length;
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-workers-test-')));
    scriptPath = join(tempDir, 'app.js');

    // Create a simple app
    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('ok');
      });
      server.listen(0, () => {

      });
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );
  });

  afterAll(() => {
    orkify('down all');
    orkify('delete all');
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('defaults to 1 worker (fork mode) when -w is not specified', async () => {
    const appName = 'test-workers-default';
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    const output = orkify(`up ${scriptPath} -n ${appName}`);
    expect(output).toContain(`Process "${appName}" started`);
    expect(output).toContain('Mode: fork');

    orkify(`delete ${appName}`);
  }, 15000);

  it('uses CPU cores when -w 0 is specified', async () => {
    const appName = 'test-workers-zero';
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    const output = orkify(`up ${scriptPath} -n ${appName} -w 0`);
    expect(output).toContain(`Process "${appName}" started`);
    expect(output).toContain('Mode: cluster');

    // Wait for workers to spawn (Windows can be slow)
    await waitForWorkersOnline(CPU_COUNT);

    const list = orkify('list');
    const workerCount = (list.match(/worker\s+\d+/g) || []).length;
    expect(workerCount).toBe(CPU_COUNT);

    orkify(`delete ${appName}`);
  }, 45000);

  it('uses specified number when -w N is given', async () => {
    const appName = 'test-workers-number';
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    const output = orkify(`up ${scriptPath} -n ${appName} -w 3`);
    expect(output).toContain(`Process "${appName}" started`);
    expect(output).toContain('Mode: cluster');

    // Wait for workers to spawn (Windows can be slow)
    await waitForWorkersOnline(3);

    const list = orkify('list');
    const workerCount = (list.match(/worker\s+\d+/g) || []).length;
    expect(workerCount).toBe(3);

    orkify(`delete ${appName}`);
  }, 45000);

  it('uses CPU cores minus 1 when --workers=-1 is specified', async () => {
    const appName = 'test-workers-negative';
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    const expectedWorkerCount = Math.max(1, CPU_COUNT - 1);
    // Use --workers=-1 to avoid parsing issues with -w -1
    const output = orkify(`up ${scriptPath} -n ${appName} --workers=-1`);
    expect(output).toContain(`Process "${appName}" started`);

    if (expectedWorkerCount > 1) {
      expect(output).toContain('Mode: cluster');
      await waitForWorkersOnline(expectedWorkerCount);
      const list = orkify('list');
      const workerCount = (list.match(/worker\s+\d+/g) || []).length;
      expect(workerCount).toBe(expectedWorkerCount);
    } else {
      expect(output).toContain('Mode: fork');
    }

    orkify(`delete ${appName}`);
  }, 20000);

  it('never goes below 1 instance with very negative values', async () => {
    const appName = 'test-workers-very-negative';
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    const output = orkify(`up ${scriptPath} -n ${appName} --workers=-999`);
    expect(output).toContain(`Process "${appName}" started`);
    expect(output).toContain('Mode: fork');

    orkify(`delete ${appName}`);
  }, 15000);
});
