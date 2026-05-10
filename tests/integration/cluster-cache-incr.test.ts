import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpGet, orkify, sleep, waitForClusterReady } from './test-utils.js';

const ROOT = process.cwd();
const CACHE_MODULE = pathToFileURL(join(ROOT, 'packages', 'cache', 'dist', 'index.js')).href;
const WORKERS = 2;

function createTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'orkify-cache-incr-test-')));
}

function writeIncrWorkerScript(dir: string, port: number): string {
  const scriptPath = join(dir, 'cache-incr-app.mjs');
  writeFileSync(
    scriptPath,
    `import { createServer } from 'node:http';
import { cache } from '${CACHE_MODULE}';

cache.configure({ fileBacked: false });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const params = url.searchParams;
  const wid = process.env.ORKIFY_WORKER_ID;

  res.setHeader('Content-Type', 'application/json');

  try {
    if (url.pathname === '/incr') {
      const key = params.get('key');
      const delta = params.has('delta') ? Number(params.get('delta')) : 1;
      const value = await cache.incr(key, delta);
      res.writeHead(200);
      res.end(JSON.stringify({ value, worker: wid }));
    } else if (url.pathname === '/incr-ttl') {
      const key = params.get('key');
      const ttlIfNew = Number(params.get('ttlIfNew'));
      const value = await cache.incr(key, 1, { ttlIfNew });
      res.writeHead(200);
      res.end(JSON.stringify({ value, worker: wid }));
    } else if (url.pathname === '/incr-idem') {
      const key = params.get('key');
      const idempotencyKey = params.get('idem');
      const value = await cache.incr(key, 1, { idempotencyKey });
      res.writeHead(200);
      res.end(JSON.stringify({ value, worker: wid }));
    } else if (url.pathname === '/get') {
      const value = cache.get(params.get('key'));
      res.writeHead(200);
      res.end(JSON.stringify({ value: value ?? null, worker: wid }));
    } else if (url.pathname === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, worker: wid, pid: process.pid }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    }
  } catch (e) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: e.message, worker: wid }));
  }
});

server.listen(${port});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`
  );
  return scriptPath;
}

describe('Cluster cache.incr', () => {
  const PORT = 4220;
  const APP_NAME = 'test-cache-incr';
  let tempDir: string;

  beforeAll(async () => {
    tempDir = createTempDir();
    writeIncrWorkerScript(tempDir, PORT);
    orkify(`up ${join(tempDir, 'cache-incr-app.mjs')} -n ${APP_NAME} -w ${WORKERS}`);
    await waitForClusterReady(WORKERS, PORT);
  }, 60000);

  afterAll(() => {
    try {
      orkify(`delete ${APP_NAME}`);
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('atomically counts N concurrent incrs across workers (no lost updates)', async () => {
    const key = `concurrent-${Date.now()}`;
    const TOTAL = 500;

    // Fire all incr requests in parallel — port-sharing distributes across workers
    const responses = await Promise.all(
      Array.from({ length: TOTAL }, () =>
        httpGet(`http://localhost:${PORT}/incr?key=${key}`).then(({ body }) => JSON.parse(body))
      )
    );

    // All requests succeeded
    expect(responses.every((r) => typeof r.value === 'number')).toBe(true);

    // Both workers handled some requests (proves IPC round-trip path was used)
    const workersHit = new Set(responses.map((r) => r.worker));
    expect(workersHit.size).toBeGreaterThan(1);

    // Final counter equals exactly TOTAL — no lost updates, no double counts
    await sleep(200); // allow last broadcast to apply on all workers
    const { body } = await httpGet(`http://localhost:${PORT}/get?key=${key}`);
    expect(JSON.parse(body).value).toBe(TOTAL);

    // Returned values should be the integers 1..TOTAL (a permutation, since
    // concurrent requests can interleave). Any duplicates would mean a race.
    const returned = responses.map((r) => r.value).sort((a, b) => a - b);
    const expected = Array.from({ length: TOTAL }, (_, i) => i + 1);
    expect(returned).toEqual(expected);
  }, 60000);

  it('explicit idempotencyKey deduplicates retries end-to-end', async () => {
    const key = `idem-${Date.now()}`;
    const idem = `caller-${Date.now()}`;

    // First call: real increment, returns 1
    const r1 = JSON.parse(
      (await httpGet(`http://localhost:${PORT}/incr-idem?key=${key}&idem=${idem}`)).body
    );
    expect(r1.value).toBe(1);

    // Second call with SAME idempotencyKey: dedup hit, returns 1 (no re-increment)
    const r2 = JSON.parse(
      (await httpGet(`http://localhost:${PORT}/incr-idem?key=${key}&idem=${idem}`)).body
    );
    expect(r2.value).toBe(1);

    // Different idempotencyKey: real increment, returns 2
    const r3 = JSON.parse(
      (await httpGet(`http://localhost:${PORT}/incr-idem?key=${key}&idem=${idem}-other`)).body
    );
    expect(r3.value).toBe(2);

    // Sanity: the actual counter is 2, not 3
    await sleep(100);
    const final = JSON.parse((await httpGet(`http://localhost:${PORT}/get?key=${key}`)).body);
    expect(final.value).toBe(2);
  }, 30000);

  it('ttlIfNew expires the bucket and lets it start fresh', async () => {
    const key = `ttl-${Date.now()}`;

    // Create with a 1-second TTL
    const r1 = JSON.parse(
      (await httpGet(`http://localhost:${PORT}/incr-ttl?key=${key}&ttlIfNew=1`)).body
    );
    expect(r1.value).toBe(1);

    // Subsequent incrs accumulate (ttlIfNew does NOT reset the timer)
    const r2 = JSON.parse(
      (await httpGet(`http://localhost:${PORT}/incr-ttl?key=${key}&ttlIfNew=600`)).body
    );
    expect(r2.value).toBe(2);

    // Wait for the original 1s TTL to expire
    await sleep(1500);

    // Bucket should reset — first incr after expiry returns 1
    const r3 = JSON.parse(
      (await httpGet(`http://localhost:${PORT}/incr-ttl?key=${key}&ttlIfNew=1`)).body
    );
    expect(r3.value).toBe(1);
  }, 30000);
});
