import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES, spawnOrkify } from './setup.js';
import {
  orkify,
  sleep,
  httpGet,
  waitForProcessRemoved,
  waitForWorkersOnline,
  waitForClusterReady,
  disconnectSocket,
} from './test-utils.js';

describe('Sticky Sessions Flag', () => {
  const appName = 'test-sticky';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-sticky-test-')));
    scriptPath = join(tempDir, 'app.js');

    // Create an app that echoes ORKIFY environment variables
    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sticky: process.env.ORKIFY_STICKY,
          clusterMode: process.env.ORKIFY_CLUSTER_MODE,
          workerId: process.env.ORKIFY_WORKER_ID,
          workers: process.env.ORKIFY_WORKERS,
        }));
      });
      server.listen(3002, () => {

      });
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes --sticky flag to cluster workers', async () => {
    const output = orkify(`up ${scriptPath} -n ${appName} -w 2 --sticky`);
    expect(output).toContain(`Process "${appName}" started`);
    expect(output).toContain('Mode: cluster');

    // Wait for workers to come online (Windows can be slow)
    await waitForWorkersOnline(2, 3002);

    const { status, body } = await httpGet('http://localhost:3002/');
    expect(status).toBe(200);

    const data = JSON.parse(body);
    expect(data.sticky).toBe('true');
    expect(data.clusterMode).toBe('true');
    expect(data.workers).toBe('2');
  }, 45000);

  it('does not set sticky flag when not specified', async () => {
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    // Start without --sticky
    orkify(`up ${scriptPath} -n ${appName} -w 2`);

    // Wait for workers to come online
    await waitForWorkersOnline(2, 3002);

    const { body } = await httpGet('http://localhost:3002/');
    const data = JSON.parse(body);
    expect(data.sticky).toBe('false');
  }, 45000);
});

