import { EventEmitter } from 'node:events';
import { arch, cpus, hostname, platform, totalmem } from 'node:os';
import type { Orchestrator } from '../daemon/Orchestrator.js';
import type {
  DeployStatus,
  TelemetryConfig,
  TelemetryErrorEvent,
  TelemetryEvent,
  TelemetryEventType,
  TelemetryHostInfo,
  TelemetryLogEntry,
  TelemetryMetricsSnapshot,
  TelemetryPayload,
} from '../types/index.js';
import {
  TELEMETRY_FLUSH_TIMEOUT,
  TELEMETRY_LOG_FLUSH_MAX_LINES,
  TELEMETRY_LOG_MAX_LINE_LENGTH,
  TELEMETRY_LOG_RING_SIZE,
  TELEMETRY_MAX_BATCH_SIZE,
  TELEMETRY_METRICS_INTERVAL,
  TELEMETRY_REQUEST_TIMEOUT,
} from '../constants.js';

export class TelemetryReporter extends EventEmitter {
  private config: TelemetryConfig;
  private orchestrator: Orchestrator;
  private events: TelemetryEvent[] = [];
  private metrics: TelemetryMetricsSnapshot[] = [];
  private errors: TelemetryErrorEvent[] = [];
  private logRings = new Map<string, Map<number, string[]>>();
  private logFlushBuffer: TelemetryLogEntry[] = [];
  private logFlushDropped = 0;
  private timer: null | ReturnType<typeof setInterval> = null;
  private hostName: string;
  private hostInfo: TelemetryHostInfo;
  private _deployStatus: DeployStatus | null = null;

  constructor(config: TelemetryConfig, orchestrator: Orchestrator) {
    super();
    this.config = config;
    this.orchestrator = orchestrator;
    this.hostName = hostname();
    this.hostInfo = {
      os: platform(),
      arch: arch(),
      nodeVersion: process.version,
      cpuCount: cpus().length,
      totalMemory: totalmem(),
    };
  }

  start(): void {
    this.bindEvents();
    this.timer = setInterval(() => {
      void this.collectAndFlush();
    }, TELEMETRY_METRICS_INTERVAL);
    this.timer.unref();
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await Promise.race([
      this.collectAndFlush(),
      new Promise<void>((resolve) => setTimeout(resolve, TELEMETRY_FLUSH_TIMEOUT).unref()),
    ]);
  }

