import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORKIFY_HOME } from './setup.js';
import {
  httpGet,
  orkify,
  sleep,
  waitForClusterReady,
  waitForDaemonKilled,
  waitForHttpReady,
  waitForProcessOnline,
} from './test-utils.js';

const ROOT = process.cwd();
const CACHE_MODULE = pathToFileURL(join(ROOT, 'dist', 'cache', 'index.js')).href;
const WORKERS = 2;

function createTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'orkify-cache-test-')));
}

function writeWorkerScript(dir: string, port: number): string {
  const scriptPath = join(dir, 'cache-app.mjs');
  writeFileSync(
    scriptPath,
    `import { createServer } from 'node:http';
import { cache } from '${CACHE_MODULE}';

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const params = url.searchParams;
  const wid = process.env.ORKIFY_WORKER_ID;

  res.setHeader('Content-Type', 'application/json');

  if (url.pathname === '/cache/set') {
    try {
      const opts = params.has('ttl') ? { ttl: Number(params.get('ttl')) } : undefined;
      cache.set(params.get('key'), params.get('value'), opts);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, worker: wid }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message, worker: wid }));
    }
  } else if (url.pathname === '/cache/set-large') {
    try {
      const size = Number(params.get('size') || 1024);
      cache.set('large-key', 'x'.repeat(size));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, worker: wid }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message, worker: wid }));
    }
  } else if (url.pathname === '/cache/get') {
    const value = cache.get(params.get('key'));
    res.writeHead(200);
    res.end(JSON.stringify({ value: value ?? null, worker: wid }));
  } else if (url.pathname === '/cache/delete') {
    cache.delete(params.get('key'));
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, worker: wid }));
  } else if (url.pathname === '/cache/clear') {
    cache.clear();
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, worker: wid }));
  } else if (url.pathname === '/cache/stats') {
    res.writeHead(200);
    res.end(JSON.stringify({ ...cache.stats(), worker: wid }));
  } else if (url.pathname === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, worker: wid, pid: process.pid }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  }
});

server.listen(${port});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`
  );
  return scriptPath;
}

/**
 * Make requests to multiple workers and verify a cache key's value.
 * Returns the set of worker IDs that were hit.
 */
async function verifyAcrossWorkers(
  port: number,
  key: string,
  expected: null | string,
  requests = 30
): Promise<Set<string>> {
  const workers = new Set<string>();
  for (let i = 0; i < requests; i++) {
    const { body } = await httpGet(`http://localhost:${port}/cache/get?key=${key}`);
    const data = JSON.parse(body);
    expect(data.value).toBe(expected);
    workers.add(data.worker);
  }
  return workers;
}

