import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpGet, orkify, sleep, waitForHttpReady, waitForProcessOnline } from './test-utils.js';

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Extract data lines (non-border) belonging to a specific process from the list output.
 * Returns the summary row and all subsequent worker rows until the next process or table end.
 */
function extractProcessLines(list: string, name: string): string[] {
  const stripped = stripAnsi(list);
  const lines = stripped.split('\n');
  const result: string[] = [];
  let capturing = false;

  for (const line of lines) {
    // Skip table border lines (contain ┼, or top/bottom borders)
    if (line.includes('┼') || line.includes('┌') || /^└─+┴/.test(line)) {
      continue;
    }

    if (line.includes(name)) {
      capturing = true;
      result.push(line);
    } else if (capturing) {
      if ((line.includes('├─') || line.includes('└─')) && line.includes('worker')) {
        result.push(line);
      } else if (
        line.includes('│') &&
        !line.includes('├─') &&
        !line.includes('└─') &&
        !line.includes('───')
      ) {
        // A data row that's not a worker — it's a different process; stop capturing
        capturing = false;
      }
    }
  }
  return result;
}

function parseCounters(
  list: string,
  name: string,
  mode: 'cluster' | 'fork'
): { restarts: number; errors: number } {
  const stripped = stripAnsi(list);
  const match = stripped.match(new RegExp(`${name}\\s*│\\s*${mode}\\s*│\\s*(\\d+)\\s*│\\s*(\\d+)`));
  return {
    restarts: match ? parseInt(match[1]) : -1,
    errors: match ? parseInt(match[2]) : -1,
  };
}

function parseWorkerCounters(
  list: string,
  name: string
): Array<{ id: number; restarts: number; errors: number }> {
  const processLines = extractProcessLines(list, name);
  const results: Array<{ id: number; restarts: number; errors: number }> = [];
  const regex = /[├└]─\s*(\d+)\s*│\s*worker\s+\d+\s*│\s*│\s*(\d+)\s*│\s*(\d+)/;
  for (const line of processLines) {
    const m = regex.exec(line);
    if (m) {
      results.push({ id: parseInt(m[1]), restarts: parseInt(m[2]), errors: parseInt(m[3]) });
    }
  }
  return results;
}

function parseWorkerPids(list: string, name: string): number[] {
  const processLines = extractProcessLines(list, name);
  const pids: number[] = [];
  // Verbose mode columns: id │ name │ mode │ pid │ ↺ │ ✘ │ status │ ...
  // Worker row: ├─ N │ worker N │ │ PID │ ↺ │ ✘ │ ... (└─ for last worker)
  const regex = /[├└]─\s*\d+\s*│\s*worker\s+\d+\s*│\s*│\s*(\d+)/;
  for (const line of processLines) {
    const m = regex.exec(line);
    if (m) pids.push(parseInt(m[1]));
  }
  return pids;
}

/**
 * Wait until the specific process has the expected number of online workers.
 * Scoped to a single process name (unlike generic waitForWorkersOnline).
 */
async function waitForProcessWorkersOnline(
  name: string,
  expectedWorkers: number,
  maxWait = 30000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const list = orkify('list');
    const processLines = extractProcessLines(list, name);
    const onlineCount = processLines.filter(
      (line) => line.includes('worker') && line.includes('online')
    ).length;

    if (onlineCount >= expectedWorkers) {
      return;
    }
    await sleep(200);
  }
  throw new Error(`Process "${name}" workers not online after ${maxWait}ms`);
}