  private bindEvents(): void {
    this.orchestrator.on('process:start', (data: { processName: string; processId: number }) => {
      this.pushEvent('process:start', data.processName, { processId: data.processId });
    });

    this.orchestrator.on('process:stop', (data: { processName: string; processId: number }) => {
      this.pushEvent('process:stop', data.processName, { processId: data.processId });
    });

    this.orchestrator.on('reload:start', (data: { processName: string; processId: number }) => {
      this.pushEvent('process:reload', data.processName, { processId: data.processId });
    });

    this.orchestrator.on('reload:complete', (data: { processName: string; processId: number }) => {
      this.pushEvent('process:reloaded', data.processName, { processId: data.processId });
    });

    this.orchestrator.on('worker:ready', (data: { processName: string; workerId: number }) => {
      this.pushEvent('worker:ready', data.processName, { workerId: data.workerId });
    });

    this.orchestrator.on(
      'worker:exit',
      (data: { processName: string; workerId: number; code: number; signal: null | string }) => {
        if (data.code !== 0 && data.code !== null) {
          const lastLogs = this.getWorkerLogs(data.processName, data.workerId);
          this.pushEvent('worker:crash', data.processName, {
            workerId: data.workerId,
            exitCode: data.code,
            signal: data.signal,
            lastLogs,
          });
          this.clearWorkerLogs(data.processName, data.workerId);
        } else {
          this.pushEvent('worker:exit', data.processName, {
            workerId: data.workerId,
            exitCode: data.code,
            signal: data.signal,
          });
        }
      }
    );

    this.orchestrator.on(
      'worker:maxRestarts',
      (data: { processName: string; workerId: number }) => {
        this.pushEvent('worker:maxRestarts', data.processName, { workerId: data.workerId });
      }
    );

    this.orchestrator.on(
      'log',
      (data: { processName: string; workerId: number; type: string; data: string }) => {
        // Ring buffer for crash/error context (last N lines per worker)
        let processRings = this.logRings.get(data.processName);
        if (!processRings) {
          processRings = new Map();
          this.logRings.set(data.processName, processRings);
        }
        let ring = processRings.get(data.workerId);
        if (!ring) {
          ring = [];
          processRings.set(data.workerId, ring);
        }
        ring.push(data.data);
        if (ring.length > TELEMETRY_LOG_RING_SIZE) {
          ring.shift();
        }

        // Flush buffer for log ingestion (drained each flush cycle)
        // Skip primary process logs (workerId -1) — they're internal ClusterWrapper messages
        if (data.workerId < 0) return;

        const line =
          data.data.length > TELEMETRY_LOG_MAX_LINE_LENGTH
            ? data.data.slice(0, TELEMETRY_LOG_MAX_LINE_LENGTH) + '...'
            : data.data;
        // Detect level: stderr defaults to error, but downgrade to warn if the
        // line contains warn/warning without error (e.g. console.warn output)
        let level: 'error' | 'info' | 'warn' = data.type === 'err' ? 'error' : 'info';
        if (level === 'error') {
          const prefix = line.slice(0, 80).toLowerCase();
          if (/\bwarn(ing)?\b/.test(prefix) && !/\berror\b/.test(prefix)) {
            level = 'warn';
          }
        }
        this.logFlushBuffer.push({
          processName: data.processName,
          workerId: data.workerId,
          timestamp: Date.now(),
          level,
          message: line,
        });

        // If buffer grows too large between flushes, start dropping oldest
        const maxBuffer = TELEMETRY_LOG_FLUSH_MAX_LINES * 10;
        if (this.logFlushBuffer.length > maxBuffer) {
          const excess = this.logFlushBuffer.length - maxBuffer;
          this.logFlushBuffer.splice(0, excess);
          this.logFlushDropped += excess;
        }
      }
    );

    this.orchestrator.on(
      'worker:error:captured',
      (data: { processName: string; workerId: number; error: Record<string, unknown> }) => {
        const err = data.error;
        const lastLogs = this.getWorkerLogs(data.processName, data.workerId);
        this.errors.push({
          processName: data.processName,
          workerId: data.workerId,
          timestamp: (err.timestamp as number) || Date.now(),
          errorType: err.errorType as 'uncaughtException' | 'unhandledRejection',
          name: (err.name as string) || 'Error',
          message: (err.message as string) || '',
          stack: (err.stack as string) || '',
          fingerprint: (err.fingerprint as string) || '',
          sourceContext: (err.sourceContext as TelemetryErrorEvent['sourceContext']) || null,
          topFrame: (err.topFrame as TelemetryErrorEvent['topFrame']) || null,
          diagnostics: (err.diagnostics as TelemetryErrorEvent['diagnostics']) || null,
          nodeVersion: (err.nodeVersion as string) || '',
          pid: (err.pid as number) || 0,
          lastLogs,
        });

        if (this.errors.length >= TELEMETRY_MAX_BATCH_SIZE) {
          void this.collectAndFlush();
        }
      }
    );
  }

  /**
   * Get logs for a specific worker. In cluster mode, worker stdout/stderr flows
   * through the primary process (workerId -1), so if the worker-specific ring
   * is empty we fall back to the primary's ring.
   */
  private getWorkerLogs(processName: string, workerId: number): string[] {
    const processRings = this.logRings.get(processName);
    if (!processRings) return [];
    const workerRing = processRings.get(workerId);
    if (workerRing && workerRing.length > 0) return workerRing.slice();
    // Fallback: cluster primary ring (workerId -1) captures all worker output
    const primaryRing = processRings.get(-1);
    return primaryRing?.slice() ?? [];
  }

  private clearWorkerLogs(processName: string, workerId: number): void {
    const processRings = this.logRings.get(processName);
    if (!processRings) return;
    processRings.delete(workerId);
    // Also clear primary ring on crash — it contained this worker's logs
    if (workerId !== -1) processRings.delete(-1);
  }

  private pushEvent(
    type: TelemetryEventType,
    processName: string,
    fields?: Record<string, unknown>
  ): void {
    this.events.push({
      type,
      processName,
      timestamp: Date.now(),
      ...fields,
    });

    if (this.events.length >= TELEMETRY_MAX_BATCH_SIZE) {
      void this.collectAndFlush();
    }
  }

  emitEvent(type: TelemetryEventType, processName: string, fields?: Record<string, unknown>): void {
    this.pushEvent(type, processName, fields);
  }

  setDeployStatus(status: DeployStatus | null): void {
    this._deployStatus = status;
  }