describe('Cluster Cache', () => {
  describe('cross-worker operations', () => {
    const PORT = 4200;
    const APP_NAME = 'test-cache-ops';
    let tempDir: string;

    beforeAll(async () => {
      tempDir = createTempDir();
      writeWorkerScript(tempDir, PORT);
      orkify(`up ${join(tempDir, 'cache-app.mjs')} -n ${APP_NAME} -w ${WORKERS}`);
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

    it('syncs cache.set across workers', async () => {
      await httpGet(`http://localhost:${PORT}/cache/set?key=greeting&value=hello`);
      await sleep(300);

      const workers = await verifyAcrossWorkers(PORT, 'greeting', 'hello');
      expect(workers.size).toBeGreaterThan(1);
    }, 30000);

    it('syncs cache.delete across workers', async () => {
      await httpGet(`http://localhost:${PORT}/cache/set?key=temp&value=exists`);
      await sleep(300);

      await httpGet(`http://localhost:${PORT}/cache/delete?key=temp`);
      await sleep(300);

      const workers = await verifyAcrossWorkers(PORT, 'temp', null);
      expect(workers.size).toBeGreaterThan(1);
    }, 30000);

    it('syncs cache.clear across workers', async () => {
      await httpGet(`http://localhost:${PORT}/cache/set?key=a&value=1`);
      await httpGet(`http://localhost:${PORT}/cache/set?key=b&value=2`);
      await sleep(300);

      await httpGet(`http://localhost:${PORT}/cache/clear`);
      await sleep(300);

      const workers = await verifyAcrossWorkers(PORT, 'a', null);
      expect(workers.size).toBeGreaterThan(1);

      // Verify second key is also gone
      const { body } = await httpGet(`http://localhost:${PORT}/cache/get?key=b`);
      expect(JSON.parse(body).value).toBeNull();
    }, 30000);
  });

  describe('TTL expiry', () => {
    const PORT = 4203;
    const APP_NAME = 'test-cache-ttl';
    let tempDir: string;

    beforeAll(async () => {
      tempDir = createTempDir();
      writeWorkerScript(tempDir, PORT);
      orkify(`up ${join(tempDir, 'cache-app.mjs')} -n ${APP_NAME} -w ${WORKERS}`);
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

    it('expires entries after TTL across all workers', async () => {
      // Set with a 2-second TTL
      await httpGet(`http://localhost:${PORT}/cache/set?key=ephemeral&value=short-lived&ttl=2`);
      await sleep(300);

      // Value should exist on all workers right now
      const workersBefore = await verifyAcrossWorkers(PORT, 'ephemeral', 'short-lived');
      expect(workersBefore.size).toBeGreaterThan(1);

      // Wait for TTL to expire
      await sleep(2500);

      // Value should be gone on all workers (lazy TTL check on get)
      const workersAfter = await verifyAcrossWorkers(PORT, 'ephemeral', null);
      expect(workersAfter.size).toBeGreaterThan(1);
    }, 30000);
  });

  describe('reload snapshot', () => {
    const PORT = 4201;
    const APP_NAME = 'test-cache-reload';
    let tempDir: string;

    beforeAll(async () => {
      tempDir = createTempDir();
      writeWorkerScript(tempDir, PORT);
      orkify(`up ${join(tempDir, 'cache-app.mjs')} -n ${APP_NAME} -w ${WORKERS}`);
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

    it('new workers receive cache snapshot after reload', async () => {
      // Set a value before reload
      await httpGet(`http://localhost:${PORT}/cache/set?key=survive&value=reload-test`);
      await sleep(300);

      // Verify it's set
      const { body: before } = await httpGet(`http://localhost:${PORT}/cache/get?key=survive`);
      expect(JSON.parse(before).value).toBe('reload-test');

      // Reload — old workers die, new workers spawn and get snapshot
      orkify(`reload ${APP_NAME}`);
      await waitForClusterReady(WORKERS, PORT);

      // New workers should have the cached data via snapshot
      const workers = await verifyAcrossWorkers(PORT, 'survive', 'reload-test');
      expect(workers.size).toBeGreaterThan(1);
    }, 60000);
  });

  describe('fork mode (single worker)', () => {
    const PORT = 4204;
    const APP_NAME = 'test-cache-fork';
    let tempDir: string;

    beforeAll(async () => {
      tempDir = createTempDir();
      writeWorkerScript(tempDir, PORT);
      orkify(`up ${join(tempDir, 'cache-app.mjs')} -n ${APP_NAME}`);
      await waitForProcessOnline(APP_NAME);
      await waitForHttpReady(`http://localhost:${PORT}/health`);
    }, 60000);

    afterAll(() => {
      try {
        orkify(`delete ${APP_NAME}`);
      } catch {
        // ignore
      }
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('cache works as a local Map without IPC', async () => {
      // Set a value
      const { status: setStatus, body: setBody } = await httpGet(
        `http://localhost:${PORT}/cache/set?key=fork-key&value=fork-value`
      );
      expect(setStatus).toBe(200);
      expect(JSON.parse(setBody).ok).toBe(true);

      // Get it back (same process, local Map)
      const { body: getBody } = await httpGet(`http://localhost:${PORT}/cache/get?key=fork-key`);
      expect(JSON.parse(getBody).value).toBe('fork-value');

      // Stats should reflect the entry
      const { body: statsBody } = await httpGet(`http://localhost:${PORT}/cache/stats`);
      const stats = JSON.parse(statsBody);
      expect(stats.size).toBeGreaterThanOrEqual(1);
      expect(stats.hits).toBeGreaterThanOrEqual(1);

      // Delete works
      await httpGet(`http://localhost:${PORT}/cache/delete?key=fork-key`);
      const { body: afterDelete } = await httpGet(
        `http://localhost:${PORT}/cache/get?key=fork-key`
      );
      expect(JSON.parse(afterDelete).value).toBeNull();
    }, 30000);
  });

  describe('non-persistence on orkify down', () => {
    const PORT = 4205;
    const APP_NAME = 'test-cache-nodown';
    let tempDir: string;
    let scriptPath: string;

    beforeAll(() => {
      tempDir = createTempDir();
      writeWorkerScript(tempDir, PORT);
      scriptPath = join(tempDir, 'cache-app.mjs');
    });

    afterAll(() => {
      try {
        orkify(`delete ${APP_NAME}`);
      } catch {
        // ignore
      }
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('cache is empty after orkify down + orkify up', async () => {
      // Start process and set cache values
      orkify(`up ${scriptPath} -n ${APP_NAME} -w ${WORKERS}`);
      await waitForClusterReady(WORKERS, PORT);

      await httpGet(`http://localhost:${PORT}/cache/set?key=volatile&value=will-be-lost`);
      await sleep(300);

      // Verify it's set
      const { body: before } = await httpGet(`http://localhost:${PORT}/cache/get?key=volatile`);
      expect(JSON.parse(before).value).toBe('will-be-lost');

      // Stop the process — no cache persistence on down
      orkify(`down ${APP_NAME}`);

      // Start it again — cache should be empty
      orkify(`up ${scriptPath} -n ${APP_NAME} -w ${WORKERS}`);
      await waitForClusterReady(WORKERS, PORT);

      // Cache should NOT have been restored
      const workers = await verifyAcrossWorkers(PORT, 'volatile', null);
      expect(workers.size).toBeGreaterThan(1);
    }, 60000);
  });

  describe('value size validation', () => {
    const PORT = 4206;
    const APP_NAME = 'test-cache-large';
    let tempDir: string;

    beforeAll(async () => {
      tempDir = createTempDir();
      writeWorkerScript(tempDir, PORT);
      orkify(`up ${join(tempDir, 'cache-app.mjs')} -n ${APP_NAME} -w ${WORKERS}`);
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

    it('rejects values exceeding maxValueSize', async () => {
      // Default maxValueSize is 1 MB (1,048,576 bytes)
      // Request the worker to generate and set a 2 MB string
      const { status, body } = await httpGet(
        `http://localhost:${PORT}/cache/set-large?size=2000000`
      );

      expect(status).toBe(400);
      const data = JSON.parse(body);
      expect(data.error).toContain('exceeds max');
      expect(data.error).toContain('bytes');
    }, 30000);
  });

  describe('persistence across daemon restart', () => {
    const PORT = 4202;
    const APP_NAME = 'test-cache-persist';
    let tempDir: string;
    let scriptPath: string;

    beforeAll(() => {
      tempDir = createTempDir();
      writeWorkerScript(tempDir, PORT);
      scriptPath = join(tempDir, 'cache-app.mjs');
    });

    afterAll(() => {
      try {
        orkify(`delete ${APP_NAME}`);
      } catch {
        // ignore
      }
      try {
        orkify('kill --force');
      } catch {
        // ignore
      }
      // Clean up cache persistence files
      const cacheDir = join(ORKIFY_HOME, 'cache');
      rmSync(cacheDir, { recursive: true, force: true });
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('persists cache on daemon kill and restores on restart', async () => {
      // Start process and set cache values
      orkify(`up ${scriptPath} -n ${APP_NAME} -w ${WORKERS}`);
      await waitForClusterReady(WORKERS, PORT);

      await httpGet(`http://localhost:${PORT}/cache/set?key=durable&value=persist-test`);
      await sleep(300);

      // Verify it's set
      const { body: before } = await httpGet(`http://localhost:${PORT}/cache/get?key=durable`);
      expect(JSON.parse(before).value).toBe('persist-test');

      // Kill daemon gracefully — triggers cache persistence via KILL_DAEMON handler
      orkify('kill');
      await waitForDaemonKilled(10000);

      // Start process again (auto-starts new daemon)
      // New ClusterWrapper restores cache from ~/.orkify/cache/<name>.json
      orkify(`up ${scriptPath} -n ${APP_NAME} -w ${WORKERS}`);
      await waitForClusterReady(WORKERS, PORT);

      // Cache should have been restored from disk and snapshot sent to workers
      const workers = await verifyAcrossWorkers(PORT, 'durable', 'persist-test');
      expect(workers.size).toBeGreaterThan(1);
    }, 90000);
  });
});
