import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpGet, orkify, sleep, waitForClusterReady } from './test-utils.js';

const ROOT = process.cwd();
const EXAMPLE_DIR = join(ROOT, 'examples', 'nextjs-isr');
const PORT = 4222;
const APP_NAME = 'test-nextjs-isr';
const WORKERS = 2;

/**
 * Helper to extract the rendered timestamp from the HTML response.
 * Pages embed: <strong>2026-03-04T01:23:45.678Z</strong>
 */
function extractTimestamp(html: string): null | string {
  const match = html.match(/<strong>(\d{4}-\d{2}-\d{2}T[\d:.]+Z)<\/strong>/);
  return match?.[1] ?? null;
}

describe('Next.js ISR Cache Handler (no cacheComponents)', () => {
  beforeAll(async () => {
    // Clean up stale processes from previous failed runs
    try {
      orkify(`delete ${APP_NAME}`);
    } catch {
      // ignore — process may not exist
    }

    if (!existsSync(join(EXAMPLE_DIR, 'node_modules'))) {
      execSync('npm install', { cwd: EXAMPLE_DIR, stdio: 'pipe', timeout: 120_000 });
    }

    execSync('npm run build', { cwd: EXAMPLE_DIR, stdio: 'pipe', timeout: 120_000 });

    orkify(
      `up ${join(EXAMPLE_DIR, 'node_modules/.bin/next')} -n ${APP_NAME} -w ${WORKERS} --cwd ${EXAMPLE_DIR} --args "start -p ${PORT}"`
    );
    await waitForClusterReady(WORKERS, PORT, 60_000, '/api/health');
  }, 180_000);

  afterAll(() => {
    try {
      orkify(`delete ${APP_NAME}`);
    } catch {
      // ignore
    }
  });

  it('health endpoint responds', async () => {
    const { status, body } = await httpGet(`http://localhost:${PORT}/api/health`);
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(data.ok).toBe(true);
  }, 10_000);

  it('ISR page serves cached content within revalidate window', async () => {
    // First request — isr-cache.ts handler serves from cache or renders fresh
    const { body: first } = await httpGet(`http://localhost:${PORT}/isr`);
    const ts1 = extractTimestamp(first);
    expect(ts1).toBeTruthy();

    // Second request within revalidate window (300s) — should be cached
    await sleep(500);
    const { body: second } = await httpGet(`http://localhost:${PORT}/isr`);
    const ts2 = extractTimestamp(second);

    expect(ts2).toBe(ts1);
  }, 15_000);

  it('ISR page serves same content across workers', async () => {
    // Prime the cache
    const { body: primed } = await httpGet(`http://localhost:${PORT}/isr`);
    const expected = extractTimestamp(primed);
    expect(expected).toBeTruthy();

    // Hit multiple times to reach different workers
    const timestamps = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { body } = await httpGet(`http://localhost:${PORT}/isr`);
      const ts = extractTimestamp(body);
      if (ts) timestamps.add(ts);
    }

    // All responses should have the same cached timestamp
    expect(timestamps.size).toBe(1);
  }, 15_000);

  it('revalidatePath invalidates cached ISR page', async () => {
    // Get the current cached ISR page
    const { body: before } = await httpGet(`http://localhost:${PORT}/isr`);
    const tsBefore = extractTimestamp(before);
    expect(tsBefore).toBeTruthy();

    // Invalidate via revalidatePath
    const { status } = await httpGet(`http://localhost:${PORT}/api/revalidate?path=/isr`);
    expect(status).toBe(200);

    // Wait for invalidation to propagate across workers
    await sleep(1000);

    // Next request should get fresh content with a new timestamp
    const { body: after } = await httpGet(`http://localhost:${PORT}/isr`);
    const tsAfter = extractTimestamp(after);
    expect(tsAfter).toBeTruthy();

    expect(tsAfter).not.toBe(tsBefore);
  }, 15_000);

  it('cache survives orkify reload', async () => {
    // Prime the ISR cache (300s revalidate — won't expire during test)
    const { body: before } = await httpGet(`http://localhost:${PORT}/isr`);
    const tsBefore = extractTimestamp(before);
    expect(tsBefore).toBeTruthy();

    // Reload all workers
    orkify(`reload ${APP_NAME}`);
    await waitForClusterReady(WORKERS, PORT, 60_000, '/api/health');

    // ISR cached page should still serve the same content after reload
    const { body: after } = await httpGet(`http://localhost:${PORT}/isr`);
    const tsAfter = extractTimestamp(after);

    expect(tsAfter).toBe(tsBefore);
  }, 60_000);
});
