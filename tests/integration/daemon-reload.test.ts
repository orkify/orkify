import { existsSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORKIFY_HOME } from './setup.js';
import { httpGet, waitForDaemonKilled, waitForWorkersOnline, orkify } from './test-utils.js';

describe('daemon-reload', () => {
  let tempDir: string;
  let scriptPath: string;
  const PORT = 3042;
  const APP_NAME = 'test-daemon-reload';

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-daemon-reload-test-')));
    scriptPath = join(tempDir, 'app.js');

    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pid: process.pid, worker: process.env.ORKIFY_WORKER_ID }));
      });
      server.listen(${PORT}, () => {

      });
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );
  });

  afterAll(() => {
    orkify(`delete ${APP_NAME}`);
    orkify('kill');
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('restores processes from memory (not snapshot file)', async () => {
    // Start a cluster process
    orkify(`up ${scriptPath} -n ${APP_NAME} -w 2`);
    await waitForWorkersOnline(APP_NAME, 2, 10000);

    // Verify it's running
    const { status } = await httpGet(`http://localhost:${PORT}/`);
    expect(status).toBe(200);

    // Record snapshot file mtime (or absence) before daemon-reload
    const stateFile = join(ORKIFY_HOME, 'snapshot.yml');
    const stateExistedBefore = existsSync(stateFile);
    const mtimeBefore = stateExistedBefore ? statSync(stateFile).mtimeMs : null;

    // Daemon-reload: should restore processes from memory
    const output = orkify('daemon-reload');
    expect(output).toContain('Daemon reloaded');
    expect(output).toContain(APP_NAME);

    // Snapshot file should NOT have been written by daemon-reload
    if (stateExistedBefore) {
      const mtimeAfter = statSync(stateFile).mtimeMs;
      expect(mtimeAfter).toBe(mtimeBefore);
    } else {
      // If no snapshot file existed, daemon-reload should not have created one
      expect(existsSync(stateFile)).toBe(false);
    }

    // Process should be back online
    await waitForWorkersOnline(APP_NAME, 2, 30000);

    const list = orkify('list');
    expect(list).toContain(APP_NAME);
    expect(list).toContain('cluster');
    expect(list).toContain('worker 0');
    expect(list).toContain('worker 1');

    // Should respond to HTTP requests
    const { status: newStatus } = await httpGet(`http://localhost:${PORT}/`);
    expect(newStatus).toBe(200);
  }, 60000);

  it('does not use snapshot file even when it exists', async () => {
    // Write a snapshot file with a DIFFERENT process name
    const stateFile = join(ORKIFY_HOME, 'snapshot.yml');
    const { stringify } = await import('yaml');
    writeFileSync(
      stateFile,
      stringify({
        version: 1,
        processes: [
          {
            name: 'decoy-from-state-file',
            script: scriptPath,
            cwd: tempDir,
            workerCount: 1,
            execMode: 'fork',
            watch: false,
            env: {},
            nodeArgs: [],
            args: [],
            killTimeout: 5000,
            maxRestarts: 10,
            minUptime: 1000,
            restartDelay: 100,
            sticky: false,
          },
        ],
      }),
      'utf-8'
    );

    // Daemon-reload should use in-memory configs, not snapshot file
    const output = orkify('daemon-reload');
    expect(output).toContain('Daemon reloaded');

    // Should have restored the running process, NOT the decoy from snapshot file
    await waitForWorkersOnline(APP_NAME, 2, 30000);
    const list = orkify('list');
    expect(list).toContain(APP_NAME);
    expect(list).not.toContain('decoy-from-state-file');

    // Clean up the decoy snapshot file
    rmSync(stateFile, { force: true });
  }, 60000);

  it('restore uses snapshot file', async () => {
    // Save current state to file
    orkify('snap');
    const stateFile = join(ORKIFY_HOME, 'snapshot.yml');
    expect(existsSync(stateFile)).toBe(true);

    // Kill daemon
    orkify('kill');
    await waitForDaemonKilled(10000);

    // Restore should read from snapshot file
    const output = orkify('restore');
    expect(output).toContain('Restored');
    expect(output).toContain(APP_NAME);

    await waitForWorkersOnline(APP_NAME, 2, 30000);

    const { status } = await httpGet(`http://localhost:${PORT}/`);
    expect(status).toBe(200);

    // Clean up snapshot file
    rmSync(stateFile, { force: true });
  }, 60000);
});
