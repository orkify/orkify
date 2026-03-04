import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  httpGet,
  orkify,
  waitForClusterReady,
  waitForHttpReady,
  waitForProcessOnline,
} from './test-utils.js';

const PORT = 4230;
const APP_NAME = 'test-nextjs-detect';
const WORKERS = 2;

describe('Next.js Auto-Detection & Encryption Key', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-nextjs-detect-')));

    // package.json with next dependency triggers framework detection
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-nextjs', type: 'module', dependencies: { next: '16.0.0' } })
    );

    // Worker script that reports env info without exposing full key
    writeFileSync(
      join(tempDir, 'server.mjs'),
      `
import { createServer } from 'node:http';
const key = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    hasKey: !!key,
    keyLength: key ? key.length : 0,
    keyFingerprint: key ? key.slice(0, 8) : null,
    worker: process.env.ORKIFY_WORKER_ID ?? 'standalone',
  }));
});
server.listen(${PORT});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`
    );

    orkify(`up ${join(tempDir, 'server.mjs')} --cwd ${tempDir} -n ${APP_NAME} -w ${WORKERS}`);
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

  it('auto-generates NEXT_SERVER_ACTIONS_ENCRYPTION_KEY for Next.js apps', async () => {
    const { body } = await httpGet(`http://localhost:${PORT}/`);
    const data = JSON.parse(body);
    expect(data.hasKey).toBe(true);
    expect(data.keyLength).toBe(64); // 32 bytes = 64 hex chars
  }, 10_000);

  it('encryption key is consistent across all cluster workers', async () => {
    const fingerprints = new Set<string>();
    const workers = new Set<string>();

    for (let i = 0; i < 30; i++) {
      const { body } = await httpGet(`http://localhost:${PORT}/`);
      const data = JSON.parse(body);
      fingerprints.add(data.keyFingerprint);
      workers.add(data.worker);
    }

    expect(workers.size).toBeGreaterThanOrEqual(2);
    expect(fingerprints.size).toBe(1); // all workers share the same key
  }, 15_000);

  it('encryption key survives orkify reload', async () => {
    const { body: before } = await httpGet(`http://localhost:${PORT}/`);
    const fingerprintBefore = JSON.parse(before).keyFingerprint;

    orkify(`reload ${APP_NAME}`);
    await waitForClusterReady(WORKERS, PORT);

    const { body: after } = await httpGet(`http://localhost:${PORT}/`);
    const fingerprintAfter = JSON.parse(after).keyFingerprint;

    expect(fingerprintAfter).toBe(fingerprintBefore);
  }, 60_000);
});

describe('No encryption key without Next.js', () => {
  const NO_NEXT_PORT = 4231;
  const NO_NEXT_APP = 'test-no-nextjs';
  let tempDir: string;

  beforeAll(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-no-nextjs-')));

    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-no-nextjs', type: 'module', dependencies: { express: '4.0.0' } })
    );

    writeFileSync(
      join(tempDir, 'server.mjs'),
      `
import { createServer } from 'node:http';
const key = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY;
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ hasKey: !!key, keyLength: key ? key.length : 0 }));
});
server.listen(${NO_NEXT_PORT});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`
    );

    orkify(`up ${join(tempDir, 'server.mjs')} --cwd ${tempDir} -n ${NO_NEXT_APP}`);
    await waitForProcessOnline(NO_NEXT_APP);
    await waitForHttpReady(`http://localhost:${NO_NEXT_PORT}/`);
  }, 30_000);

  afterAll(() => {
    try {
      orkify(`delete ${NO_NEXT_APP}`);
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not set encryption key for non-Next.js apps', async () => {
    const { body } = await httpGet(`http://localhost:${NO_NEXT_PORT}/`);
    const data = JSON.parse(body);
    expect(data.hasKey).toBe(false);
  }, 10_000);
});
