#!/usr/bin/env node
/**
 * ClusterWrapper - Primary process that manages worker lifecycle
 *
 * This script is spawned by ManagedProcess when running in cluster mode.
 * It uses Node's cluster module to fork workers that share the same port.
 *
 * Environment variables expected:
 * - ORKIFY_SCRIPT: Path to the user's script
 * - ORKIFY_WORKERS: Number of workers to spawn
 * - ORKIFY_PROCESS_NAME: Process name for logging
 * - ORKIFY_PROCESS_ID: Process ID in ORKIFY
 * - ORKIFY_KILL_TIMEOUT: Timeout for graceful shutdown
 * - ORKIFY_STICKY: Whether to use sticky sessions
 */

import cluster, { type Worker } from 'node:cluster';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { METRICS_PROBE_IMPORT } from '../constants.js';

// Force round-robin scheduling on all platforms
// By default, Windows uses "shared handle" where workers compete for connections,
// leading to very unbalanced load distribution (one worker may handle 70%+ of requests)
// Setting SCHED_RR ensures even distribution across all workers
cluster.schedulingPolicy = cluster.SCHED_RR;

const SCRIPT = process.env.ORKIFY_SCRIPT;
if (!SCRIPT) {
  console.error('ORKIFY_SCRIPT environment variable is required');
  process.exit(1);
}
const WORKER_COUNT = parseInt(process.env.ORKIFY_WORKERS || '1', 10);
const PROCESS_NAME = process.env.ORKIFY_PROCESS_NAME || 'app';
const PROCESS_ID = process.env.ORKIFY_PROCESS_ID || '0';
const KILL_TIMEOUT = parseInt(process.env.ORKIFY_KILL_TIMEOUT || '5000', 10);
const RELOAD_RETRIES = parseInt(process.env.ORKIFY_RELOAD_RETRIES || '3', 10);
const STICKY = process.env.ORKIFY_STICKY === 'true';
// Use ORKIFY_STICKY_PORT if set, otherwise fall back to PORT env
const STICKY_PORT = process.env.ORKIFY_STICKY_PORT
  ? parseInt(process.env.ORKIFY_STICKY_PORT, 10)
  : process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : null;
const HEALTH_CHECK = process.env.ORKIFY_HEALTH_CHECK || null;
const HEALTH_PORT = process.env.ORKIFY_PORT ? parseInt(process.env.ORKIFY_PORT, 10) : null;

interface WorkerState {
  worker: Worker;
  id: number;
  pid: number;
  ready: boolean;
  stale: boolean;
  startedAt: number;
}

const workers = new Map<number, WorkerState>();
const stickySessionMap = new Map<string, WorkerState>(); // Session ID -> Worker mapping
const freeSlots = new Set<number>();
let isShuttingDown = false;
let isReloading = false;
const reloadCandidateWorkerIds = new Set<number>(); // cluster worker.id values of temp replacement workers
let stickyServer: null | Server = null;