describe('Socket.IO Sticky Sessions', () => {
  const appName = 'test-socketio-sticky';
  const PORT = 3004;

  // Connect to Socket.IO with robust retry and error handling
  async function connectSocket(
    stickyId: string,
    options: { retries?: number; timeout?: number } = {}
  ): Promise<{ client: Socket; workerId: string }> {
    const { retries = 3, timeout = 10000 } = options;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const client = ioClient(`http://localhost:${PORT}`, {
        transports: ['polling', 'websocket'],
        forceNew: true,
        timeout,
        reconnection: false,
        query: { sticky_id: stickyId },
      });

      try {
        const workerId = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            client.disconnect();
            reject(new Error(`Connection timeout (attempt ${attempt})`));
          }, timeout);

          client.once('connect_error', (err: Error) => {
            clearTimeout(timer);
            client.disconnect();
            reject(new Error(`Connect error: ${err.message}`));
          });

          client.once('worker-id', (id: string) => {
            clearTimeout(timer);
            resolve(id);
          });
        });

        return { client, workerId };
      } catch (err) {
        client.disconnect();
        if (attempt === retries) {
          throw err;
        }
        await sleep(200);
      }
    }
    throw new Error('Failed to connect after all retries');
  }

  beforeAll(async () => {
    // Clean slate
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    // Start cluster with sticky sessions enabled
    const output = orkify(
      `up ${EXAMPLES}/socketio-test/server.js -n ${appName} -w 4 --sticky --port ${PORT}`
    );
    expect(output).toContain(`Process "${appName}" started`);
    expect(output).toContain('Sticky sessions: enabled');

    // Wait for cluster to be fully ready
    await waitForClusterReady(4, PORT, 45000);
  }, 60000);

  afterAll(() => {
    orkify(`delete ${appName}`);
  });

  it('Socket.IO client connects successfully', async () => {
    const { client, workerId } = await connectSocket('test-connection');

    expect(workerId).toBeDefined();
    expect(['0', '1', '2', '3']).toContain(workerId);

    client.disconnect();
  }, 15000);

  it('same sticky_id always routes to same worker', async () => {
    const stickyId = 'sticky-session-test-abc';
    const workers: string[] = [];

    // Connect 5 times with the same sticky_id
    for (let i = 0; i < 5; i++) {
      const { client, workerId } = await connectSocket(stickyId);
      workers.push(workerId);
      await disconnectSocket(client);
    }

    // All connections should go to the same worker
    const uniqueWorkers = new Set(workers);
    expect(uniqueWorkers.size).toBe(1);
  }, 30000);

  it('different sticky_ids route to different workers (distribution)', async () => {
    const workers: string[] = [];

    // Connect with 16 different sticky_ids for better distribution test
    for (let i = 0; i < 16; i++) {
      const { client, workerId } = await connectSocket(`unique-session-${i}`);
      workers.push(workerId);
      await disconnectSocket(client);
    }

    // With 16 unique IDs hashed across 4 workers, expect at least 3 different workers
    // (probability of only hitting 2 workers with 16 hashed IDs is extremely low)
    const uniqueWorkers = new Set(workers);
    expect(uniqueWorkers.size).toBeGreaterThanOrEqual(3);
  }, 45000);

  it('ping/pong works and returns correct worker', async () => {
    const stickyId = 'ping-pong-test';
    const { client, workerId } = await connectSocket(stickyId);

    // Use the ping event to verify worker
    const pingResult = await new Promise<{ worker: string; pid: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Ping timeout')), 5000);

      client.emit('ping', (response: { worker: string; pid: number }) => {
        clearTimeout(timer);
        resolve(response);
      });
    });

    expect(pingResult.worker).toBe(workerId);
    expect(pingResult.pid).toBeGreaterThan(0);

    client.disconnect();
  }, 15000);

  it('sticky routing is consistent across multiple sequential connections', async () => {
    const sessions = ['session-A', 'session-B', 'session-C'];
    const workerMap = new Map<string, string>();

    // First round: establish which worker each session routes to
    for (const sessionId of sessions) {
      const { client, workerId } = await connectSocket(sessionId);
      workerMap.set(sessionId, workerId);
      await disconnectSocket(client);
    }

    // Second round: verify same sessions route to same workers
    for (const sessionId of sessions) {
      const { client, workerId } = await connectSocket(sessionId);
      expect(workerId).toBe(workerMap.get(sessionId));
      await disconnectSocket(client);
    }
  }, 30000);

  it('maintains sticky routing after zero-downtime reload', async () => {
    const stickyId = 'reload-test-session';

    // Connect and get initial worker (we don't compare with post-reload worker
    // since worker IDs change, but we verify consistency post-reload)
    const { client: client1 } = await connectSocket(stickyId);
    client1.disconnect();

    // Trigger reload
    const reloadOutput = orkify(`reload ${appName}`);
    expect(reloadOutput).toContain('reloaded');

    // Wait for reload to complete and new workers to be ready
    await waitForClusterReady(4, PORT, 45000);

    // Connect again with same sticky_id - should route consistently
    // Note: worker IDs will be different (new workers), but the routing
    // should still be consistent for the same sticky_id
    const workersAfterReload: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { client, workerId } = await connectSocket(stickyId);
      workersAfterReload.push(workerId);
      await disconnectSocket(client);
    }

    // After reload, same sticky_id should still route to same (new) worker
    const uniqueWorkersAfter = new Set(workersAfterReload);
    expect(uniqueWorkersAfter.size).toBe(1);
  }, 45000);

  // Note: HTTP-level sticky routing is handled by the sticky balancer,
  // but @socket.io/sticky's setupWorker primarily handles Socket.IO protocol.
  // Plain HTTP requests still work (200 OK), but may not be sticky.
  // This is acceptable since sticky sessions are mainly needed for WebSocket/Socket.IO.
  it('HTTP health endpoint works through sticky server', async () => {
    // Verify HTTP requests work through the sticky server
    for (let i = 0; i < 3; i++) {
      const { status, body } = await httpGet(`http://localhost:${PORT}/health`);
      expect(status).toBe(200);
      const data = JSON.parse(body);
      expect(data.status).toBe('ok');
      expect(data.worker).toBeDefined();
    }
  }, 10000);

  it('handles concurrent connections correctly', async () => {
    // Launch 10 concurrent connections with different sticky_ids
    const connectionPromises = Array.from({ length: 10 }, (_, i) =>
      connectSocket(`concurrent-session-${i}`)
        .then(({ client, workerId }) => {
          client.disconnect();
          return { sessionId: `concurrent-session-${i}`, workerId };
        })
        .catch(() => null)
    );

    const results = await Promise.all(connectionPromises);
    const successful = results.filter(
      (r): r is { sessionId: string; workerId: string } => r !== null
    );

    // At least 8 out of 10 should succeed
    expect(successful.length).toBeGreaterThanOrEqual(8);

    // Should be distributed across workers
    const workers = successful.map((r) => r.workerId);
    const uniqueWorkers = new Set(workers);
    expect(uniqueWorkers.size).toBeGreaterThanOrEqual(2);

    // Verify each session routes consistently on reconnect
    for (const result of successful.slice(0, 3)) {
      const { client, workerId } = await connectSocket(result.sessionId);
      expect(workerId).toBe(result.workerId);
      await disconnectSocket(client);
    }
  }, 30000);

  it('handles edge case: empty sticky_id (falls back to round-robin)', async () => {
    const workers: string[] = [];

    // Empty sticky_id should fall back to round-robin distribution
    for (let i = 0; i < 8; i++) {
      const { client, workerId } = await connectSocket('');
      workers.push(workerId);
      await disconnectSocket(client);
    }

    // With empty sticky_id, should distribute across workers
    const uniqueWorkers = new Set(workers);
    expect(uniqueWorkers.size).toBeGreaterThanOrEqual(2);
  }, 20000);

  it('handles edge case: very long sticky_id', async () => {
    // 500 character sticky_id
    const longStickyId = 'x'.repeat(500);
    const workers: string[] = [];

    for (let i = 0; i < 3; i++) {
      const { client, workerId } = await connectSocket(longStickyId);
      workers.push(workerId);
      await disconnectSocket(client);
    }

    // Long sticky_id should still route consistently
    const uniqueWorkers = new Set(workers);
    expect(uniqueWorkers.size).toBe(1);
  }, 15000);

  it('handles edge case: special characters in sticky_id', async () => {
    const specialIds = [
      'user@example.com',
      'session/with/slashes',
      'has spaces here',
      'unicode-émoji-🎉',
    ];

    for (const stickyId of specialIds) {
      const workers: string[] = [];

      // Each special ID should route consistently
      for (let i = 0; i < 2; i++) {
        try {
          const { client, workerId } = await connectSocket(stickyId);
          workers.push(workerId);
          await disconnectSocket(client);
        } catch {
          // Some special chars might fail, that's ok
        }
      }

      if (workers.length === 2) {
        expect(workers[0]).toBe(workers[1]);
      }
    }
  }, 25000);

  it('recovers when a worker crashes', async () => {
    const stickyId = 'crash-recovery-test';

    // Get the worker's PID and kill it
    const pingClient = ioClient(`http://localhost:${PORT}`, {
      transports: ['polling', 'websocket'],
      forceNew: true,
      timeout: 10000,
      query: { sticky_id: stickyId },
    });

    const { pid } = await new Promise<{ worker: string; pid: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Ping timeout')), 10000);

      pingClient.once('connect_error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });

      pingClient.once('connect', () => {
        pingClient.emit('ping', (response: { worker: string; pid: number }) => {
          clearTimeout(timer);
          resolve(response);
        });
      });
    });
    pingClient.disconnect();

    // Kill the worker process
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process might already be dead
    }

    // Wait for ORKIFY to detect crash and spawn new worker
    await waitForWorkersOnline(appName, 4);

    // Verify cluster recovers - should be able to connect again
    // (might route to different worker since original crashed)
    let connected = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { client } = await connectSocket(stickyId);
        client.disconnect();
        connected = true;
        break;
      } catch {
        await sleep(200);
      }
    }

    expect(connected).toBe(true);

    // Verify cluster still has workers online
    const list = orkify('list');
    expect(list).toContain('online');
  }, 30000);

  it('routes io cookie consistently (cookie-based stickiness)', async () => {
    // This tests that the io cookie extraction works
    // Socket.IO sets this cookie after initial connection
    const workers: string[] = [];

    // First connection establishes the session
    const client1 = ioClient(`http://localhost:${PORT}`, {
      transports: ['polling', 'websocket'],
      forceNew: true,
      timeout: 10000,
      withCredentials: true, // Enable cookies
    });

    const workerId1 = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout')), 10000);

      client1.once('connect_error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });

      client1.once('worker-id', (id: string) => {
        clearTimeout(timer);
        resolve(id);
      });
    });
    workers.push(workerId1);

    // Get the Socket.IO session ID (sid) which is used for routing
    const sid = client1.id;
    client1.disconnect();

    // Subsequent connections with same sid should route to same worker
    // (This simulates reconnection with existing session)
    if (sid) {
      for (let i = 0; i < 2; i++) {
        const { client, workerId } = await connectSocket(sid);
        workers.push(workerId);
        await disconnectSocket(client);
      }

      // Using the sid as sticky_id should route consistently
      const uniqueWorkers = new Set(workers.slice(1)); // Exclude first (no sid yet)
      expect(uniqueWorkers.size).toBe(1);
    }
  }, 25000);
});

