import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpGet, orkify, sleep, waitForClusterReady } from './test-utils.js';

const ROOT = process.cwd();
const USE_CACHE_MODULE = pathToFileURL(join(ROOT, 'dist', 'next', 'use-cache.js')).href;
const PORT = 4240;
const APP_NAME = 'test-isr-coalesce';
const WORKERS = 2;

let tempDir: string;

function createWorkerScript(dir: string): string {
  const scriptPath = join(dir, 'coalesce-app.mjs');
  writeFileSync(
    scriptPath,
    `
import { createServer } from 'node:http';
const handlerModule = await import('${USE_CACHE_MODULE}');
const handler = handlerModule.default;

function makeStream(data) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(data));
      controller.close();
    }
  });
}

async function readStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const wid = process.env.ORKIFY_WORKER_ID;
  res.setHeader('Content-Type', 'application/json');

  try {
    if (url.pathname === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, worker: wid }));
    }
    else if (url.pathname === '/populate') {
      const key = url.searchParams.get('key') || 'test';
      const revalidate = Number(url.searchParams.get('revalidate') || '2');
      const data = url.searchParams.get('data') || 'cached-' + Date.now();

      const entry = {
        value: makeStream(data),
        tags: [],
        stale: 0,
        timestamp: Date.now(),
        expire: 0,
        revalidate,
      };
      await handler.set(key, Promise.resolve(entry));
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, worker: wid, data }));
    }
    else if (url.pathname === '/check') {
      const key = url.searchParams.get('key') || 'test';
      const result = await handler.get(key, []);
      if (result === undefined) {
        res.writeHead(200);
        res.end(JSON.stringify({ hit: false, worker: wid }));
      } else {
        const data = await readStream(result.value);
        res.writeHead(200);
        res.end(JSON.stringify({
          hit: true,
          worker: wid,
          timestamp: result.timestamp,
          data,
        }));
      }
    }
    else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    }
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message, worker: wid }));
  }
});

server.listen(${PORT});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`
  );
  return scriptPath;
}

describe('ISR Request Coalescing', () => {
  beforeAll(async () => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-coalesce-test-')));
    const script = createWorkerScript(tempDir);
    orkify(`up ${script} -n ${APP_NAME} -w ${WORKERS}`);
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

  it('coalesces concurrent revalidation requests across workers', async () => {
    // Populate cache with a 2-second revalidation window
    const { body: populateRes } = await httpGet(
      `http://localhost:${PORT}/populate?key=coalesce-test&revalidate=2&data=original`
    );
    expect(JSON.parse(populateRes).ok).toBe(true);

    // Wait for cache propagation + revalidation window expiry
    await sleep(3000);

    // Send 20 concurrent requests — coalescing should serve stale to most
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        httpGet(`http://localhost:${PORT}/check?key=coalesce-test`).then(({ body }) =>
          JSON.parse(body)
        )
      )
    );

    const hits = results.filter((r: { hit: boolean }) => r.hit === true);
    const misses = results.filter((r: { hit: boolean }) => r.hit === false);
    const workers = new Set(results.map((r: { worker: string }) => r.worker));

    // Without coalescing: all 20 would miss (trigger revalidation)
    // With coalescing: at most ~2 miss (one per worker, race window)
    expect(hits.length).toBeGreaterThan(0);

    // Stale content should be the original data
    for (const hit of hits) {
      expect(hit.data).toBe('original');
    }

    // Should reach multiple workers
    expect(workers.size).toBeGreaterThanOrEqual(2);

    // Misses should be few (at most one per worker + small race margin)
    expect(misses.length).toBeLessThanOrEqual(WORKERS + 2);
  }, 30_000);

  it('clears revalidation lock after set()', async () => {
    // Simulate completing revalidation by storing fresh content
    const { body: refreshRes } = await httpGet(
      `http://localhost:${PORT}/populate?key=coalesce-test&revalidate=2&data=refreshed`
    );
    expect(JSON.parse(refreshRes).ok).toBe(true);

    // Wait for IPC propagation
    await sleep(500);

    // Should immediately serve the fresh content (lock cleared by set())
    const { body } = await httpGet(`http://localhost:${PORT}/check?key=coalesce-test`);
    const result = JSON.parse(body);
    expect(result.hit).toBe(true);
    expect(result.data).toBe('refreshed');
  }, 10_000);
});