function log(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${PROCESS_NAME}:primary] ${message}`);
}

function setupCluster(): void {
  // Configure cluster to use the user's script
  // Inject the metrics probe into workers (not the primary) via --import
  const execArgv = [METRICS_PROBE_IMPORT];

  cluster.setupPrimary({
    exec: SCRIPT,
    silent: true, // Capture per-worker stdout/stderr for log attribution
    windowsHide: true, // Hide worker console windows on Windows
    execArgv,
  });

  cluster.on('online', (worker) => {
    const state = findWorkerState(worker);
    if (state) {
      state.pid = worker.process.pid ?? state.pid;
      log(`Worker ${state.id} online (PID: ${state.pid})`);
      // Suppress IPC for temporary reload candidates — ManagedProcess
      // will be notified via reload:complete once the outcome is determined.
      if (!reloadCandidateWorkerIds.has(worker.id) && process.send) {
        process.send({ type: 'worker:online', workerId: state.id, pid: state.pid });
      }
    }
  });

  cluster.on('listening', (worker, address) => {
    const state = findWorkerState(worker);
    if (state && !state.ready) {
      state.ready = true;
      log(`Worker ${state.id} listening on ${address.address || '*'}:${address.port}`);
      if (!reloadCandidateWorkerIds.has(worker.id) && process.send) {
        process.send({
          type: 'worker:listening',
          workerId: state.id,
          address: { address: address.address, port: address.port },
        });
      }
    }
  });

  cluster.on('exit', (worker, code, signal) => {
    const state = findWorkerState(worker);
    if (state) {
      const slotId = state.id;
      workers.delete(worker.id);

      // Only mark slot as free if no other worker is using it
      // (during reload, the replacement worker already holds this slot)
      const slotStillInUse = Array.from(workers.values()).some((w) => w.id === slotId);
      if (!slotStillInUse) {
        freeSlots.add(slotId);
      }

      log(`Worker ${slotId} exited (code: ${code}, signal: ${signal})`);

      // Suppress IPC for temporary reload candidate workers exiting — these
      // are intermediate attempts that should not affect ManagedProcess state.
      // The old worker being stopped is NOT in this set, so its exit propagates normally.
      if (!reloadCandidateWorkerIds.has(worker.id) && process.send) {
        process.send({ type: 'worker:exit', workerId: slotId, pid: state.pid, code, signal });
      }
      reloadCandidateWorkerIds.delete(worker.id);

      // Auto-restart if not shutting down or reloading
      if (!isShuttingDown && !isReloading) {
        log(`Restarting worker ${slotId}...`);
        spawnWorker(slotId);
      }
    }
  });

  cluster.on('message', (worker, message) => {
    const state = findWorkerState(worker);
    if (!state) return;

    // Relay metrics probe messages from workers to the daemon
    const probeMsg = message as {
      __orkify?: boolean;
      type?: string;
      data?: Record<string, unknown>;
    };
    if (probeMsg?.__orkify && probeMsg.type === 'metrics') {
      if (process.send) {
        process.send({ type: 'worker:metrics', workerId: state.id, data: probeMsg.data });
      }
      return;
    }

    if (probeMsg?.__orkify && probeMsg.type === 'error') {
      if (process.send) {
        process.send({
          type: 'worker:error:captured',
          workerId: state.id,
          data: probeMsg.data,
        });
      }
      return;
    }

    if (probeMsg?.__orkify && probeMsg.type === 'broadcast') {
      for (const [, s] of workers) {
        if (s.worker !== worker && s.worker.isConnected()) {
          s.worker.send(message);
        }
      }
      return;
    }

    if (message === 'ready' && !state.ready) {
      state.ready = true;
      log(`Worker ${state.id} ready`);

      // Notify parent (daemon) that a worker is ready
      if (process.send) {
        process.send({ type: 'worker:ready', workerId: state.id });
      }
    }

    // Handle sticky session registration from @socket.io/sticky
    // Workers send these messages when clients connect/disconnect
    const msg = message as { type?: string; data?: string };
    if (msg.type === 'sticky:connection' && msg.data) {
      stickySessionMap.set(msg.data, state);
    } else if (msg.type === 'sticky:disconnection' && msg.data) {
      stickySessionMap.delete(msg.data);
    }
  });
}

function findWorkerState(worker: Worker): undefined | WorkerState {
  for (const state of workers.values()) {
    if (state.worker === worker) {
      return state;
    }
  }
  return undefined;
}

function allocateSlot(): number {
  if (freeSlots.size > 0) {
    return Math.min(...freeSlots);
  }
  return workers.size;
}

function spawnWorker(slotId?: number): WorkerState {
  const workerId = slotId ?? allocateSlot();
  freeSlots.delete(workerId);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ORKIFY_WORKER_ID: String(workerId),
    ORKIFY_PROCESS_NAME: PROCESS_NAME,
    ORKIFY_PROCESS_ID: PROCESS_ID,
    ORKIFY_CLUSTER_MODE: 'true',
    ORKIFY_WORKERS: String(WORKER_COUNT),
  };

  // When sticky mode is enabled, workers receive connections via IPC from the
  // primary's sticky balancer. They should NOT bind to the sticky port.
  if (STICKY && STICKY_PORT) {
    env.ORKIFY_STICKY = 'true';
    env.ORKIFY_WORKER_PORT = '0'; // Bind to ephemeral port, connections come via IPC
    env.PORT = String(STICKY_PORT); // Keep for reference (e.g., socket.io client URLs)
  }

  const worker = cluster.fork(env);

  const state: WorkerState = {
    worker,
    id: workerId,
    pid: worker.process.pid ?? 0,
    ready: false,
    stale: false,
    startedAt: Date.now(),
  };

  workers.set(worker.id, state);

  // With silent: true each worker gets its own stdout/stderr streams.
  // Relay to the daemon via IPC with the real workerId for per-worker
  // log attribution. ManagedProcess.handleLog writes to log files.
  if (process.send) {
    const send = process.send.bind(process);
    worker.process.stdout?.on('data', (chunk: Buffer) => {
      send({ type: 'worker:output', workerId, stream: 'out', data: chunk.toString() });
    });
    worker.process.stderr?.on('data', (chunk: Buffer) => {
      send({ type: 'worker:output', workerId, stream: 'err', data: chunk.toString() });
    });
  }

  return state;
}

async function stopWorker(state: WorkerState): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log(`Worker ${state.id} kill timeout, forcing...`);
      state.worker.kill('SIGKILL');
      resolve();
    }, KILL_TIMEOUT);

    state.worker.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    // First disconnect from cluster (stops receiving new connections)
    // This ensures the load balancer stops routing to this worker
    try {
      state.worker.disconnect();
    } catch {
      // Worker might already be disconnected
    }

    // Give brief time for in-flight requests to complete, then send SIGTERM
    setTimeout(() => {
      state.worker.kill('SIGTERM');
    }, 100);
  });
}

interface SlotResult {
  slotId: number;
  status: 'failed' | 'stale' | 'success';
  retries: number;
  error?: string;
}

async function reload(): Promise<void> {
  if (isReloading) {
    log('Reload already in progress');
    return;
  }

  isReloading = true;
  const slotResults: SlotResult[] = [];

  try {
    log(`Starting rolling reload of ${workers.size} workers...`);

    // Get current worker states
    const oldWorkers = Array.from(workers.values());

    for (const oldState of oldWorkers) {
      if (isShuttingDown) break;

      const slotId = oldState.id;
      let replaced = false;

      for (let attempt = 0; attempt <= RELOAD_RETRIES; attempt++) {
        if (isShuttingDown) break;

        if (attempt > 0) {
          // Brief backoff before retrying to let transient issues resolve
          await new Promise((r) => setTimeout(r, 1000));
          log(`Retrying worker ${slotId} (attempt ${attempt + 1}/${RELOAD_RETRIES + 1})...`);
        } else {
          log(`Replacing worker ${slotId}...`);
        }

        // Spawn new worker with the same slot ID.
        // Track its cluster worker.id so we can suppress IPC events for it
        // while it's a temporary reload candidate.
        const newState = spawnWorker(slotId);
        reloadCandidateWorkerIds.add(newState.worker.id);

        try {
          // Wait for new worker to be ready (with timeout)
          await waitForReady(newState, 30000);

          // Small delay to ensure cluster has registered new worker for load balancing
          await new Promise((r) => setTimeout(r, 50));

          // New worker is ready — promote it. Remove from candidates so
          // subsequent events (if any) propagate normally.
          reloadCandidateWorkerIds.delete(newState.worker.id);

          // Stop old worker (disconnect first, then graceful shutdown).
          // Its exit event will propagate to ManagedProcess normally.
          await stopWorker(oldState);

          log(`Worker ${slotId} replaced`);
          replaced = true;

          // Notify ManagedProcess of the new worker
          if (process.send) {
            process.send({ type: 'worker:online', workerId: slotId, pid: newState.pid });
            if (newState.ready) {
              process.send({ type: 'worker:listening', workerId: slotId });
            }
          }

          slotResults.push({ slotId, status: 'success', retries: attempt });
          break;
        } catch {
          // New worker failed to become ready — kill it
          log(`Worker ${slotId} failed to start on attempt ${attempt + 1}`);
          try {
            newState.worker.kill('SIGKILL');
          } catch {
            // Worker might already be dead
          }
          // Note: reloadCandidateWorkerIds entry is cleaned up by exit handler
        }
      }

      if (!replaced && !isShuttingDown) {
        // All retries exhausted — keep old worker alive but mark it stale
        log(
          `Worker ${slotId} reload failed after ${RELOAD_RETRIES + 1} attempts, keeping old worker (stale)`
        );
        oldState.stale = true;
        slotResults.push({
          slotId,
          status: 'stale',
          retries: RELOAD_RETRIES,
          error: 'All reload retries exhausted',
        });

        // Abort remaining slots
        log('Aborting remaining reload slots due to failure');
        break;
      }
    }

    // If all slots succeeded, clear any prior stale flags
    const allSuccess = slotResults.every((r) => r.status === 'success');
    if (allSuccess) {
      for (const state of workers.values()) {
        state.stale = false;
      }
    }

    const failed = slotResults.filter((r) => r.status !== 'success');
    if (failed.length > 0) {
      log(
        `Rolling reload completed with failures: ${failed.map((f) => `slot ${f.slotId} (${f.status})`).join(', ')}`
      );
    } else {
      log('Rolling reload complete');
    }
  } finally {
    isReloading = false;
    reloadCandidateWorkerIds.clear();

    if (process.send) {
      process.send({ type: 'reload:complete', results: slotResults });
    }
  }
}

async function restartWorker(slotId: number): Promise<void> {
  if (isShuttingDown || isReloading) return;

  const oldState = Array.from(workers.values()).find((w) => w.id === slotId);
  if (!oldState) return;

  log(`Memory restart: replacing worker ${slotId}...`);

  const newState = spawnWorker(slotId);
  reloadCandidateWorkerIds.add(newState.worker.id);

  try {
    await waitForReady(newState, 30000);
    await new Promise((r) => setTimeout(r, 50));

    // Promote new worker
    reloadCandidateWorkerIds.delete(newState.worker.id);

    // Stop old worker gracefully (disconnect → SIGTERM)
    await stopWorker(oldState);

    log(`Worker ${slotId} replaced (memory restart)`);

    if (process.send) {
      process.send({ type: 'worker:online', workerId: slotId, pid: newState.pid });
      if (newState.ready) {
        process.send({ type: 'worker:listening', workerId: slotId });
      }
    }
  } catch {
    // Replacement failed — kill it, keep old worker
    log(`Memory restart of worker ${slotId} failed, keeping old worker`);
    try {
      newState.worker.kill('SIGKILL');
    } catch {
      // Worker might already be dead
    }
    reloadCandidateWorkerIds.delete(newState.worker.id);
    if (process.send) {
      process.send({ type: 'restart-worker-failed', workerId: slotId });
    }
  }
}

async function checkHealth(port: number, path: string): Promise<void> {
  const url = `http://localhost:${port}${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (resp.status >= 200 && resp.status < 300) return;
    } catch {
      // Retry
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Health check failed: ${url}`);
}

function waitForReady(state: WorkerState, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const doResolve = async () => {
      try {
        if (HEALTH_CHECK && HEALTH_PORT) {
          await checkHealth(HEALTH_PORT, HEALTH_CHECK);
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    };

    if (state.ready) {
      doResolve();
      return;
    }

    const checkReadyInterval = setInterval(() => {
      if (state.ready) {
        clearTimeout(timer);
        clearInterval(checkReadyInterval);
        doResolve();
      }
    }, 100);

    const timer = setTimeout(() => {
      clearInterval(checkReadyInterval);
      reject(new Error(`Worker ${state.id} ready timeout after ${timeout}ms`));
    }, timeout);
  });
}

async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log('Shutting down all workers...');

  // Stop sticky server if running
  if (stickyServer) {
    stickyServer.close();
  }

  // Stop all workers in parallel
  const promises = Array.from(workers.values()).map(stopWorker);
  await Promise.all(promises);

  log('All workers stopped');
  process.exit(0);
}

// Sticky session support - intercept connections and route by session
// Uses the same message format as @socket.io/sticky for compatibility
function setupStickyServer(port: number): void {
  const workerArray = () => Array.from(workers.values()).filter((w) => w.ready);
  let currentIndex = 0;

  stickyServer = createServer((socket) => {
    socket.on('data', (buffer) => {
      const activeWorkers = workerArray();
      if (activeWorkers.length === 0) {
        socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        return;
      }

      const data = buffer.toString();

      // Extract session ID for sticky routing
      const sessionId = extractSessionId(buffer);
      let targetWorker: WorkerState;

      if (sessionId) {
        // Check if we have a cached worker for this session
        // stickySessionMap is populated by workers via IPC when they create sessions
        const cachedWorker = stickySessionMap.get(sessionId);
        if (cachedWorker && activeWorkers.includes(cachedWorker)) {
          targetWorker = cachedWorker;
        } else {
          // Hash session to worker for consistent routing
          const hash = createHash('md5').update(sessionId).digest('hex');
          const num = parseInt(hash.substring(0, 8), 16);
          const workerIndex = num % activeWorkers.length;
          targetWorker = activeWorkers[workerIndex];
          stickySessionMap.set(sessionId, targetWorker);
        }
      } else {
        // Round-robin for new connections without session ID
        currentIndex = (currentIndex + 1) % activeWorkers.length;
        targetWorker = activeWorkers[currentIndex];
      }

      // Send in the format that @socket.io/sticky's setupWorker expects
      targetWorker.worker.send(
        { type: 'sticky:connection', data },
        socket,
        { keepOpen: false },
        (err: Error | null) => {
          if (err) {
            socket.destroy();
          }
        }
      );
    });
  });

  stickyServer.listen(port, () => {
    log(`Sticky balancer listening on port ${port}`);
  });

  // Clean up session mappings when workers exit
  cluster.on('exit', (worker) => {
    stickySessionMap.forEach((value, key) => {
      if (value.worker === worker) {
        stickySessionMap.delete(key);
      }
    });
  });
}

function extractSessionId(buffer: Buffer): null | string {
  const data = buffer.toString('utf8', 0, Math.min(buffer.length, 2048));

  // Custom sticky_id parameter (recommended for explicit sticky routing)
  const stickyIdMatch = data.match(/sticky_id=([^&\s\r\n]+)/);
  if (stickyIdMatch) return stickyIdMatch[1];

  // Socket.IO sid parameter (session already established)
  const sidMatch = data.match(/sid=([^&\s\r\n]+)/);
  if (sidMatch) return sidMatch[1];

  // io cookie
  const cookieMatch = data.match(/Cookie:[^\r\n]*io=([^;\s\r\n]+)/i);
  if (cookieMatch) return cookieMatch[1];

  // X-Forwarded-For for IP-based stickiness
  const forwardedMatch = data.match(/X-Forwarded-For:\s*([^,\r\n]+)/i);
  if (forwardedMatch) return forwardedMatch[1].trim();

  return null;
}

// Handle IPC messages from daemon
process.on('message', async (message: unknown) => {
  const msg = message as { type: string; [key: string]: unknown };

  switch (msg.type) {
    case 'reload':
      await reload();
      break;
    case 'restart-worker':
      await restartWorker(msg.workerId as number);
      break;
    case 'shutdown':
      await shutdown();
      break;
  }
});

// Signal handlers
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the cluster
setupCluster();

log(`Starting ${WORKER_COUNT} workers for ${SCRIPT}...`);

// Initialize free slots and spawn initial workers
for (let i = 0; i < WORKER_COUNT; i++) {
  freeSlots.add(i);
}
for (let i = 0; i < WORKER_COUNT; i++) {
  spawnWorker();
}

// Setup sticky server if enabled
if (STICKY && STICKY_PORT) {
  setupStickyServer(STICKY_PORT);
}

// Signal to daemon that primary is ready
if (process.send) {
  process.send({ type: 'primary:ready', pid: process.pid });
}

log('Cluster primary started');