describe('Fork Mode Error Counter', () => {
  const appName = 'test-fork-errors';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-reload-state-fork-')));
    scriptPath = join(tempDir, 'app.js');

    writeFileSync(
      scriptPath,
      `
        const http = require('http');
        const server = http.createServer((req, res) => {
          if (req.url === '/crash') {
            res.writeHead(200);
            res.end('crashing...');
            setTimeout(() => process.exit(1), 100);
            return;
          }
          if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', pid: process.pid }));
            return;
          }
          res.writeHead(200);
          res.end('ok');
        });
        server.listen(3040, () => {

        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );

    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);
    await waitForHttpReady('http://localhost:3040/health');
  }, 15000);

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('shows 0 errors after clean start', () => {
    const list = orkify('list');
    const counters = parseCounters(list, appName, 'fork');
    expect(counters.errors).toBe(0);
  });

  it('increments error counter after crash', async () => {
    // Get initial PID
    const { body: before } = await httpGet('http://localhost:3040/health');
    const pidBefore = JSON.parse(before).pid;

    // Trigger crash
    await httpGet('http://localhost:3040/crash');

    // Wait for PID to change (ensures crash + restart happened)
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const { body, status } = await httpGet('http://localhost:3040/health');
      if (status === 200) {
        const data = JSON.parse(body);
        if (data.pid !== pidBefore) break;
      }
      await sleep(100);
    }

    const list = orkify('list');
    const counters = parseCounters(list, appName, 'fork');
    expect(counters.errors).toBe(1);
  }, 15000);

  it('increments restart counter after crash', () => {
    const list = orkify('list');
    const counters = parseCounters(list, appName, 'fork');
    expect(counters.restarts).toBeGreaterThanOrEqual(1);
  });

  it('restart command resets both counters', async () => {
    orkify(`restart ${appName}`);
    await waitForProcessOnline(appName, 10000);
    await waitForHttpReady('http://localhost:3040/health');

    const list = orkify('list');
    const counters = parseCounters(list, appName, 'fork');
    expect(counters.restarts).toBe(0);
    expect(counters.errors).toBe(0);
  }, 15000);
});

describe('Cluster Reload State', () => {
  const appName = 'test-cluster-reload';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-reload-state-cluster-')));
    scriptPath = join(tempDir, 'app.js');

    writeFileSync(
      scriptPath,
      `
        const http = require('http');
        const server = http.createServer((req, res) => {
          if (req.url === '/crash') {
            res.writeHead(200);
            res.end('crashing...');
            setTimeout(() => process.exit(1), 100);
            return;
          }
          if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'ok',
              pid: process.pid,
              worker: process.env.ORKIFY_WORKER_ID,
            }));
            return;
          }
          res.writeHead(200);
          res.end('ok');
        });
        server.listen(3041, () => {

        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );

    orkify(`up ${scriptPath} -n ${appName} -w 2`);
    await waitForProcessWorkersOnline(appName, 2, 30000);
    await waitForHttpReady('http://localhost:3041/health');
  }, 45000);

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts with workers 0 and 1', () => {
    const list = orkify('list');
    const processLines = extractProcessLines(list, appName);
    const joined = processLines.join('\n');
    expect(joined).toContain('worker 0');
    expect(joined).toContain('worker 1');
  });

  it('0 restarts and 0 errors initially', () => {
    const list = orkify('list');
    const workers = parseWorkerCounters(list, appName);
    expect(workers.length).toBe(2);
    for (const w of workers) {
      expect(w.restarts).toBe(0);
      expect(w.errors).toBe(0);
    }
  });

  it('worker IDs stay stable after reload', async () => {
    orkify(`reload ${appName}`);
    await waitForProcessWorkersOnline(appName, 2, 40000);
    await waitForHttpReady('http://localhost:3041/health');

    const list = orkify('list');
    const processLines = extractProcessLines(list, appName);
    const joined = processLines.join('\n');
    expect(joined).toContain('worker 0');
    expect(joined).toContain('worker 1');
    // Should not have spawned worker 2
    expect(joined).not.toContain('worker 2');
  }, 45000);

  it('restart counters increment after reload', () => {
    const list = orkify('list');
    const workers = parseWorkerCounters(list, appName);
    expect(workers.length).toBe(2);
    const totalRestarts = workers.reduce((sum, w) => sum + w.restarts, 0);
    expect(totalRestarts).toBeGreaterThanOrEqual(2);
  });

  it('error counters stay 0 after reload', () => {
    const list = orkify('list');
    const workers = parseWorkerCounters(list, appName);
    for (const w of workers) {
      expect(w.errors).toBe(0);
    }
  });

  it('PIDs change after reload', async () => {
    // Get current PIDs
    const listBefore = orkify('list -v');
    const pidsBefore = parseWorkerPids(listBefore, appName);
    expect(pidsBefore.length).toBe(2);

    // Reload again
    orkify(`reload ${appName}`);
    await waitForProcessWorkersOnline(appName, 2, 40000);
    await waitForHttpReady('http://localhost:3041/health');

    // Get new PIDs
    const listAfter = orkify('list -v');
    const pidsAfter = parseWorkerPids(listAfter, appName);
    expect(pidsAfter.length).toBe(2);

    // No PID should overlap
    const overlap = pidsBefore.filter((p) => pidsAfter.includes(p));
    expect(overlap).toHaveLength(0);
  }, 45000);

  it('crash increments error counter', async () => {
    // Record current totals
    const listBefore = orkify('list');
    const workersBefore = parseWorkerCounters(listBefore, appName);
    const totalErrorsBefore = workersBefore.reduce((sum, w) => sum + w.errors, 0);

    // Crash a random worker
    await httpGet('http://localhost:3041/crash');

    // Wait for worker to recover
    await sleep(500); // Let the crash happen
    await waitForProcessWorkersOnline(appName, 2, 15000);
    await waitForHttpReady('http://localhost:3041/health');

    const listAfter = orkify('list');
    const workersAfter = parseWorkerCounters(listAfter, appName);
    const totalErrorsAfter = workersAfter.reduce((sum, w) => sum + w.errors, 0);

    expect(totalErrorsAfter).toBe(totalErrorsBefore + 1);
  }, 20000);

  it('worker IDs stay stable after crash', () => {
    const list = orkify('list');
    const processLines = extractProcessLines(list, appName);
    const joined = processLines.join('\n');
    expect(joined).toContain('worker 0');
    expect(joined).toContain('worker 1');

    const workers = parseWorkerCounters(list, appName);
    expect(workers.length).toBe(2);
  });

  it('restart counter increments after crash', () => {
    const list = orkify('list');
    const workers = parseWorkerCounters(list, appName);
    // After 2 reloads + 1 crash, total restarts should be > 4 (2 per reload + 1 for crash)
    const totalRestarts = workers.reduce((sum, w) => sum + w.restarts, 0);
    expect(totalRestarts).toBeGreaterThanOrEqual(5);
  });
});