describe('Socket.IO Cluster Mode (no sticky)', () => {
  const appName = 'test-socketio-cluster';
  // socketio-test server defaults to PORT=3003 when not in sticky mode
  const PORT = 3003;

  // Connect with retry for non-sticky mode (can be flaky)
  async function connectAndGetWorker(): Promise<string | null> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const client = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        forceNew: true,
        timeout: 5000,
      });

      try {
        const workerId = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            client.disconnect();
            reject(new Error('Timeout'));
          }, 5000);

          client.once('connect_error', (err: Error) => {
            clearTimeout(timer);
            reject(err);
          });

          client.once('worker-id', (id: string) => {
            clearTimeout(timer);
            resolve(id);
          });
        });

        await disconnectSocket(client);
        return workerId;
      } catch {
        await disconnectSocket(client);
      }
    }
    return null;
  }

  beforeAll(async () => {
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    // Start in cluster mode WITHOUT sticky sessions
    const output = orkify(`up ${EXAMPLES}/socketio-test/server.js -n ${appName} -w 2`);
    expect(output).toContain(`Process "${appName}" started`);
    expect(output).not.toContain('Sticky sessions: enabled');

    // Wait for cluster to be ready
    await waitForWorkersOnline(appName, 2);

    // Verify HTTP is responding
    const { status } = await httpGet(`http://localhost:${PORT}/health`);
    expect(status).toBe(200);
  }, 25000);

  afterAll(() => {
    orkify(`delete ${appName}`);
  });

  // Without sticky sessions, connections are distributed across workers
  // (round-robin). This contrasts with sticky mode where same session
  // always goes to same worker.
  it('distributes connections across workers (no session affinity)', async () => {
    const workers: string[] = [];

    // Connect many times - without sticky, should hit different workers
    for (let i = 0; i < 20; i++) {
      const workerId = await connectAndGetWorker();
      if (workerId) {
        workers.push(workerId);
      }
      await sleep(50);
    }

    // Should have gotten at least 15 successful connections
    expect(workers.length).toBeGreaterThanOrEqual(15);

    // With round-robin scheduling (SCHED_RR) enabled, connections should
    // be distributed across both workers on all platforms
    const uniqueWorkers = new Set(workers);
    expect(uniqueWorkers.size).toBe(2);
  }, 60000);
});