  private async collectAndFlush(): Promise<void> {
    // Collect metrics snapshot
    const processList = this.orchestrator.list();
    const now = Date.now();
    const metricsSnapshots: TelemetryMetricsSnapshot[] = processList.map((p) => ({
      processName: p.name,
      processId: p.id,
      execMode: p.execMode,
      status: p.status,
      workers: p.workers.map((w) => ({
        id: w.id,
        pid: w.pid,
        cpu: w.cpu,
        memory: w.memory,
        uptime: w.uptime,
        restarts: w.restarts,
        crashes: w.crashes,
        status: w.status,
        stale: w.stale,
        heapUsed: w.heapUsed,
        heapTotal: w.heapTotal,
        external: w.external,
        arrayBuffers: w.arrayBuffers,
        eventLoopLag: w.eventLoopLag,
        eventLoopLagP95: w.eventLoopLagP95,
        activeHandles: w.activeHandles,
      })),
      timestamp: now,
    }));

    // Drain flush buffer — cap at TELEMETRY_LOG_FLUSH_MAX_LINES per worker
    const logsToSend = this.drainLogFlushBuffer();

    // Buffer swap
    const eventsToSend = this.events;
    const metricsToSend = [...this.metrics, ...metricsSnapshots];
    const errorsToSend = this.errors;
    this.events = [];
    this.metrics = [];
    this.errors = [];

    if (
      eventsToSend.length === 0 &&
      metricsToSend.length === 0 &&
      errorsToSend.length === 0 &&
      logsToSend.length === 0
    ) {
      return;
    }

    const daemonStatus = this.orchestrator.getDaemonStatus();
    const payload: TelemetryPayload = {
      daemonPid: daemonStatus.pid,
      daemonUptime: daemonStatus.uptime,
      hostname: this.hostName,
      host: this.hostInfo,
      events: eventsToSend,
      metrics: metricsToSend,
      errors: errorsToSend,
      logs: logsToSend,
      sentAt: Date.now(),
    };

    // Include deploy status if active
    if (this._deployStatus) {
      payload.deployStatus = this._deployStatus;
      const terminalPhases = ['success', 'failed', 'rolled_back'];
      if (terminalPhases.includes(this._deployStatus.phase)) {
        this._deployStatus = null; // Clear after terminal state is sent
      }
    }

    try {
      const response = await fetch(`${this.config.apiHost}/api/v1/ingest/telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TELEMETRY_REQUEST_TIMEOUT),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`Telemetry flush failed: ${response.status} ${response.statusText} ${body}`);
        this.restoreBuffers(eventsToSend, metricsToSend, errorsToSend, logsToSend);
      } else {
        // Parse response for pending commands
        try {
          const responseBody = (await response.json()) as { has_commands?: boolean };
          if (responseBody.has_commands) {
            this.emit('commands:pending');
          }
        } catch {
          // Ignore JSON parse errors on response
        }
      }
    } catch (err) {
      console.error('Telemetry flush error:', err instanceof Error ? err.message : err);
      this.restoreBuffers(eventsToSend, metricsToSend, errorsToSend, logsToSend);
    }
  }

  /**
   * Drain the log flush buffer, capping at TELEMETRY_LOG_FLUSH_MAX_LINES per
   * worker. When lines are dropped, prepend a truncation marker.
   */
  private drainLogFlushBuffer(): TelemetryLogEntry[] {
    const buffer = this.logFlushBuffer;
    const dropped = this.logFlushDropped;
    this.logFlushBuffer = [];
    this.logFlushDropped = 0;

    if (buffer.length === 0) return [];

    // Group by processName:workerId, keep the last N lines per worker
    const groups = new Map<string, TelemetryLogEntry[]>();
    for (const entry of buffer) {
      const key = `${entry.processName}:${entry.workerId}`;
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(entry);
    }

    const result: TelemetryLogEntry[] = [];
    for (const [, entries] of groups) {
      if (entries.length > TELEMETRY_LOG_FLUSH_MAX_LINES) {
        const excess = entries.length - TELEMETRY_LOG_FLUSH_MAX_LINES;
        const kept = entries.slice(-TELEMETRY_LOG_FLUSH_MAX_LINES);
        // Prepend truncation marker
        const first = kept[0];
        result.push({
          processName: first.processName,
          workerId: first.workerId,
          timestamp: first.timestamp - 1,
          level: 'info',
          message: `\u22EF ${excess} log lines truncated`,
        });
        result.push(...kept);
      } else {
        result.push(...entries);
      }
    }

    // If there were globally dropped lines (buffer overflow between flushes)
    if (dropped > 0 && result.length > 0) {
      const first = result[0];
      result.unshift({
        processName: first.processName,
        workerId: first.workerId,
        timestamp: first.timestamp - 1,
        level: 'info',
        message: `\u22EF ${dropped} log lines dropped (buffer overflow)`,
      });
    }

    return result;
  }

  private restoreBuffers(
    events: TelemetryEvent[],
    metrics: TelemetryMetricsSnapshot[],
    errors: TelemetryErrorEvent[],
    logs: TelemetryLogEntry[]
  ): void {
    const maxSize = TELEMETRY_MAX_BATCH_SIZE * 2;
    this.events = [...events, ...this.events].slice(-maxSize);
    this.metrics = [...metrics, ...this.metrics].slice(-maxSize);
    this.errors = [...errors, ...this.errors].slice(-maxSize);
    // Restore logs back to flush buffer (prepend so they'll be sent first next time)
    this.logFlushBuffer = [...logs, ...this.logFlushBuffer].slice(-maxSize);
  }
}
