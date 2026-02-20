import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnOrkify } from './setup.js';
import {
  httpGet,
  orkify,
  waitForDaemonKilled,
  waitForHttpReady,
  waitForProcessOnline,
  waitForProcessRemoved,
  waitForWorkersOnline,
} from './test-utils.js';

describe('Environment Variables', () => {
  const appName = 'test-env';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-env-test-')));
    scriptPath = join(tempDir, 'app.js');

    // Create an app that echoes environment variables
    writeFileSync(
      scriptPath,
      `
        const http = require('http');

        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            processId: process.env.ORKIFY_PROCESS_ID,
            processName: process.env.ORKIFY_PROCESS_NAME,
            workerId: process.env.ORKIFY_WORKER_ID,
            clusterMode: process.env.ORKIFY_CLUSTER_MODE,
            nodeEnv: process.env.NODE_ENV,
          }));
        });

        server.listen(3010, () => {

        });

        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes ORKIFY environment variables to process', async () => {
    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);

    const { body } = await httpGet('http://localhost:3010/');
    const data = JSON.parse(body);

    expect(data.processId).toBeDefined();
    expect(data.processName).toBe(appName);
    expect(data.workerId).toBe('0'); // Fork mode = worker 0
  }, 15000);

  it('passes ORKIFY cluster variables in cluster mode', async () => {
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    orkify(`up ${scriptPath} -n ${appName} -w 2`);
    await waitForWorkersOnline(appName, 2);

    const { body } = await httpGet('http://localhost:3010/');
    const data = JSON.parse(body);

    expect(data.clusterMode).toBe('true');
    expect(['0', '1']).toContain(data.workerId);
  }, 15000);
});

describe('Env File (--node-args with --env-file)', () => {
  const appName = 'test-env-file';
  let tempDir: string;
  let scriptPath: string;
  let envFilePath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-envfile-test-')));
    scriptPath = join(tempDir, 'app.js');
    envFilePath = join(tempDir, '.env');

    // Create .env file (Node's native parser format)
    writeFileSync(
      envFilePath,
      `# Database config
DB_HOST=localhost
DB_PORT=5432
API_KEY=secret-key-123`
    );

    // Create an app that echoes environment variables
    writeFileSync(
      scriptPath,
      `
        const http = require('http');

        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            dbHost: process.env.DB_HOST,
            dbPort: process.env.DB_PORT,
            apiKey: process.env.API_KEY,
            processName: process.env.ORKIFY_PROCESS_NAME,
          }));
        });

        server.listen(3018, () => {

        });

        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads env file via --node-args in daemon mode', async () => {
    orkify(`up ${scriptPath} -n ${appName} --node-args="--env-file=${envFilePath}"`);
    await waitForProcessOnline(appName);

    const { status, body } = await httpGet('http://localhost:3018/');
    expect(status).toBe(200);

    const data = JSON.parse(body);
    expect(data.dbHost).toBe('localhost');
    expect(data.dbPort).toBe('5432');
    expect(data.apiKey).toBe('secret-key-123');
    expect(data.processName).toBe(appName);
  }, 15000);

  it('preserves env vars after restart', async () => {
    orkify(`restart ${appName}`);
    await waitForProcessOnline(appName);

    const { status, body } = await httpGet('http://localhost:3018/');
    expect(status).toBe(200);

    const data = JSON.parse(body);
    expect(data.dbHost).toBe('localhost');
    expect(data.apiKey).toBe('secret-key-123');
  }, 15000);

  it('loads env file via --node-args in foreground mode (run command)', async () => {
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    // Force-kill the background daemon so orkify run can acquire the PID lock.
    orkify('kill --force');
    await waitForDaemonKilled(20000);

    const proc = spawnOrkify(
      [
        'run',
        scriptPath,
        '-n',
        'test-env-run',
        `--node-args=--env-file=${envFilePath}`,
        '--silent',
      ],
      {
        stdio: 'pipe',
        detached: false,
      }
    );

    // Capture stderr so failures are visible in CI logs
    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    await waitForHttpReady('http://localhost:3018/', 20000).catch((err) => {
      throw new Error(`${(err as Error).message}\norkify run stderr: ${stderr}`);
    });

    const { status, body } = await httpGet('http://localhost:3018/');
    expect(status).toBe(200);

    const data = JSON.parse(body);
    expect(data.dbHost).toBe('localhost');
    expect(data.apiKey).toBe('secret-key-123');

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 3000);
    });
  }, 45000);
});

describe('Working Directory (--cwd)', () => {
  const appName = 'test-cwd';
  let tempDir: string;
  let scriptPath: string;
  let dataFile: string;

  beforeAll(() => {
    // Use realpathSync to resolve macOS /var -> /private/var symlink
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-cwd-test-')));
    scriptPath = join(tempDir, 'app.js');
    dataFile = join(tempDir, 'data.json');

    // Create a data file
    writeFileSync(dataFile, JSON.stringify({ secret: 'test-secret-value' }));

    // Create an app that reads from cwd
    writeFileSync(
      scriptPath,
      `
        const http = require('http');
        const fs = require('fs');
        const path = require('path');

        const server = http.createServer((req, res) => {
          const cwd = process.cwd();
          let data = null;
          try {
            data = JSON.parse(fs.readFileSync(path.join(cwd, 'data.json')));
          } catch (e) {
            data = { error: e.message };
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ cwd, data }));
        });

        server.listen(3011, () => {

        });

        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('respects --cwd option', async () => {
    orkify(`up ${scriptPath} -n ${appName} --cwd ${tempDir}`);
    await waitForProcessOnline(appName);

    const { body } = await httpGet('http://localhost:3011/');
    const data = JSON.parse(body);

    expect(data.cwd).toBe(tempDir);
    expect(data.data.secret).toBe('test-secret-value');
  }, 15000);
});
