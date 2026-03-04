import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpGet, orkify, sleep, waitForClusterReady, waitForHttpReady } from './test-utils.js';

const ROOT = process.cwd();
const EXAMPLE_DIR = join(ROOT, 'examples', 'nextjs');
const PORT = 4220;
const APP_NAME = 'test-nextjs-cache';
const WORKERS = 2;

/**
 * Helper to extract the rendered timestamp from the HTML response.
 * Pages embed: <strong>2026-03-04T01:23:45.678Z</strong>
 */
function extractTimestamp(html: string): null | string {
  const match = html.match(/<strong>(\d{4}-\d{2}-\d{2}T[\d:.]+Z)<\/strong>/);
  return match?.[1] ?? null;
}

describe('Next.js Cache Handlers', () => {
  // Build the example app once before all tests
  beforeAll(async () => {
    // Skip if example app hasn't been installed
    if (!existsSync(join(EXAMPLE_DIR, 'node_modules'))) {
      execSync('npm install', { cwd: EXAMPLE_DIR, stdio: 'pipe', timeout: 120_000 });
    }

    // Build the Next.js app
    execSync('npm run build', { cwd: EXAMPLE_DIR, stdio: 'pipe', timeout: 120_000 });

    // Start with orkify in cluster mode
    orkify(
      `up ${join(EXAMPLE_DIR, 'node_modules/.bin/next')} start -p ${PORT} -n ${APP_NAME} -w ${WORKERS}`
    );
    await waitForClusterReady(WORKERS, PORT);
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
    expect(data.pid).toBeGreaterThan(0);
  }, 10_000);

  it('ISR page serves cached content within revalidate window', async () => {
    // First request populates cache
    const { body: first } = await httpGet(`http://localhost:${PORT}/isr`);
    const ts1 = extractTimestamp(first);
    expect(ts1).toBeTruthy();

    // Second request within revalidate window should serve same content
    await sleep(500);
    const { body: second } = await httpGet(`http://localhost:${PORT}/isr`);
    const ts2 = extractTimestamp(second);

    expect(ts2).toBe(ts1);
  }, 15_000);

  it('cached page serves same content on repeated requests', async () => {
    const { body: first } = await httpGet(`http://localhost:${PORT}/cached`);
    const ts1 = extractTimestamp(first);

    await sleep(500);
    const { body: second } = await httpGet(`http://localhost:${PORT}/cached`);
    const ts2 = extractTimestamp(second);

    // If caching works, timestamps should be identical
    expect(ts2).toBe(ts1);
  }, 15_000);

  it('revalidateTag invalidates cached content', async () => {
    // Get the current cached posts page
    const { body: before } = await httpGet(`http://localhost:${PORT}/posts`);
    const tsBefore = extractTimestamp(before);
    expect(tsBefore).toBeTruthy();

    // Invalidate the 'posts' tag
    const { status } = await httpGet(`http://localhost:${PORT}/api/revalidate?tag=posts`);
    expect(status).toBe(200);

    // Wait a moment for invalidation to propagate
    await sleep(1000);

    // Next request should get fresh content with a new timestamp
    const { body: after } = await httpGet(`http://localhost:${PORT}/posts`);
    const tsAfter = extractTimestamp(after);
    expect(tsAfter).toBeTruthy();

    // The timestamp should be different (re-rendered)
    expect(tsAfter).not.toBe(tsBefore);
  }, 15_000);

  it('cache works across workers', async () => {
    // Hit the health endpoint multiple times to verify we reach different workers
    const workers = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const { body } = await httpGet(`http://localhost:${PORT}/api/health`);
      const data = JSON.parse(body);
      workers.add(data.worker);
    }

    // We should hit at least 2 different workers
    expect(workers.size).toBeGreaterThanOrEqual(WORKERS);
  }, 15_000);

  it('cache survives orkify reload', async () => {
    // Get ISR page (populates cache)
    const { body: before } = await httpGet(`http://localhost:${PORT}/isr`);
    const tsBefore = extractTimestamp(before);
    expect(tsBefore).toBeTruthy();

    // Reload all workers
    orkify(`reload ${APP_NAME}`);
    await waitForClusterReady(WORKERS, PORT);

    // ISR page should still serve the cached version
    const { body: after } = await httpGet(`http://localhost:${PORT}/isr`);
    const tsAfter = extractTimestamp(after);

    expect(tsAfter).toBe(tsBefore);
  }, 60_000);

  it('standalone mode works without orkify', async () => {
    // Stop the cluster first
    orkify(`down ${APP_NAME}`);
    await sleep(2000);

    // Start standalone with Node directly
    const standalonePort = 4221;
    const nextBin = join(EXAMPLE_DIR, 'node_modules/.bin/next');
    execSync(`${nextBin} start -p ${standalonePort} &`, {
      cwd: EXAMPLE_DIR,
      stdio: 'pipe',
      timeout: 10_000,
      shell: '/bin/bash',
    });

    try {
      await waitForHttpReady(`http://localhost:${standalonePort}/api/health`, 15_000);

      const { status, body } = await httpGet(`http://localhost:${standalonePort}/api/health`);
      expect(status).toBe(200);
      const data = JSON.parse(body);
      expect(data.ok).toBe(true);
      expect(data.worker).toBe('standalone');
    } finally {
      // Kill the standalone process
      try {
        execSync(`lsof -ti:${standalonePort} | xargs kill -9 2>/dev/null || true`, {
          stdio: 'pipe',
          shell: '/bin/bash',
        });
      } catch {
        // ignore
      }
    }
  }, 30_000);
});