describe('Advanced Sticky Session Tests', () => {
  const appName = 'test-sticky-advanced';
  const PORT = 3006;

  beforeAll(async () => {
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    const output = orkify(
      `up ${EXAMPLES}/socketio-test/server.js -n ${appName} -w 4 --sticky --port ${PORT}`
    );
    expect(output).toContain(`Process "${appName}" started`);

    await waitForClusterReady(4, PORT, 45000);
  }, 60000);

  afterAll(() => {
    orkify(`delete ${appName}`);
  });

  // Note: X-Forwarded-For extraction is implemented in ClusterWrapper for
  // Socket.IO connections going through the sticky balancer. Plain HTTP
  // requests use cluster's default round-robin, but we can still verify
  // the header doesn't cause errors.
  it('accepts X-Forwarded-For header without errors', async () => {
    const testIp = '192.168.1.100';
    const workers: string[] = [];

    // Verify requests with X-Forwarded-For header work
    for (let i = 0; i < 5; i++) {
      const response = await fetch(`http://localhost:${PORT}/health`, {
        headers: { 'X-Forwarded-For': testIp },
      });
      expect(response.status).toBe(200);
      const data = (await response.json()) as { worker: string };
      expect(data.worker).toBeDefined();
      workers.push(data.worker);
    }

    // HTTP requests don't use sticky routing, but verify we got valid responses
    expect(workers.length).toBe(5);
    expect(workers.every((w) => ['0', '1', '2', '3'].includes(w))).toBe(true);
  }, 10000);

  it('handles connection flooding (50 simultaneous)', async () => {
    const connectionPromises = Array.from({ length: 50 }, (_, i) => {
      const client = ioClient(`http://localhost:${PORT}`, {
        transports: ['polling', 'websocket'],
        forceNew: true,
        timeout: 10000,
        query: { sticky_id: `flood-${i}` },
      });

      return new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          client.disconnect();
          resolve(null);
        }, 10000);

        client.once('worker-id', (id: string) => {
          clearTimeout(timer);
          client.disconnect();
          resolve(id);
        });

        client.once('connect_error', () => {
          clearTimeout(timer);
          client.disconnect();
          resolve(null);
        });
      });
    });

    const results = await Promise.all(connectionPromises);
    const successful = results.filter((r) => r !== null);

    // At least 80% should succeed under load
    expect(successful.length).toBeGreaterThanOrEqual(40);

    // Should distribute across workers
    const uniqueWorkers = new Set(successful);
    expect(uniqueWorkers.size).toBeGreaterThanOrEqual(2);
  }, 30000);

  it('handles multiple simultaneous reloads gracefully', async () => {
    // Trigger two reloads simultaneously
    const reload1 = new Promise<string>((resolve) => {
      const proc = spawnOrkify(['reload', appName], { stdio: 'pipe' });
      let output = '';
      proc.stdout?.on('data', (d) => (output += d.toString()));
      proc.on('close', () => resolve(output));
    });

    const reload2 = new Promise<string>((resolve) => {
      const proc = spawnOrkify(['reload', appName], { stdio: 'pipe' });
      let output = '';
      proc.stdout?.on('data', (d) => (output += d.toString()));
      proc.on('close', () => resolve(output));
    });

    const [out1, out2] = await Promise.all([reload1, reload2]);

    // At least one should succeed, one might report "already in progress"
    const succeeded = out1.includes('reloaded') || out2.includes('reloaded');
    expect(succeeded).toBe(true);

    // Wait for cluster to stabilize
    await waitForClusterReady(4, PORT, 45000);

    // Verify cluster is healthy
    const { status } = await httpGet(`http://localhost:${PORT}/health`);
    expect(status).toBe(200);
  }, 45000);
});

