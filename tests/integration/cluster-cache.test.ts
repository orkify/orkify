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
const CACHE_MODULE = pathToFileURL(join(ROOT, 'packages', 'cache', 'dist', 'index.js')).href;
const WORKERS = 2;

function createTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'orkify-cache-test-')));
}

/**
 * Write a worker script with file-backed cache enabled and small limits
 * to force eviction to disk. Includes /cache/get-async endpoint.
 */
function writeFileBackedWorkerScript(dir: string, port: number): string {
  const scriptPath = join(dir, 'cache-fb-app.mjs');
  writeFileSync(
    scriptPath,
    `import { createServer } from 'node:http';
import { cache } from '${CACHE_MODULE}';

// Small limits to force eviction to disk quickly
cache.configure({ fileBacked: true, maxEntries: 5, maxMemorySize: 500 });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const params = url.searchParams;
  const wid = process.env.ORKIFY_WORKER_ID;

  res.setHeader('Content-Type', 'application/json');

  try {
    if (url.pathname === '/cache/set') {
      const opts = {};
      if (params.has('ttl')) opts.ttl = Number(params.get('ttl'));
      if (params.has('tag')) opts.tags = [params.get('tag')];
      cache.set(params.get('key'), params.get('value'), opts);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, worker: wid }));
    } else if (url.pathname === '/cache/get') {
      const value = cache.get(params.get('key'));
      res.writeHead(200);
      res.end(JSON.stringify({ value: value ?? null, worker: wid }));
    } else if (url.pathname === '/cache/get-async') {
      const value = await cache.getAsync(params.get('key'));
      res.writeHead(200);
      res.end(JSON.stringify({ value: value ?? null, worker: wid }));
    } else if (url.pathname === '/cache/stats') {
      res.writeHead(200);
      res.end(JSON.stringify({ ...cache.stats(), worker: wid }));
    } else if (url.pathname === '/cache/invalidate-tag') {
      cache.invalidateTag(params.get('tag'));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, worker: wid }));
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

/**
 * Write a worker script with small memory limits but NO file-backed storage.
 * Evicted entries are lost. Includes /cache/get-async endpoint for contrast testing.
 */
function writeSmallMemoryWorkerScript(dir: string, port: number): string {
  const scriptPath = join(dir, 'cache-small-app.mjs');
  writeFileSync(
    scriptPath,
    `import { createServer } from 'node:http';
import { cache } from '${CACHE_MODULE}';

// Same small limits as file-backed tests, but NO fileBacked — evictions are permanent
cache.configure({ fileBacked: false, maxEntries: 5, maxMemorySize: 500 });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const params = url.searchParams;
  const wid = process.env.ORKIFY_WORKER_ID;

  res.setHeader('Content-Type', 'application/json');

  try {
    if (url.pathname === '/cache/set') {
      const opts = {};
      if (params.has('ttl')) opts.ttl = Number(params.get('ttl'));
      if (params.has('tag')) opts.tags = [params.get('tag')];
      cache.set(params.get('key'), params.get('value'), opts);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, worker: wid }));
    } else if (url.pathname === '/cache/get') {
      const value = cache.get(params.get('key'));
      res.writeHead(200);
      res.end(JSON.stringify({ value: value ?? null, worker: wid }));
    } else if (url.pathname === '/cache/get-async') {
      const value = await cache.getAsync(params.get('key'));
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

function writeWorkerScript(dir: string, port: number): string {
  const scriptPath = join(dir, 'cache-app.mjs');
  writeFileSync(
    scriptPath,
    `import { createServer } from 'node:http';
import { cache } from '${CACHE_MODULE}';

// Disable file-backed mode — these tests exercise the snapshot-based persistence path
cache.configure({ fileBacked: false });

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
  } else if (url.pathname === '/cache/set-map') {
    try {
      const key = params.get('key') || 'map-key';
      const rawEntries = (params.get('entries') || '').split(',').map(p => {
        const [k, v] = p.split(':');
        return [k, Number(v)];
      });
      cache.set(key, new Map(rawEntries));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, worker: wid }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message, worker: wid }));
    }
  } else if (url.pathname === '/cache/set-set') {
    try {
      const key = params.get('key') || 'set-key';
      const items = (params.get('items') || '').split(',');
      cache.set(key, new Set(items));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, worker: wid }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message, worker: wid }));
    }
  } else if (url.pathname === '/cache/get-type') {
    const key = params.get('key');
    const value = cache.get(key);
    const info = {
      isNull: value === null || value === undefined,
      isMap: value instanceof Map,
      isSet: value instanceof Set,
      worker: wid,
    };
    if (value instanceof Map) {
      info.entries = Array.from(value.entries());
    } else if (value instanceof Set) {
      info.items = Array.from(value);
    }
    res.writeHead(200);
    res.end(JSON.stringify(info));
  } else if (url.pathname === '/cache/set-tagged') {
    try {
      const key = params.get('key');
      const value = params.get('value');
      const tag = params.get('tag');
      const ttl = params.has('ttl') ? Number(params.get('ttl')) : undefined;
      const opts = {};
      if (tag) opts.tags = [tag];
      if (ttl) opts.ttl = ttl;
      cache.set(key, value, opts);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, worker: wid }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message, worker: wid }));
    }
  } else if (url.pathname === '/cache/invalidate-tag') {
    const tag = params.get('tag');
    cache.invalidateTag(tag);
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, worker: wid }));
  } else if (url.pathname === '/cache/get-tag-expiration') {
    const tags = (params.get('tags') || '').split(',').filter(Boolean);
    const ts = cache.getTagExpiration(tags);
    res.writeHead(200);
    res.end(JSON.stringify({ timestamp: ts, worker: wid }));
  } else if (url.pathname === '/cache/update-tag-timestamp') {
    const tag = params.get('tag');
    const ts = params.has('timestamp') ? Number(params.get('timestamp')) : undefined;
    cache.updateTagTimestamp(tag, ts);
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, worker: wid }));
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

  describe('tag invalidation', () => {
    const PORT = 4207;
    const APP_NAME = 'test-cache-tags';
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

    it('invalidateTag on one worker deletes all tagged keys on all workers', async () => {
      // Set multiple keys with the same tag on one worker
      await httpGet(
        `http://localhost:${PORT}/cache/set-tagged?key=config:proj1:a&value=va&tag=project:proj1&ttl=60`
      );
      await httpGet(
        `http://localhost:${PORT}/cache/set-tagged?key=config:proj1:b&value=vb&tag=project:proj1&ttl=60`
      );
      await sleep(300);

      // Verify both exist across workers
      const workers1 = await verifyAcrossWorkers(PORT, 'config:proj1:a', 'va');
      expect(workers1.size).toBeGreaterThan(1);

      // Invalidate the tag from any worker
      await httpGet(`http://localhost:${PORT}/cache/invalidate-tag?tag=project:proj1`);
      await sleep(300);

      // Both keys should be gone on all workers
      const workersA = await verifyAcrossWorkers(PORT, 'config:proj1:a', null);
      expect(workersA.size).toBeGreaterThan(1);
      const workersB = await verifyAcrossWorkers(PORT, 'config:proj1:b', null);
      expect(workersB.size).toBeGreaterThan(1);
    }, 30000);

    it('tags survive reload (snapshot preserves tag index)', async () => {
      // Set tagged entries
      await httpGet(
        `http://localhost:${PORT}/cache/set-tagged?key=reload-tag:a&value=v1&tag=reload-group&ttl=60`
      );
      await httpGet(
        `http://localhost:${PORT}/cache/set-tagged?key=reload-tag:b&value=v2&tag=reload-group&ttl=60`
      );
      await sleep(300);

      // Reload workers
      orkify(`reload ${APP_NAME}`);
      await waitForClusterReady(WORKERS, PORT);

      // Tags should still work after reload
      await httpGet(`http://localhost:${PORT}/cache/invalidate-tag?tag=reload-group`);
      await sleep(300);

      const workers = await verifyAcrossWorkers(PORT, 'reload-tag:a', null);
      expect(workers.size).toBeGreaterThan(1);
    }, 60000);
  });

  describe('tag timestamps', () => {
    const PORT = 4210;
    const APP_NAME = 'test-cache-tag-ts';
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

    it('invalidateTag timestamp syncs across workers', async () => {
      // Invalidate a tag on one worker
      await httpGet(`http://localhost:${PORT}/cache/invalidate-tag?tag=sync-tag`);
      await sleep(300);

      // All workers should have the timestamp
      const workers = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const { body } = await httpGet(
          `http://localhost:${PORT}/cache/get-tag-expiration?tags=sync-tag`
        );
        const data = JSON.parse(body);
        expect(data.timestamp).toBeGreaterThan(0);
        workers.add(data.worker);
      }
      expect(workers.size).toBeGreaterThan(1);
    }, 30000);

    it('updateTagTimestamp syncs across workers', async () => {
      await httpGet(
        `http://localhost:${PORT}/cache/update-tag-timestamp?tag=manual-tag&timestamp=99999`
      );
      await sleep(300);

      const workers = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const { body } = await httpGet(
          `http://localhost:${PORT}/cache/get-tag-expiration?tags=manual-tag`
        );
        const data = JSON.parse(body);
        expect(data.timestamp).toBe(99999);
        workers.add(data.worker);
      }
      expect(workers.size).toBeGreaterThan(1);
    }, 30000);

    it('tag timestamps survive reload via snapshot', async () => {
      // Set a tag timestamp
      await httpGet(
        `http://localhost:${PORT}/cache/update-tag-timestamp?tag=reload-tag&timestamp=12345`
      );
      await sleep(300);

      // Reload workers
      orkify(`reload ${APP_NAME}`);
      await waitForClusterReady(WORKERS, PORT);

      // New workers should have the tag timestamp from snapshot
      const workers = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const { body } = await httpGet(
          `http://localhost:${PORT}/cache/get-tag-expiration?tags=reload-tag`
        );
        const data = JSON.parse(body);
        expect(data.timestamp).toBe(12345);
        workers.add(data.worker);
      }
      expect(workers.size).toBeGreaterThan(1);
    }, 60000);
  });

  describe('V8 values', () => {
    const PORT = 4208;
    const APP_NAME = 'test-cache-v8';
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

    it('Map value syncs across workers via IPC', async () => {
      await httpGet(`http://localhost:${PORT}/cache/set-map?key=my-map&entries=a:1,b:2`);
      await sleep(300);

      // Verify on multiple workers
      const workers = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const { body } = await httpGet(`http://localhost:${PORT}/cache/get-type?key=my-map`);
        const data = JSON.parse(body);
        expect(data.isMap).toBe(true);
        expect(data.entries).toEqual(
          expect.arrayContaining([
            ['a', 1],
            ['b', 2],
          ])
        );
        workers.add(data.worker);
      }
      expect(workers.size).toBeGreaterThan(1);
    }, 30000);

    it('Set value syncs across workers via IPC', async () => {
      await httpGet(`http://localhost:${PORT}/cache/set-set?key=my-set&items=x,y,z`);
      await sleep(300);

      const workers = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const { body } = await httpGet(`http://localhost:${PORT}/cache/get-type?key=my-set`);
        const data = JSON.parse(body);
        expect(data.isSet).toBe(true);
        expect(data.items).toEqual(expect.arrayContaining(['x', 'y', 'z']));
        workers.add(data.worker);
      }
      expect(workers.size).toBeGreaterThan(1);
    }, 30000);
  });

  describe('V8 values persist across daemon restart', () => {
    const PORT = 4209;
    const APP_NAME = 'test-cache-v8-persist';
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
      const cacheDir = join(ORKIFY_HOME, 'cache');
      rmSync(cacheDir, { recursive: true, force: true });
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('V8 values persist on daemon kill and restore on restart', async () => {
      orkify(`up ${scriptPath} -n ${APP_NAME} -w ${WORKERS}`);
      await waitForClusterReady(WORKERS, PORT);

      // Set a Map value
      await httpGet(`http://localhost:${PORT}/cache/set-map?key=persist-map&entries=x:10,y:20`);
      await sleep(300);

      // Verify it's set
      const { body: before } = await httpGet(
        `http://localhost:${PORT}/cache/get-type?key=persist-map`
      );
      expect(JSON.parse(before).isMap).toBe(true);

      // Kill daemon gracefully
      orkify('kill');
      await waitForDaemonKilled(10000);

      // Restart
      orkify(`up ${scriptPath} -n ${APP_NAME} -w ${WORKERS}`);
      await waitForClusterReady(WORKERS, PORT);

      // Map should be restored
      const workers = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const { body } = await httpGet(`http://localhost:${PORT}/cache/get-type?key=persist-map`);
        const data = JSON.parse(body);
        expect(data.isMap).toBe(true);
        expect(data.entries).toEqual(
          expect.arrayContaining([
            ['x', 10],
            ['y', 20],
          ])
        );
        workers.add(data.worker);
      }
      expect(workers.size).toBeGreaterThan(1);
    }, 90000);
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
      // Cold daemon restart is slow on Windows CI — use extended timeout
      await waitForClusterReady(WORKERS, PORT, 90_000);

      // Cache should have been restored from disk and snapshot sent to workers
      const workers = await verifyAcrossWorkers(PORT, 'durable', 'persist-test');
      expect(workers.size).toBeGreaterThan(1);
    }, 90000);
  });

  describe('file-backed cache', () => {
    const PORT = 4211;
    const APP_NAME = 'test-cache-fb';
    let tempDir: string;
    let scriptPath: string;

    beforeAll(() => {
      tempDir = createTempDir();
      scriptPath = writeFileBackedWorkerScript(tempDir, PORT);
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
      const cacheDir = join(ORKIFY_HOME, 'cache');
      rmSync(cacheDir, { recursive: true, force: true });
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('evicted entries are recoverable via getAsync', async () => {
      orkify(`up ${scriptPath} -n ${APP_NAME} -w ${WORKERS}`);
      await waitForClusterReady(WORKERS, PORT);

      // Fill cache past the small limits (maxEntries: 5, maxMemorySize: 500)
      // to force eviction to disk. Set entries with unique keys.
      for (let i = 0; i < 8; i++) {
        await httpGet(`http://localhost:${PORT}/cache/set?key=entry-${i}&value=val-${i}`);
        await sleep(100);
      }
      await sleep(500);

      // The earliest entries should have been evicted from memory
      // Sync get may return null for evicted entries
      const { body: syncBody } = await httpGet(`http://localhost:${PORT}/cache/get?key=entry-0`);
      const syncResult = JSON.parse(syncBody);

      // But getAsync should recover them from disk
      const { body: asyncBody } = await httpGet(
        `http://localhost:${PORT}/cache/get-async?key=entry-0`
      );
      const asyncResult = JSON.parse(asyncBody);

      // If sync returned null (evicted), async should still find it on disk
      if (syncResult.value === null) {
        expect(asyncResult.value).toBe('val-0');
      } else {
        // Entry was still in memory — that's fine too, just verify it works
        expect(asyncResult.value).toBe('val-0');
      }

      // Verify the latest entries are still in memory
      const { body: latestBody } = await httpGet(`http://localhost:${PORT}/cache/get?key=entry-7`);
      expect(JSON.parse(latestBody).value).toBe('val-7');
    }, 60000);

    it('survives orkify kill and restart', async () => {
      // Ensure process is running (may already be from previous test)
      try {
        await httpGet(`http://localhost:${PORT}/health`);
      } catch {
        orkify(`up ${scriptPath} -n ${APP_NAME} -w ${WORKERS}`);
        await waitForClusterReady(WORKERS, PORT);
      }

      // Set entries — some will be in memory, some evicted to disk
      for (let i = 0; i < 8; i++) {
        await httpGet(`http://localhost:${PORT}/cache/set?key=persist-${i}&value=pval-${i}`);
        await sleep(100);
      }
      await sleep(500);

      // Kill daemon gracefully — triggers flush of in-memory entries to disk
      orkify('kill');
      await waitForDaemonKilled(10000);

      // Restart
      orkify(`up ${scriptPath} -n ${APP_NAME} -w ${WORKERS}`);
      await waitForClusterReady(WORKERS, PORT);

      // Both early (evicted) and late (in-memory at kill) entries should be accessible
      // via getAsync, since all were flushed to disk on shutdown
      const { body: earlyBody } = await httpGet(
        `http://localhost:${PORT}/cache/get-async?key=persist-0`
      );
      expect(JSON.parse(earlyBody).value).toBe('pval-0');

      const { body: lateBody } = await httpGet(
        `http://localhost:${PORT}/cache/get-async?key=persist-7`
      );
      expect(JSON.parse(lateBody).value).toBe('pval-7');
    }, 90000);

    it('tag invalidation clears disk entries', async () => {
      // Ensure process is running
      try {
        await httpGet(`http://localhost:${PORT}/health`);
      } catch {
        orkify(`up ${scriptPath} -n ${APP_NAME} -w ${WORKERS}`);
        await waitForClusterReady(WORKERS, PORT);
      }

      // Set tagged entries that will overflow to disk
      for (let i = 0; i < 8; i++) {
        await httpGet(
          `http://localhost:${PORT}/cache/set?key=tagged-${i}&value=tv-${i}&tag=fb-group`
        );
        await sleep(100);
      }
      await sleep(500);

      // Verify an evicted entry is on disk
      const { body: beforeBody } = await httpGet(
        `http://localhost:${PORT}/cache/get-async?key=tagged-0`
      );
      expect(JSON.parse(beforeBody).value).toBe('tv-0');

      // Invalidate the tag — should clear both memory and disk
      await httpGet(`http://localhost:${PORT}/cache/invalidate-tag?tag=fb-group`);
      await sleep(500);

      // All entries with that tag should be gone, even from disk
      const { body: afterBody } = await httpGet(
        `http://localhost:${PORT}/cache/get-async?key=tagged-0`
      );
      expect(JSON.parse(afterBody).value).toBeNull();

      const { body: after7Body } = await httpGet(
        `http://localhost:${PORT}/cache/get-async?key=tagged-7`
      );
      expect(JSON.parse(after7Body).value).toBeNull();
    }, 60000);
  });

  describe('file-backed cache (fork mode)', () => {
    const PORT = 4212;
    const APP_NAME = 'test-cache-fb-fork';
    let tempDir: string;
    let scriptPath: string;

    beforeAll(() => {
      tempDir = createTempDir();
      scriptPath = writeFileBackedWorkerScript(tempDir, PORT);
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
      const cacheDir = join(ORKIFY_HOME, 'cache');
      rmSync(cacheDir, { recursive: true, force: true });
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('evicted entries are recoverable via getAsync in fork mode', async () => {
      orkify(`up ${scriptPath} -n ${APP_NAME}`);
      await waitForProcessOnline(APP_NAME);
      await waitForHttpReady(`http://localhost:${PORT}/health`);

      // Fill cache past the small limits to force eviction to disk
      for (let i = 0; i < 8; i++) {
        await httpGet(`http://localhost:${PORT}/cache/set?key=fk-${i}&value=fv-${i}`);
        await sleep(100);
      }
      await sleep(500);

      // getAsync should recover evicted entries from disk
      const { body } = await httpGet(`http://localhost:${PORT}/cache/get-async?key=fk-0`);
      expect(JSON.parse(body).value).toBe('fv-0');

      // Latest entries should still be in memory
      const { body: latestBody } = await httpGet(`http://localhost:${PORT}/cache/get?key=fk-7`);
      expect(JSON.parse(latestBody).value).toBe('fv-7');
    }, 60000);

    it('survives orkify kill and restart in fork mode', async () => {
      // Ensure process is running
      try {
        await httpGet(`http://localhost:${PORT}/health`);
      } catch {
        orkify(`up ${scriptPath} -n ${APP_NAME}`);
        await waitForProcessOnline(APP_NAME);
        await waitForHttpReady(`http://localhost:${PORT}/health`);
      }

      // Set entries
      for (let i = 0; i < 8; i++) {
        await httpGet(`http://localhost:${PORT}/cache/set?key=fp-${i}&value=fpv-${i}`);
        await sleep(100);
      }
      await sleep(500);

      // Kill daemon — triggers flush
      orkify('kill');
      await waitForDaemonKilled(10000);

      // Restart in fork mode
      orkify(`up ${scriptPath} -n ${APP_NAME}`);
      await waitForProcessOnline(APP_NAME);
      await waitForHttpReady(`http://localhost:${PORT}/health`);

      // Both early and late entries should be accessible via getAsync
      const { body: earlyBody } = await httpGet(
        `http://localhost:${PORT}/cache/get-async?key=fp-0`
      );
      expect(JSON.parse(earlyBody).value).toBe('fpv-0');

      const { body: lateBody } = await httpGet(`http://localhost:${PORT}/cache/get-async?key=fp-7`);
      expect(JSON.parse(lateBody).value).toBe('fpv-7');
    }, 90000);
  });

  describe('without file-backed (evicted entries are lost)', () => {
    const PORT = 4213;
    const APP_NAME = 'test-cache-no-fb';
    let tempDir: string;
    let scriptPath: string;

    beforeAll(async () => {
      tempDir = createTempDir();
      scriptPath = writeSmallMemoryWorkerScript(tempDir, PORT);
      orkify(`up ${scriptPath} -n ${APP_NAME}`);
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

    it('evicted entries are NOT recoverable without fileBacked', async () => {
      // Fill cache past the small limits (same limits as file-backed tests)
      for (let i = 0; i < 8; i++) {
        await httpGet(`http://localhost:${PORT}/cache/set?key=nofb-${i}&value=nv-${i}`);
        await sleep(100);
      }
      await sleep(500);

      // Latest entries should be in memory
      const { body: latestBody } = await httpGet(`http://localhost:${PORT}/cache/get?key=nofb-7`);
      expect(JSON.parse(latestBody).value).toBe('nv-7');

      // Early entries were evicted — getAsync can NOT recover them (no disk fallback)
      const { body: asyncBody } = await httpGet(
        `http://localhost:${PORT}/cache/get-async?key=nofb-0`
      );
      expect(JSON.parse(asyncBody).value).toBeNull();

      // Sync get also returns null
      const { body: syncBody } = await httpGet(`http://localhost:${PORT}/cache/get?key=nofb-0`);
      expect(JSON.parse(syncBody).value).toBeNull();
    }, 30000);
  });
});
