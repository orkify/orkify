import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch, type FSWatcher } from 'chokidar';
import pidusage from 'pidusage';
import {
  ProcessStatus,
  ExecMode,
  LOGS_DIR,
  METRICS_PROBE_IMPORT,
  LAUNCH_TIMEOUT,
} from '../constants.js';
import type { ProcessConfig, ProcessInfo, WorkerInfo } from '../types/index.js';
import { RotatingWriter } from './RotatingWriter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WorkerState {
  id: number;
  pid: number;
  status: (typeof ProcessStatus)[keyof typeof ProcessStatus];
  ready: boolean;
  stale: boolean;
  restarts: number;
  crashes: number;
  createdAt: number;
  memory: number;
  cpu: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  eventLoopLag: number;
  eventLoopLagP95: number;
  activeHandles: number;
}

export class ManagedProcess extends EventEmitter {
  readonly id: number;
  readonly config: ProcessConfig;

  // For fork mode: single child process
  private forkProcess: ChildProcess | null = null;

  // For cluster mode: primary process that manages workers
  private clusterPrimary: ChildProcess | null = null;
  private clusterWorkers = new Map<number, WorkerState>();
  private slotRestarts = new Map<number, number>();
  private slotCrashes = new Map<number, number>();

  private launchTimers = new Map<number, NodeJS.Timeout>();
  private outWriter: RotatingWriter | null = null;
  private errWriter: RotatingWriter | null = null;
  private watcher: FSWatcher | null = null;
  private isShuttingDown = false;
  private isReloading = false;
  private statsInterval: NodeJS.Timeout | null = null;
  private forkRestarts = 0;
  private forkCrashes = 0;
  private forkCreatedAt = 0;
  private forkReady = false;
  private forkLaunchTimer: NodeJS.Timeout | null = null;
  private detectedPort: number | undefined;
  private primaryRestarts = 0;
  private forkStats = {
    memory: 0,
    cpu: 0,
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
    arrayBuffers: 0,
    eventLoopLag: 0,
    eventLoopLagP95: 0,
    activeHandles: 0,
  };

  constructor(id: number, config: ProcessConfig) {
    super();
    this.id = id;
    this.config = config;
    this.setupLogStreams();
  }

  private setupLogStreams(): void {
    if (!existsSync(LOGS_DIR)) {
      mkdirSync(LOGS_DIR, { recursive: true });
    }

    const outPath = join(LOGS_DIR, `${this.config.name}.stdout.log`);
    const errPath = join(LOGS_DIR, `${this.config.name}.stderr.log`);

    this.outWriter = new RotatingWriter(
      outPath,
      this.config.logMaxSize,
      this.config.logMaxFiles,
      this.config.logMaxAge
    );
    this.errWriter = new RotatingWriter(
      errPath,
      this.config.logMaxSize,
      this.config.logMaxFiles,
      this.config.logMaxAge
    );
  }

  async start(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    if (this.config.execMode === ExecMode.CLUSTER) {
      await this.startCluster();
    } else {
      await this.startFork();
    }

    if (this.config.watch) {
      this.setupWatcher();
    }

    this.startStatsCollection();
  }

  private async startFork(): Promise<void> {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...this.config.env,
      ORKIFY_PROCESS_ID: String(this.id),
      ORKIFY_WORKER_ID: '0',
      ORKIFY_PROCESS_NAME: this.config.name,
      ORKIFY_EXEC_MODE: 'fork',
    };

    if (this.config.healthCheck) {
      env.ORKIFY_HEALTH_CHECK = this.config.healthCheck;
    }
    if (this.config.port !== undefined) {
      env.ORKIFY_PORT = String(this.config.port);
    }

    // Prepend --import for the metrics probe so it runs inside the child
    const execArgv = [METRICS_PROBE_IMPORT, ...this.config.nodeArgs];

    // windowsHide is supported by fork() but not in TypeScript types
    // See: https://github.com/nodejs/node/issues/17370
    this.forkProcess = fork(this.config.script, this.config.args, {
      cwd: this.config.cwd,
      env,
      execArgv,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      detached: false,
      windowsHide: true, // Hide subprocess console window on Windows
    } as Parameters<typeof fork>[2]);

