import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, resolve } from 'node:path';
import type {
  McpStartPayload,
  ProcessConfig,
  ProcessInfo,
  ReconcileResult,
  SavedState,
  UpPayload,
} from '../types/index.js';
import {
  DEFAULT_LOG_MAX_AGE,
  DEFAULT_LOG_MAX_FILES,
  DEFAULT_LOG_MAX_SIZE,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_MIN_UPTIME,
  DEFAULT_RELOAD_RETRIES,
  DEFAULT_RESTART_DELAY,
  DEFAULT_WORKERS,
  ExecMode,
  KILL_TIMEOUT,
} from '../constants.js';
import { StateStore } from '../state/StateStore.js';
import { GracefulManager } from './GracefulManager.js';
import { ManagedProcess } from './ManagedProcess.js';

export class Orchestrator extends EventEmitter {
  private processes = new Map<number, ManagedProcess>();
  private nameToId = new Map<string, number>();
  private nextProcessId = 0;
  private gracefulManager: GracefulManager;
  private stateStore: StateStore;
  private startedAt: number;

  constructor() {
    super();
    this.gracefulManager = new GracefulManager();
    this.stateStore = new StateStore();
    this.startedAt = Date.now();
  }

  async up(payload: UpPayload): Promise<ProcessInfo> {
    const script = resolve(payload.cwd || process.cwd(), payload.script);

    if (!existsSync(script)) {
      throw new Error(`Script not found: ${script}`);
    }

    const name = payload.name || basename(script, '.js');

    // Check if process with same name exists
    if (this.nameToId.has(name)) {
      // Safe: .has() guard above guarantees a defined value
      const existingId = this.nameToId.get(name) as number;
      const existing = this.processes.get(existingId);
      // Allow re-using the name if the existing process is stopped
      if (existing && !existing.isRunning()) {
        this.processes.delete(existingId);
        this.nameToId.delete(name);
      } else {
        throw new Error(`Process "${name}" already exists`);
      }
    }

    const rawWorkers = payload.workers ?? DEFAULT_WORKERS;
    const workerCount = rawWorkers === 0 ? cpus().length : rawWorkers;
    const execMode = workerCount > 1 ? ExecMode.CLUSTER : ExecMode.FORK;

    const config: ProcessConfig = {
      name,
      script,
      cwd: payload.cwd || process.cwd(),
      workerCount,
      execMode,
      watch: payload.watch || false,
      watchPaths: payload.watchPaths,
      env: payload.env || {},
      nodeArgs: payload.nodeArgs || [],
      args: payload.args || [],
      killTimeout: payload.killTimeout || KILL_TIMEOUT,
      maxRestarts: payload.maxRestarts ?? DEFAULT_MAX_RESTARTS,
      minUptime: payload.minUptime ?? DEFAULT_MIN_UPTIME,
      restartDelay: payload.restartDelay ?? DEFAULT_RESTART_DELAY,
      sticky: payload.sticky || false,
      port: payload.port,
      reloadRetries: payload.reloadRetries ?? DEFAULT_RELOAD_RETRIES,
      healthCheck: payload.healthCheck,
      logMaxSize: payload.logMaxSize ?? DEFAULT_LOG_MAX_SIZE,
      logMaxFiles: payload.logMaxFiles ?? DEFAULT_LOG_MAX_FILES,
      logMaxAge: payload.logMaxAge ?? DEFAULT_LOG_MAX_AGE,
      restartOnMemory: payload.restartOnMemory,
    };

    const processId = this.nextProcessId++;
    const container = new ManagedProcess(processId, config);

    // Set up event forwarding
    container.on('log', (data) => {
      this.emit('log', { processName: name, ...data });
    });

    container.on('worker:ready', (workerId) => {
      this.emit('worker:ready', { processName: name, workerId });
    });

    container.on('worker:exit', (data) => {
      this.emit('worker:exit', { processName: name, ...data });
    });

    container.on('worker:maxRestarts', (workerId) => {
      this.emit('worker:maxRestarts', { processName: name, workerId });
    });

    container.on('worker:memoryRestart', (data) => {
      this.emit('worker:memoryRestart', { processName: name, ...data });
    });

    container.on('worker:error:captured', (data) => {
      this.emit('worker:error:captured', { processName: name, ...data });
    });

    container.on('watch:reload', () => {
      this.reload(name).catch((err) => {
        console.error(`Watch reload failed for ${name}:`, err.message);
      });
    });

    this.processes.set(processId, container);
    this.nameToId.set(name, processId);

    try {
      await container.start();
    } catch (err) {
      this.processes.delete(processId);
      this.nameToId.delete(name);
      throw err;
    }

    this.emit('process:start', { processName: name, processId });

    return container.getInfo();
  }

