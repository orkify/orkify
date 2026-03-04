import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpGet, orkify, waitForClusterReady } from './test-utils.js';

const PORT = 4250;
const APP_NAME = 'test-cluster-args';
const WORKERS = 2;

describe('Cluster mode --args forwarding', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-cluster-args-')));

    // Script that echoes process.argv so we can verify args were forwarded
    writeFileSync(
      join(tempDir, 'server.js'),
      `
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    argv: process.argv.slice(2),
    worker: process.env.ORKIFY_WORKER_ID ?? 'standalone',
  }));
});

server.listen(${PORT}, () => {});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`
    );

    orkify(
      `up ${join(tempDir, 'server.js')} -n ${APP_NAME} -w ${WORKERS} --args="--config=prod.json --verbose"`
    );
    await waitForClusterReady(WORKERS, PORT);
  }, 60_000);

  afterAll(() => {
    try {
      orkify(`delete ${APP_NAME}`);
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('forwards --args to cluster workers', async () => {
    const { status, body } = await httpGet(`http://localhost:${PORT}/`);
    expect(status).toBe(200);

    const data = JSON.parse(body);
    expect(data.argv).toContain('--config=prod.json');
    expect(data.argv).toContain('--verbose');
  }, 10_000);

  it('all workers receive the same args', async () => {
    const workers = new Map<string, string[]>();

    for (let i = 0; i < 30; i++) {
      const { body } = await httpGet(`http://localhost:${PORT}/`);
      const data = JSON.parse(body);
      workers.set(data.worker, data.argv);
    }

    // Verify we hit multiple workers
    expect(workers.size).toBeGreaterThanOrEqual(2);

    // Verify each worker received the args
    for (const [, argv] of workers) {
      expect(argv).toContain('--config=prod.json');
      expect(argv).toContain('--verbose');
    }
  }, 15_000);
});