    this.forkCreatedAt = Date.now();
    this.forkReady = false;
    this.setupForkHandlers(this.forkProcess);
    this.startForkLaunchTimer();
  }

  private startForkLaunchTimer(): void {
    this.clearForkLaunchTimer();
    this.forkLaunchTimer = setTimeout(() => {
      this.forkLaunchTimer = null;
      if (!this.forkReady && this.forkProcess && !this.isShuttingDown) {
        console.error(
          `[ERROR] ${this.config.name}: process failed to start — not listening and no ready signal after ${LAUNCH_TIMEOUT / 1000}s.\n` +
            `  Common causes:\n` +
            `  - Application crashed or hung during startup\n` +
            `  - Missing process.send('ready') for apps that don't bind a port`
        );
        this.emit('worker:error', {
          workerId: 0,
          error: new Error(`Fork process launch timeout after ${LAUNCH_TIMEOUT / 1000}s`),
        });
      }
    }, LAUNCH_TIMEOUT);
  }

  private clearForkLaunchTimer(): void {
    if (this.forkLaunchTimer) {
      clearTimeout(this.forkLaunchTimer);
      this.forkLaunchTimer = null;
    }
  }

  private setupForkHandlers(child: ChildProcess): void {
    child.stdout?.on('data', (data: Buffer) => {
      this.handleLog('out', 0, data);
    });

    child.stderr?.on('data', (data: Buffer) => {
      this.handleLog('err', 0, data);
    });

    child.on('message', (message: unknown) => {
      // Handle metrics probe messages from the injected MetricsProbe preload
      const msg = message as {
        __orkify?: boolean;
        type?: string;
        data?: Record<string, unknown>;
      };
      if (msg?.__orkify && msg.type === 'metrics' && msg.data) {
        const d = msg.data as Record<string, number>;
        this.forkStats.heapUsed = d.heapUsed ?? 0;
        this.forkStats.heapTotal = d.heapTotal ?? 0;
        this.forkStats.external = d.external ?? 0;
        this.forkStats.arrayBuffers = d.arrayBuffers ?? 0;
        this.forkStats.eventLoopLag = d.eventLoopLag ?? 0;
        this.forkStats.eventLoopLagP95 = d.eventLoopLagP95 ?? 0;
        this.forkStats.activeHandles = d.activeHandles ?? 0;
        return;
      }

      if (msg?.__orkify && msg.type === 'error' && msg.data) {
        this.emit('worker:error:captured', {
          workerId: 0,
          error: msg.data as Record<string, unknown>,
        });
        return;
      }

      if (message === 'ready') {
        this.forkReady = true;
        this.clearForkLaunchTimer();
        if (this.config.healthCheck && this.config.port) {
          this.checkHealth(this.config.port, this.config.healthCheck)
            .then(() => this.emit('worker:ready', 0))
            .catch((err) => this.emit('worker:error', { workerId: 0, error: err }));
        } else {
          this.emit('worker:ready', 0);
        }
      } else {
        this.emit('message', { workerId: 0, message });
      }
    });

    child.on('exit', (code, signal) => {
      this.clearForkLaunchTimer();
      this.emit('worker:exit', { workerId: 0, code, signal });

      if (!this.isShuttingDown) {
        // Clean exit (code 0, no signal) is not a crash — don't restart or count
        if (code === 0 && !signal) {
          this.forkProcess = null;
          return;
        }

        const uptime = Date.now() - this.forkCreatedAt;
        this.forkCrashes++;

        if (this.forkRestarts < this.config.maxRestarts) {
          if (uptime < this.config.minUptime) {
            console.error(`[${this.config.name}] Process crashed after ${uptime}ms`);
          }

          this.forkRestarts++;
          // Exponential backoff: delay * 2^(restarts-1), capped at 15s
          const backoffDelay = Math.min(
            this.config.restartDelay * Math.pow(2, this.forkRestarts - 1),
            15000
          );
          setTimeout(() => {
            if (!this.isShuttingDown) {
              this.startFork();
            }
          }, backoffDelay);
        } else {
          console.error(`[${this.config.name}] Max restarts exceeded`);
          this.forkProcess = null;
          this.emit('worker:maxRestarts', 0);
        }
      } else {
        // Process exited during shutdown
        this.forkProcess = null;
      }
    });

    child.on('error', (err) => {
      console.error(`[${this.config.name}] Process error:`, err.message);
      this.emit('worker:error', { workerId: 0, error: err });
    });
  }

  private async startCluster(): Promise<void> {
    const clusterWrapperPath = join(__dirname, '..', 'cluster', 'ClusterWrapper.js');

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...this.config.env,
      ORKIFY_SCRIPT: this.config.script,
      ORKIFY_WORKERS: String(this.config.workerCount),
      ORKIFY_PROCESS_NAME: this.config.name,
      ORKIFY_PROCESS_ID: String(this.id),
      ORKIFY_KILL_TIMEOUT: String(this.config.killTimeout),
      ORKIFY_STICKY: String(this.config.sticky),
      ORKIFY_RELOAD_RETRIES: String(this.config.reloadRetries ?? 3),
    };

    // Set sticky port for TCP-level session routing
    if (this.config.sticky && this.config.port) {
      env.ORKIFY_STICKY_PORT = String(this.config.port);
    }

    // Pass health check config to ClusterWrapper
    if (this.config.healthCheck) {
      env.ORKIFY_HEALTH_CHECK = this.config.healthCheck;
    }
    if (this.config.port !== undefined) {
      env.ORKIFY_PORT = String(this.config.port);
    }

    // Spawn the cluster wrapper as the primary
    // windowsHide is supported by fork() but not in TypeScript types
    // See: https://github.com/nodejs/node/issues/17370
    this.clusterPrimary = fork(clusterWrapperPath, [], {
      cwd: this.config.cwd,
      env,
      execArgv: this.config.nodeArgs,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      detached: false,
      windowsHide: true, // Hide subprocess console window on Windows
    } as Parameters<typeof fork>[2]);

    this.setupClusterHandlers(this.clusterPrimary);

    // Wait for primary to be ready
    await this.waitForPrimaryReady();
  }

  private setupClusterHandlers(primary: ChildProcess): void {
    // With silent: true, per-worker output arrives via IPC (worker:output).
    // Primary stdout still carries the ClusterWrapper's own log() lines — capture as primary (-1).
    primary.stdout?.on('data', (data: Buffer) => {
      this.handleLog('out', -1, data);
    });

    primary.stderr?.on('data', (data: Buffer) => {
      this.handleLog('err', -1, data);
    });

    primary.on('message', (message: unknown) => {
      const msg = message as { type: string; [key: string]: unknown };

      switch (msg.type) {
        case 'primary:ready':
          this.emit('primary:ready');
          break;

        case 'worker:ready': {
          const readyWorkerId = msg.workerId as number;
          this.clearLaunchTimer(readyWorkerId);
          this.updateWorkerState(readyWorkerId, { ready: true, status: ProcessStatus.ONLINE });
          this.emit('worker:ready', readyWorkerId);
          break;
        }

        case 'worker:listening': {
          const listeningWorkerId = msg.workerId as number;
          const addr = msg.address as { port?: number } | undefined;
          if (addr?.port && !this.detectedPort) {
            this.detectedPort = addr.port;
          }
          this.clearLaunchTimer(listeningWorkerId);
          this.updateWorkerState(listeningWorkerId, { ready: true, status: ProcessStatus.ONLINE });
          this.emit('worker:ready', listeningWorkerId);
          break;
        }

        case 'worker:online': {
          const onlineWorkerId = msg.workerId as number;
          const onlinePid = msg.pid as number;
          this.updateWorkerState(onlineWorkerId, {
            pid: onlinePid,
            status: ProcessStatus.LAUNCHING,
            ready: false,
            createdAt: Date.now(),
          });
          this.startLaunchTimer(onlineWorkerId);
          break;
        }

        case 'worker:exit': {
          const exitedWorkerId = msg.workerId as number;
          const exitedPid = msg.pid as number;
          this.clearLaunchTimer(exitedWorkerId);
          const existing = this.clusterWorkers.get(exitedWorkerId);
          if (existing) {
            const newRestarts = (existing.restarts ?? 0) + 1;
            this.slotRestarts.set(exitedWorkerId, newRestarts);
            // Only delete if PID matches — during reload, a new worker already holds this slot
            if (!exitedPid || existing.pid === exitedPid) {
              // Tracked worker exited — count as error if not a deliberate shutdown or reload
              if (!this.isShuttingDown && !this.isReloading) {
                const newCrashes = (existing.crashes ?? 0) + 1;
                this.slotCrashes.set(exitedWorkerId, newCrashes);
              }
              this.clusterWorkers.delete(exitedWorkerId);
            } else {
              // PID mismatch: new worker already holds slot — carry the counter forward
              existing.restarts = newRestarts;
            }
          }
          this.emit('worker:exit', {
            workerId: exitedWorkerId,
            code: msg.code as number | null,
            signal: msg.signal as string | null,
          });
          break;
        }

        case 'worker:metrics': {
          const metricsWorkerId = msg.workerId as number;
          const metricsData = msg.data as Record<string, number>;
          const worker = this.clusterWorkers.get(metricsWorkerId);
          if (worker && metricsData) {
            worker.heapUsed = metricsData.heapUsed ?? 0;
            worker.heapTotal = metricsData.heapTotal ?? 0;
            worker.external = metricsData.external ?? 0;
            worker.arrayBuffers = metricsData.arrayBuffers ?? 0;
            worker.eventLoopLag = metricsData.eventLoopLag ?? 0;
            worker.eventLoopLagP95 = metricsData.eventLoopLagP95 ?? 0;
            worker.activeHandles = metricsData.activeHandles ?? 0;

            // Recover from launch timeout: if a worker is sending metrics,
            // it's alive and its event loop is responsive. The 30s launch
            // timeout already fired but the process didn't crash — it just
            // took longer than expected to start (e.g. Next.js compilation).
            if (worker.status === ProcessStatus.ERRORED) {
              worker.status = ProcessStatus.ONLINE;
              worker.ready = true;
            }
          }
          break;
        }

        case 'worker:output': {
          const outputWorkerId = msg.workerId as number;
          const outputStream = msg.stream as 'out' | 'err';
          const outputData = msg.data as string;
          this.handleLog(outputStream, outputWorkerId, Buffer.from(outputData));
          break;
        }

        case 'worker:error:captured': {
          this.emit('worker:error:captured', {
            workerId: msg.workerId as number,
            error: msg.data as Record<string, unknown>,
          });
          break;
        }

        case 'reload:complete': {
          // Update stale flags from per-slot results
          const results = (msg.results ?? []) as Array<{
            slotId: number;
            status: string;
          }>;
          for (const result of results) {
            if (result.status === 'stale') {
              const worker = this.clusterWorkers.get(result.slotId);
              if (worker) {
                worker.stale = true;
              }
            }
          }
          // Clear stale flags if all slots succeeded
          if (results.length > 0 && results.every((r) => r.status === 'success')) {
            for (const worker of this.clusterWorkers.values()) {
              worker.stale = false;
            }
          }
          this.emit('reload:complete', { results });
          break;
        }

        default:
          this.emit('message', { workerId: -1, message: msg });
      }
    });

    primary.on('exit', (code, signal) => {
      this.clusterWorkers.clear();
      this.emit('primary:exit', { code, signal });

      if (!this.isShuttingDown) {
        this.primaryRestarts++;
        if (this.primaryRestarts <= this.config.maxRestarts) {
          console.error(
            `[${this.config.name}] Cluster primary exited unexpectedly, restarting... (${this.primaryRestarts}/${this.config.maxRestarts})`
          );
          const backoffDelay = Math.min(
            this.config.restartDelay * Math.pow(2, this.primaryRestarts - 1),
            15000
          );
          setTimeout(() => {
            if (!this.isShuttingDown) {
              this.startCluster();
            }
          }, backoffDelay);
        } else {
          console.error(`[${this.config.name}] Cluster primary max restarts exceeded`);
          this.clusterPrimary = null;
          this.emit('worker:maxRestarts', -1);
        }
      }
    });

    primary.on('error', (err) => {
      console.error(`[${this.config.name}] Cluster primary error:`, err.message);
    });
  }

  private waitForPrimaryReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('primary:ready', onReady);
        reject(new Error(`Cluster primary failed to start within 10s`));
      }, 10000);

      const onReady = () => {
        clearTimeout(timeout);
        this.off('primary:ready', onReady);
        resolve();
      };

      this.on('primary:ready', onReady);
    });
  }

  private updateWorkerState(workerId: number, updates: Partial<WorkerState>): void {
    let state = this.clusterWorkers.get(workerId);
    if (!state) {
      state = {
        id: workerId,
        pid: 0,
        status: ProcessStatus.LAUNCHING,
        ready: false,
        stale: false,
        restarts: this.slotRestarts.get(workerId) ?? 0,
        crashes: this.slotCrashes.get(workerId) ?? 0,
        createdAt: Date.now(),
        memory: 0,
        cpu: 0,
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        arrayBuffers: 0,
        eventLoopLag: 0,
        eventLoopLagP95: 0,
        activeHandles: 0,
      };
      this.clusterWorkers.set(workerId, state);
    }
    Object.assign(state, updates);
  }

  private startLaunchTimer(workerId: number): void {
    this.clearLaunchTimer(workerId);
    const timer = setTimeout(() => {
      this.launchTimers.delete(workerId);
      const worker = this.clusterWorkers.get(workerId);
      if (worker && !worker.ready) {
        worker.status = ProcessStatus.ERRORED;
        console.error(
          `[ERROR] ${this.config.name}: worker ${workerId} failed to start — not listening and no ready signal after ${LAUNCH_TIMEOUT / 1000}s.\n` +
            `  Common causes:\n` +
            `  - Application crashed or hung during startup\n` +
            `  - Running a dev server in cluster mode (e.g., Next.js dev with -w 0)\n` +
            `  - Missing process.send('ready') for apps that don't bind a port`
        );
        this.emit('worker:error', {
          workerId,
          error: new Error(`Worker ${workerId} launch timeout after ${LAUNCH_TIMEOUT / 1000}s`),
        });
      }
    }, LAUNCH_TIMEOUT);
    this.launchTimers.set(workerId, timer);
  }

  private clearLaunchTimer(workerId: number): void {
    const timer = this.launchTimers.get(workerId);
    if (timer) {
      clearTimeout(timer);
      this.launchTimers.delete(workerId);
    }
  }

  private clearAllLaunchTimers(): void {
    for (const timer of this.launchTimers.values()) {
      clearTimeout(timer);
    }
    this.launchTimers.clear();
  }

  private async checkHealth(port: number, path: string): Promise<void> {
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

  private handleLog(type: 'out' | 'err', workerId: number, data: Buffer): void {
    const line = data.toString();
    const timestamp = new Date().toISOString();
    const workerLabel = workerId === -1 ? 'primary' : workerId;
    const logLine = `[${timestamp}] [${this.config.name}:${workerLabel}] ${line}`;

    if (type === 'out') {
      this.outWriter?.write(logLine);
    } else {
      this.errWriter?.write(logLine);
    }

    this.emit('log', { type, workerId, data: line });
  }

  private setupWatcher(): void {
    const paths = this.config.watchPaths || [this.config.cwd];

    this.watcher = watch(paths, {
      ignored: /(^|[/\\])\.|node_modules/,
      persistent: true,
      ignoreInitial: true,
    });

    let reloadTimeout: NodeJS.Timeout | null = null;

    this.watcher.on('change', (path) => {
      this.emit('watch:change', path);

      if (reloadTimeout) {
        clearTimeout(reloadTimeout);
      }

      reloadTimeout = setTimeout(() => {
        this.emit('watch:reload');
      }, 300);
    });
  }

  private startStatsCollection(): void {
    this.statsInterval = setInterval(async () => {
      await this.collectStats();
    }, 1000);
  }

  private async collectStats(): Promise<void> {
    if (this.config.execMode === ExecMode.FORK && this.forkProcess?.pid) {
      try {
        const stats = await pidusage(this.forkProcess.pid);
        // Store stats for getInfo() — preserve probe metrics
        this.forkStats.memory = stats.memory;
        this.forkStats.cpu = stats.cpu;
      } catch {
        // Process might have exited
      }
    } else if (this.config.execMode === ExecMode.CLUSTER) {
      // Collect stats for each worker
      for (const [_workerId, state] of this.clusterWorkers) {
        if (state.pid) {
          try {
            const stats = await pidusage(state.pid);
            state.memory = stats.memory;
            state.cpu = stats.cpu;
          } catch {
            // Worker might have exited
          }
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.clearForkLaunchTimer();
    this.clearAllLaunchTimers();

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    if (this.config.execMode === ExecMode.FORK) {
      await this.stopFork();
    } else {
      await this.stopCluster();
    }

    this.outWriter?.end();
    this.errWriter?.end();
  }

  async flushLogs(): Promise<void> {
    await Promise.all([this.outWriter?.flush(), this.errWriter?.flush()]);
  }

  private async stopFork(): Promise<void> {
    const child = this.forkProcess;
    if (!child) return;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, this.config.killTimeout);

      child.once('exit', () => {
        clearTimeout(timeout);
        this.forkProcess = null;
        resolve();
      });

      child.kill('SIGTERM');
    });
  }

  private async stopCluster(): Promise<void> {
    const primary = this.clusterPrimary;
    if (!primary) return;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        primary.kill('SIGKILL');
        resolve();
      }, this.config.killTimeout + 5000); // Extra time for workers

      primary.once('exit', () => {
        clearTimeout(timeout);
        this.clusterPrimary = null;
        this.clusterWorkers.clear();
        resolve();
      });

      // Send shutdown command to cluster primary
      if (primary.connected) {
        primary.send({ type: 'shutdown' });
      } else {
        primary.kill('SIGTERM');
      }
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    this.isShuttingDown = false;
    this.forkRestarts = 0;
    this.forkCrashes = 0;
    this.forkReady = false;
    this.primaryRestarts = 0;
    this.clusterWorkers.clear();
    this.slotRestarts.clear();
    this.slotCrashes.clear();
    // Re-create log writers since stop() closed them
    this.setupLogStreams();
    await this.start();
  }

  async reload(): Promise<void> {
    if (this.config.execMode === ExecMode.FORK) {
      // For fork mode, just restart
      await this.restart();
      return;
    }

    // For cluster mode, send reload command to primary
    const primary = this.clusterPrimary;
    if (!primary?.connected) {
      throw new Error('Cluster primary not connected');
    }

    this.isReloading = true;

    // Compute a timeout that accommodates the worst-case reload duration:
    // - Success path: each worker waits up to LAUNCH_TIMEOUT to become ready + KILL_TIMEOUT to stop old
    // - Failure path: one slot retries (reloadRetries+1) × LAUNCH_TIMEOUT before aborting
    const retries = this.config.reloadRetries ?? 3;
    const perSlotSuccess = LAUNCH_TIMEOUT + this.config.killTimeout;
    const failurePath = (retries + 1) * LAUNCH_TIMEOUT + this.config.killTimeout;
    const reloadTimeout = Math.max(this.config.workerCount * perSlotSuccess, failurePath) + 5000;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.isReloading = false;
        reject(new Error('Reload timeout'));
      }, reloadTimeout);

      const onComplete = () => {
        clearTimeout(timeout);
        this.off('reload:complete', onComplete);
        this.isReloading = false;
        resolve();
      };

      this.on('reload:complete', onComplete);
      primary.send({ type: 'reload' });
    });
  }

  getInfo(): ProcessInfo {
    const workers: WorkerInfo[] = [];

    if (this.config.execMode === ExecMode.FORK) {
      const stats = this.forkStats;
      if (this.forkProcess) {
        workers.push({
          id: 0,
          pid: this.forkProcess.pid || 0,
          status: this.isShuttingDown ? ProcessStatus.STOPPING : ProcessStatus.ONLINE,
          restarts: this.forkRestarts,
          crashes: this.forkCrashes,
          uptime: Date.now() - this.forkCreatedAt,
          memory: stats.memory,
          cpu: stats.cpu,
          createdAt: this.forkCreatedAt,
          heapUsed: stats.heapUsed,
          heapTotal: stats.heapTotal,
          external: stats.external,
          arrayBuffers: stats.arrayBuffers,
          eventLoopLag: stats.eventLoopLag,
          eventLoopLagP95: stats.eventLoopLagP95,
          activeHandles: stats.activeHandles,
        });
      } else {
        // Process has stopped - still show worker entry for restart count
        workers.push({
          id: 0,
          pid: 0,
          status: ProcessStatus.STOPPED,
          restarts: this.forkRestarts,
          crashes: this.forkCrashes,
          uptime: 0,
          memory: 0,
          cpu: 0,
          createdAt: this.forkCreatedAt,
        });
      }
    } else {
      for (const state of this.clusterWorkers.values()) {
        workers.push({
          id: state.id,
          pid: state.pid,
          status: state.status,
          restarts: state.restarts,
          crashes: state.crashes,
          uptime: Date.now() - state.createdAt,
          memory: state.memory,
          cpu: state.cpu,
          createdAt: state.createdAt,
          stale: state.stale || undefined,
          heapUsed: state.heapUsed,
          heapTotal: state.heapTotal,
          external: state.external,
          arrayBuffers: state.arrayBuffers,
          eventLoopLag: state.eventLoopLag,
          eventLoopLagP95: state.eventLoopLagP95,
          activeHandles: state.activeHandles,
        });
      }
      workers.sort((a, b) => a.id - b.id);
    }

    return {
      id: this.id,
      name: this.config.name,
      script: this.config.script,
      cwd: this.config.cwd,
      execMode: this.config.execMode,
      workerCount: this.config.workerCount,
      status: this.getStatus(),
      workers,
      pid: this.forkProcess?.pid || this.clusterPrimary?.pid,
      createdAt: workers[0]?.createdAt || Date.now(),
      watch: this.config.watch,
      sticky: this.config.sticky,
      port: this.config.port ?? this.detectedPort,
    };
  }

  private getStatus(): (typeof ProcessStatus)[keyof typeof ProcessStatus] {
    if (this.config.execMode === ExecMode.FORK) {
      // Check if process exists first - if null, it's stopped regardless of flags
      if (!this.forkProcess) {
        return ProcessStatus.STOPPED;
      }
      if (this.isShuttingDown) {
        return ProcessStatus.STOPPING;
      }
      return ProcessStatus.ONLINE;
    }

    // Cluster mode - check if primary exists first
    if (!this.clusterPrimary) {
      return ProcessStatus.STOPPED;
    }

    if (this.isShuttingDown) {
      return ProcessStatus.STOPPING;
    }

    if (this.clusterWorkers.size === 0) {
      return ProcessStatus.LAUNCHING;
    }

    const statuses = Array.from(this.clusterWorkers.values()).map((w) => w.status);

    if (statuses.every((s) => s === ProcessStatus.ONLINE)) {
      return ProcessStatus.ONLINE;
    }

    if (statuses.some((s) => s === ProcessStatus.ERRORED)) {
      return ProcessStatus.ERRORED;
    }

    return ProcessStatus.LAUNCHING;
  }

  getWorkerCount(): number {
    if (this.config.execMode === ExecMode.FORK) {
      return this.forkProcess ? 1 : 0;
    }
    return this.clusterWorkers.size;
  }

  isRunning(): boolean {
    if (this.config.execMode === ExecMode.FORK) {
      return !!this.forkProcess && !this.isShuttingDown;
    }
    return !!this.clusterPrimary && !this.isShuttingDown;
  }
}