  async down(target: 'all' | number | string): Promise<ProcessInfo[]> {
    const containers = this.resolveTarget(target);
    const results: ProcessInfo[] = [];

    for (const container of containers) {
      try {
        await container.stop();
        this.emit('process:stop', { processName: container.config.name, processId: container.id });
        results.push(container.getInfo());
      } catch (err) {
        console.error(`Failed to stop process "${container.config.name}":`, (err as Error).message);
      }
    }

    return results;
  }

  async restart(target: 'all' | number | string): Promise<ProcessInfo[]> {
    const containers = this.resolveTarget(target);
    const results: ProcessInfo[] = [];

    for (const container of containers) {
      try {
        await container.restart();
        results.push(container.getInfo());
      } catch (err) {
        console.error(
          `Failed to restart process "${container.config.name}":`,
          (err as Error).message
        );
      }
    }

    return results;
  }

  async reload(target: 'all' | number | string): Promise<ProcessInfo[]> {
    const containers = this.resolveTarget(target);
    const results: ProcessInfo[] = [];

    for (const container of containers) {
      try {
        this.emit('reload:start', { processName: container.config.name, processId: container.id });
        await this.gracefulManager.reload(container);
        this.emit('reload:complete', {
          processName: container.config.name,
          processId: container.id,
        });
        results.push(container.getInfo());
      } catch (err) {
        console.error(
          `Failed to reload process "${container.config.name}":`,
          (err as Error).message
        );
      }
    }

    return results;
  }

  async delete(target: 'all' | number | string): Promise<ProcessInfo[]> {
    const containers = this.resolveTarget(target);
    const results: ProcessInfo[] = [];

    for (const container of containers) {
      try {
        await container.stop();
      } catch (err) {
        console.error(
          `Failed to stop process "${container.config.name}" during delete:`,
          (err as Error).message
        );
      }
      results.push(container.getInfo());

      this.processes.delete(container.id);
      this.nameToId.delete(container.config.name);
    }

    return results;
  }

  async flushLogs(target: 'all' | number | string): Promise<void> {
    const containers = this.resolveTarget(target);
    await Promise.all(containers.map((c) => c.flushLogs()));
  }

  list(): ProcessInfo[] {
    return Array.from(this.processes.values()).map((p) => p.getInfo());
  }

  getRunningConfigs(): ProcessConfig[] {
    return Array.from(this.processes.values())
      .filter((p) => p.isRunning())
      .map((p) => p.config);
  }

  async snap(options?: {
    noEnv?: boolean;
    file?: string;
    mcpOptions?: McpStartPayload;
  }): Promise<void> {
    let configs = this.getRunningConfigs();
    if (options?.noEnv) {
      configs = configs.map((c) => ({ ...c, env: {} }));
    }
    const store = options?.file ? new StateStore(options.file) : this.stateStore;
    await store.save(configs, options?.mcpOptions);
  }

  async restoreFromMemory(configs: ProcessConfig[]): Promise<ProcessInfo[]> {
    const results: ProcessInfo[] = [];

    for (const config of configs) {
      if (this.nameToId.has(config.name)) {
        continue;
      }

      try {
        const info = await this.up({
          script: config.script,
          name: config.name,
          workers: config.workerCount,
          watch: config.watch,
          watchPaths: config.watchPaths,
          cwd: config.cwd,
          env: config.env,
          nodeArgs: config.nodeArgs,
          args: config.args,
          killTimeout: config.killTimeout,
          maxRestarts: config.maxRestarts,
          minUptime: config.minUptime,
          restartDelay: config.restartDelay,
          sticky: config.sticky,
          port: config.port,
          reloadRetries: config.reloadRetries,
          healthCheck: config.healthCheck,
          logMaxSize: config.logMaxSize,
          logMaxFiles: config.logMaxFiles,
          logMaxAge: config.logMaxAge,
          restartOnMemory: config.restartOnMemory,
        });

        results.push(info);
      } catch (err) {
        console.error(`Failed to restore process "${config.name}":`, (err as Error).message);
      }
    }

    return results;
  }

  async restoreFromSnapshot(
    file?: string
  ): Promise<{ processes: ProcessInfo[]; mcpState?: McpStartPayload }> {
    const store = file ? new StateStore(file) : this.stateStore;
    const state: SavedState = await store.loadFull();
    const processes = await this.restoreFromMemory(state.processes);
    return { processes, mcpState: state.mcp };
  }

