import { afterAll, describe, expect, it } from 'vitest';
import { EXAMPLES, spawnOrkify } from './setup.js';
import { httpGet, orkify, orkifyWithEnv, sleep, waitForWorkersOnline } from './test-utils.js';

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
    await waitForWorkersOnline(appName, 4);

    // Verify 8 consecutive HTTP successes to confirm cluster is stable
    let consecutiveSuccesses = 0;
    for (let i = 0; i < 30 && consecutiveSuccesses < 8; i++) {
      const { status } = await httpGet('http://localhost:4000/health');
      if (status === 200) consecutiveSuccesses++;
      else consecutiveSuccesses = 0;
      await sleep(50);
    }
    expect(consecutiveSuccesses).toBeGreaterThanOrEqual(8);

    // Collect PIDs from the pre-reload cluster
    const pidsBefore = new Set<number>();
    for (let i = 0; i < 8; i++) {
      const { body } = await httpGet('http://localhost:4000/health');
      try {
        pidsBefore.add(JSON.parse(body).pid);
      } catch {
        // Ignore parse errors
      }
    }

    let successfulRequests = 0;
    let failedRequests = 0;
    let stopRequests = false;
    const pidsAfter = new Set<number>();

    // Start reload
    const reloadProcess = spawnOrkify(['reload', appName], {
      stdio: 'pipe',
    });
    const reloadDone = new Promise<void>((resolve) => reloadProcess.on('close', () => resolve()));

    // Send requests continuously throughout the reload.
    // Use Connection: close to disable keep-alive — without this, fetch
    // reuses a TCP socket bound to a specific worker. When that worker is
    // killed during reload, the kept-alive connection gets ECONNRESET even
    // though the remaining workers are healthy. With Connection: close each
    // request opens a fresh connection routed through the cluster primary.
    const requestLoop = async () => {
      while (!stopRequests) {
        let status = 0;
        let body = '';
        try {
          const res = await fetch('http://localhost:4000/health', {
            headers: { Connection: 'close' },
          });
          status = res.status;
          body = await res.text();
        } catch {
          // Connection error
        }
        if (status === 200) {
          successfulRequests++;
          try {
            pidsAfter.add(JSON.parse(body).pid);
          } catch {
            // Ignore parse errors
          }
        } else {
          failedRequests++;
        }
        await sleep(50);
      }
    };

    const loopPromise = requestLoop();

    // Wait for reload to finish, then keep probing briefly to verify stability
    await reloadDone;
    await sleep(500);
    stopRequests = true;
    await loopPromise;

    const totalRequests = successfulRequests + failedRequests;

    // 1. Zero-downtime: at most 1 failed request during the entire reload
    expect(failedRequests).toBeLessThanOrEqual(1);
    // 2. Must have sent enough requests to actually cover the reload window
    expect(totalRequests).toBeGreaterThanOrEqual(10);
    // 3. Workers were actually replaced — new PIDs appeared that weren't in the old set
    const newPids = [...pidsAfter].filter((pid) => !pidsBefore.has(pid));
    expect(newPids.length).toBeGreaterThan(0);
  });
});
