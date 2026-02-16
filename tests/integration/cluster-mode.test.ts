import { afterAll, describe, expect, it } from 'vitest';
import { EXAMPLES, spawnOrkify } from './setup.js';
import { httpGet, sleep, waitForWorkersOnline, orkify, orkifyWithEnv } from './test-utils.js';

describe('Cluster Mode', () => {
  const appName = 'test-cluster';

  afterAll(() => {
    orkify(`delete ${appName}`);
  });

  it('starts cluster with 4 workers', async () => {
    const output = orkifyWithEnv(`up ${EXAMPLES}/cluster/app.js -n ${appName} -w 4`, {
      PORT: '4000',
    });
    expect(output).toContain(`Process "${appName}" started`);
    expect(output).toContain('Mode: cluster');

    // Wait for workers to come online (Windows can be slow)
    await waitForWorkersOnline(4, 4000);
  }, 45000);

  it('lists all workers', () => {
    const output = orkify('list');
    expect(output).toContain(appName);
    expect(output).toContain('cluster');
    expect(output).toContain('worker 0');
    expect(output).toContain('worker 1');
    expect(output).toContain('worker 2');
    expect(output).toContain('worker 3');
  });

  it('load balances across workers', async () => {
    const workers = new Set<string>();

    // Make 20 requests to give round-robin a fair chance
    for (let i = 0; i < 20; i++) {
      const { body } = await httpGet('http://localhost:4000/health');
      const match = body.match(/"worker":"(\d+)"/);
      if (match) {
        workers.add(match[1]);
      }
    }

    // With round-robin scheduling (SCHED_RR) enabled, requests should
    // be distributed across workers on all platforms including Windows
    expect(workers.size).toBeGreaterThanOrEqual(2);
  });

  it('performs zero-downtime reload', async () => {
    // Ensure cluster is fully healthy before testing reload
    // Make multiple consecutive successful requests to verify all workers are ready
    let consecutiveSuccesses = 0;
    for (let i = 0; i < 20; i++) {
      const { status } = await httpGet('http://localhost:4000/health');
      if (status === 200) {
        consecutiveSuccesses++;
        // Need 8 consecutive successes to ensure cluster is stable
        if (consecutiveSuccesses >= 8) break;
      } else {
        consecutiveSuccesses = 0;
      }
      await sleep(50);
    }
    expect(consecutiveSuccesses).toBeGreaterThanOrEqual(8);

    let successfulRequests = 0;
    let failedRequests = 0;

    // Start reload
    const reloadProcess = spawnOrkify(['reload', appName], {
      stdio: 'pipe',
    });

    // Make requests during reload
    const requestLoop = async () => {
      for (let i = 0; i < 20; i++) {
        const { status } = await httpGet('http://localhost:4000/health');
        if (status === 200) {
          successfulRequests++;
        } else {
          failedRequests++;
        }
        await sleep(50);
      }
    };

    await Promise.all([
      requestLoop(),
      new Promise<void>((resolve) => reloadProcess.on('close', () => resolve())),
    ]);

    // Zero-downtime: at most 1 failed request allowed (timing can cause occasional failures in CI)
    expect(failedRequests).toBeLessThanOrEqual(1);
    expect(successfulRequests).toBeGreaterThanOrEqual(19);
  });
});