  async shutdown(): Promise<void> {
    // Stop all processes in parallel for faster shutdown
    await Promise.all(
      Array.from(this.processes.values()).map((container) =>
        container.stop().catch((err) => {
          console.error(
            `Failed to stop process "${container.config.name}" during shutdown:`,
            (err as Error).message
          );
        })
      )
    );

    this.processes.clear();
    this.nameToId.clear();
  }

  /**
   * Immediately SIGKILL all child processes without waiting for graceful shutdown.
   */
  forceShutdown(): void {
    for (const container of this.processes.values()) {
      container.forceKill();
    }
    this.processes.clear();
    this.nameToId.clear();
  }

  async reconcile(
    configs: ProcessConfig[],
    env?: Record<string, string>
  ): Promise<ReconcileResult> {
    const result: ReconcileResult = { started: [], reloaded: [], deleted: [] };

    // Build name→config maps
    const targetByName = new Map<string, ProcessConfig>();
    for (const config of configs) {
      targetByName.set(config.name, config);
    }

    const runningNames = new Set<string>(this.nameToId.keys());

    // Delete processes not in target configs
    for (const name of runningNames) {
      if (!targetByName.has(name)) {
        await this.delete(name);
        result.deleted.push(name);
      }
    }

    // Start new, reload unchanged, replace changed
    for (const config of configs) {
      const mergedEnv = { ...config.env, ...env };
      const payload: UpPayload = {
        script: config.script,
        name: config.name,
        workers: config.workerCount,
        watch: config.watch,
        watchPaths: config.watchPaths,
        cwd: config.cwd,
        env: mergedEnv,
        nodeArgs: config.nodeArgs,
        args: config.args,
        killTimeout: config.killTimeout,
        maxRestarts: config.maxRestarts,
        minUptime: config.minUptime,
        restartDelay: config.restartDelay,
        sticky: config.sticky,
        port: config.port,
        reloadRetries: config.reloadRetries,
        healthCheck: config.healthCheck,
        logMaxSize: config.logMaxSize,
        logMaxFiles: config.logMaxFiles,
        logMaxAge: config.logMaxAge,
        restartOnMemory: config.restartOnMemory,
      };

      if (!runningNames.has(config.name)) {
        // New process
        await this.up(payload);
        result.started.push(config.name);
      } else {
        const existing = this.getProcessByName(config.name);
        if (existing && this.configChanged(existing.config, config)) {
          // Config changed — full restart
          await this.delete(config.name);
          await this.up(payload);
          result.started.push(config.name);
        } else {
          // Config unchanged — zero-downtime reload
          await this.reload(config.name);
          result.reloaded.push(config.name);
        }
      }
    }

    return result;
  }

  private configChanged(running: ProcessConfig, target: ProcessConfig): boolean {
    // Compare config fields that matter (ignore env and cwd which vary between deploys)
    const keys: (keyof ProcessConfig)[] = [
      'script',
      'workerCount',
      'nodeArgs',
      'args',
      'sticky',
      'port',
      'healthCheck',
      'reloadRetries',
      'watch',
      'watchPaths',
      'killTimeout',
      'maxRestarts',
      'minUptime',
      'restartDelay',
      'restartOnMemory',
    ];

    for (const key of keys) {
      const a = running[key];
      const b = target[key];
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length || a.some((v, i) => v !== b[i])) return true;
      } else if (a !== b) {
        return true;
      }
    }
    return false;
  }

  private resolveTarget(target: 'all' | number | string): ManagedProcess[] {
    if (target === 'all') {
      return Array.from(this.processes.values());
    }

    if (typeof target === 'number') {
      const container = this.processes.get(target);
      if (!container) {
        throw new Error(`Process with id ${target} not found`);
      }
      return [container];
    }

    // Try by name first
    const id = this.nameToId.get(target);
    if (id !== undefined) {
      const container = this.processes.get(id);
      if (container) {
        return [container];
      }
    }

    // Try parsing as number
    const numId = parseInt(target, 10);
    if (!isNaN(numId)) {
      const container = this.processes.get(numId);
      if (container) {
        return [container];
      }
    }

    throw new Error(`Process "${target}" not found`);
  }

  getProcess(target: number | string): ManagedProcess | undefined {
    const containers = this.resolveTarget(target);
    return containers[0];
  }

  getProcessByName(name: string): ManagedProcess | undefined {
    const id = this.nameToId.get(name);
    if (id === undefined) return undefined;
    return this.processes.get(id);
  }

  getDaemonStatus() {
    return {
      pid: process.pid,
      uptime: Date.now() - this.startedAt,
      processCount: this.processes.size,
      workerCount: Array.from(this.processes.values()).reduce(
        (sum, p) => sum + p.getWorkerCount(),
        0
      ),
    };
  }
}