describe('Large Worker Count', () => {
  const appName = 'test-large-cluster';
  const PORT = 3007;

  beforeAll(async () => {
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    // Start with 8 workers
    const output = orkify(
      `up ${EXAMPLES}/socketio-test/server.js -n ${appName} -w 8 --sticky --port ${PORT}`
    );
    expect(output).toContain(`Process "${appName}" started`);

    // Wait for all workers to come online (longer timeout for 8 workers on CI)
    await waitForWorkersOnline(8, PORT, 45000);
  }, 60000);

  afterAll(() => {
    orkify(`delete ${appName}`);
  });

  it('starts 8 workers successfully', () => {
    const list = orkify('list');

    // Count worker rows (worker IDs are cumulative, so check pattern not specific IDs)
    const workerMatches = list.match(/worker\s+\d+/g) || [];
    expect(workerMatches.length).toBeGreaterThanOrEqual(8);

    // Count online workers (includes primary + workers)
    const onlineCount = (list.match(/online/g) || []).length;
    expect(onlineCount).toBeGreaterThanOrEqual(8);
  });

  it('distributes HTTP requests across workers (round-robin)', async () => {
    const workers: string[] = [];

    // Make 40 HTTP requests - these use cluster's round-robin, not sticky routing
    for (let i = 0; i < 40; i++) {
      const { body } = await httpGet(`http://localhost:${PORT}/health`);
      if (body) {
        try {
          workers.push(JSON.parse(body).worker);
        } catch {
          // ignore parse errors
        }
      }
    }

    // With 8 workers, we should hit at least 2 workers
    // (cluster distribution can be uneven depending on OS/timing)
    const uniqueWorkers = new Set(workers);
    expect(uniqueWorkers.size).toBeGreaterThanOrEqual(2);
  }, 20000);
});
