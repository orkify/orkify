import type { ProcessStatusType, ExecModeType, IPCMessageTypeType } from '../constants.js';

export interface ProcessConfig {
  name: string;
  script: string;
  cwd: string;
  workerCount: number;
  execMode: ExecModeType;
  watch: boolean;
  watchPaths?: string[];
  env: Record<string, string>;
  nodeArgs: string[];
  args: string[];
  killTimeout: number;
  maxRestarts: number;
  minUptime: number;
  restartDelay: number;
  sticky: boolean;
  port?: number;
  reloadRetries?: number;
  healthCheck?: string;
}

export interface WorkerInfo {
  id: number;
  pid: number;
  status: ProcessStatusType;
  restarts: number;
  crashes: number;
  uptime: number;
  memory: number;
  cpu: number;
  createdAt: number;
  stale?: boolean;
  heapUsed?: number;
  heapTotal?: number;
  external?: number;
  arrayBuffers?: number;
  eventLoopLag?: number;
  eventLoopLagP95?: number;
  activeHandles?: number;
}

export interface ProcessInfo {
  id: number;
  name: string;
  script: string;
  cwd: string;
  execMode: ExecModeType;
  workerCount: number;
  status: ProcessStatusType;
  workers: WorkerInfo[];
  pid?: number;
  createdAt: number;
  restartedAt?: number;
  watch: boolean;
  sticky: boolean;
  port?: number;
}

export interface IPCMessage {
  type: IPCMessageTypeType;
  id: string;
  payload?: unknown;
}

export interface IPCRequest extends IPCMessage {
  payload?:
    | UpPayload
    | TargetPayload
    | LogsPayload
    | SnapPayload
    | RestorePayload
    | DeployRestorePayload
    | TelemetryConfig
    | ProcessConfig[];
}

export interface IPCResponse extends IPCMessage {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface UpPayload {
  script: string;
  name?: string;
  workers?: number;
  watch?: boolean;
  watchPaths?: string[];
  cwd?: string;
  env?: Record<string, string>;
  nodeArgs?: string[];
  args?: string[];
  killTimeout?: number;
  maxRestarts?: number;
  minUptime?: number;
  restartDelay?: number;
  sticky?: boolean;
  port?: number;
  reloadRetries?: number;
  healthCheck?: string;
}

export interface TargetPayload {
  target: string | number | 'all';
}

export interface LogsPayload {
  target?: string | number;
  lines?: number;
  follow?: boolean;
}

export interface SnapPayload {
  noEnv?: boolean;
  file?: string;
}

export interface RestorePayload {
  file?: string;
}

export interface DeployRestorePayload {
  secrets: Record<string, string>;
  downloadUrl: string;
  sha256: string;
  version: number;
  artifactId: string;
  sizeBytes: number;
  deployConfig: DeploySettings;
}

export interface SavedState {
  version?: number;
  deploy?: DeploySettings;
  processes: ProcessConfig[];
}

export interface DaemonStatus {
  pid: number;
  uptime: number;
  processCount: number;
  workerCount: number;
}

// Telemetry types

export type TelemetryEventType =
  | 'process:start'
  | 'process:stop'
  | 'process:reload'
  | 'process:reloaded'
  | 'process:deploy-started'
  | 'process:deploy-finished'
  | 'process:deploy-failed'
  | 'worker:ready'
  | 'worker:exit'
  | 'worker:crash'
  | 'worker:maxRestarts'
  | 'error:uncaughtException'
  | 'error:unhandledRejection';

export interface TelemetryEvent {
  type: TelemetryEventType;
  processName: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface TelemetryMetricsSnapshot {
  processName: string;
  processId: number;
  execMode: ExecModeType;
  status: ProcessStatusType;
  workers: Array<{
    id: number;
    pid: number;
    cpu: number;
    memory: number;
    uptime: number;
    restarts: number;
    crashes: number;
    status: ProcessStatusType;
    stale?: boolean;
    heapUsed?: number;
    heapTotal?: number;
    external?: number;
    arrayBuffers?: number;
    eventLoopLag?: number;
    eventLoopLagP95?: number;
    activeHandles?: number;
  }>;
  timestamp: number;
}

export interface TelemetryHostInfo {
  os: string;
  arch: string;
  nodeVersion: string;
  cpuCount: number;
  totalMemory: number;
}

export interface SourceContextFrame {
  file: string;
  line: number;
  column: number;
  pre: string[];
  target: string;
  post: string[];
}

export interface CrashDiagnostics {
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
  processUptime: number;
  heapStatistics: {
    totalHeapSize: number;
    usedHeapSize: number;
    heapSizeLimit: number;
    totalAvailableSize: number;
    totalPhysicalSize: number;
  };
  osFreeMemory: number;
  osLoadAvg: number[];
  activeResources: string[];
}

export interface TelemetryErrorEvent {
  processName: string;
  workerId: number;
  timestamp: number;
  errorType: 'uncaughtException' | 'unhandledRejection';
  name: string;
  message: string;
  stack: string;
  fingerprint: string;
  sourceContext: SourceContextFrame[] | null;
  topFrame: { file: string; line: number; column: number } | null;
  diagnostics: CrashDiagnostics | null;
  nodeVersion: string;
  pid: number;
  lastLogs: string[];
}

export interface TelemetryLogEntry {
  processName: string;
  workerId: number;
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface DeployStatus {
  deployId: string;
  targetId: string;
  phase:
    | 'downloading'
    | 'extracting'
    | 'installing'
    | 'building'
    | 'reloading'
    | 'monitoring'
    | 'success'
    | 'failed'
    | 'rolled_back';
  buildLog?: string;
  error?: string;
}

export interface DeploySettings {
  install: string;
  build?: string;
  crashWindow?: number;
}

/** @deprecated Use DeploySettings instead */
export type DeployConfig = DeploySettings;

export interface DeployCommand {
  type: 'deploy';
  deployId: string;
  targetId: string;
  artifactId: string;
  version: number;
  sha256: string;
  sizeBytes: number;
  downloadToken: string;
  downloadUrl: string;
  deployConfig: DeploySettings;
}

export interface DeployLocalPayload {
  tarballPath: string;
  deployConfig: DeploySettings;
  env?: Record<string, string>;
}

export interface DeployOptions {
  localTarball?: string;
  secrets?: Record<string, string>;
  skipInstall?: boolean;
  skipBuild?: boolean;
  skipMonitor?: boolean;
  skipTelemetry?: boolean;
  deploysDir?: string;
}

export interface ReconcileResult {
  started: string[];
  reloaded: string[];
  deleted: string[];
}

export interface TelemetryPayload {
  daemonPid: number;
  daemonUptime: number;
  hostname: string;
  host: TelemetryHostInfo;
  events: TelemetryEvent[];
  metrics: TelemetryMetricsSnapshot[];
  errors: TelemetryErrorEvent[];
  logs: TelemetryLogEntry[];
  deployStatus?: DeployStatus;
  sentAt: number;
}

export interface TelemetryConfig {
  apiKey: string;
  apiHost: string;
}
