import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpGet, orkify, waitForWorkersOnline } from './test-utils.js';

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('reload-resilience', () => {
  let tempDir: string;
  const PORT = 3044;
  const APP_NAME = 'test-reload-resilience';

  function writeGoodScript(path: string, port: number | 0 = 0): void {
    writeFileSync(
      path,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end(JSON.stringify({ pid: process.pid, worker: process.env.ORKIFY_WORKER_ID }));
      });
      server.listen(${port}, () => {});
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );
  }

  function writeCrashScript(path: string): void {
    writeFileSync(path, `process.exit(1);`);
  }

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-reload-resilience-')));
  });

  afterAll(() => {
    orkify(`delete ${APP_NAME}`);
    orkify('delete test-reload-no-retry');
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('marks workers as stale when reload fails', async () => {
    const script = join(tempDir, 'stale-app.js');
    writeGoodScript(script, PORT);

    // Start cluster with --reload-retries 0 so reload fails fast (one 30s attempt per slot)
    orkify(`up ${script} -n ${APP_NAME} -w 2 --reload-retries 0`);
    await waitForWorkersOnline(APP_NAME, 2);

    // Verify it's running
    const { status } = await httpGet(`http://localhost:${PORT}/`);
    expect(status).toBe(200);

    // Replace script with crashing version
    writeCrashScript(script);

    // Reload — runs synchronously, will take ~30s per slot with 0 retries.
    // The first slot fails and aborts remaining, so only ~30s total.
    // Use a longer timeout for the execSync call.
    orkify(`reload ${APP_NAME}`, 120000);

    // Process should still be online (old workers kept)
    const list = orkify('list');
    expect(list).toContain(APP_NAME);
    expect(list).toContain('online');

    // Should show stale indicator
    const stripped = stripAnsi(list);
    expect(stripped).toContain('stale');
  }, 180000);

  it('clears stale flag on successful reload', async () => {
    const script = join(tempDir, 'stale-app.js');

    // Restore good script
    writeGoodScript(script, PORT);

    // Reload again — should succeed
    orkify(`reload ${APP_NAME}`, 120000);

    // Wait for workers to come back online
    await waitForWorkersOnline(APP_NAME, 2);

    const list = orkify('list');
    const stripped = stripAnsi(list);
    expect(stripped).not.toContain('stale');
    expect(list).toContain('online');
  }, 180000);

  it('respects --reload-retries 0 for immediate failure', async () => {
    const name = 'test-reload-no-retry';
    const script = join(tempDir, 'noretry.js');
    writeGoodScript(script);

    orkify(`up ${script} -n ${name} -w 2 --reload-retries 0`);
    await waitForWorkersOnline(name, 2);

    // Replace with crashing script
    writeCrashScript(script);

    // Reload should fail (one 30s timeout then abort)
    orkify(`reload ${name}`, 120000);

    // Verify process is still listed (old workers kept)
    const list = orkify('list');
    expect(list).toContain(name);

    // Should show stale
    const stripped = stripAnsi(list);
    expect(stripped).toContain('stale');

    orkify(`delete ${name}`);
  }, 180000);
});
