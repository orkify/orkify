import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

// Base paths
export const ORKIFY_HOME = join(homedir(), '.orkify');
export const SNAPSHOT_FILE = join(ORKIFY_HOME, 'snapshot.yml');
export const DAEMON_PID_FILE = join(ORKIFY_HOME, 'daemon.pid');
export const DAEMON_LOCK_FILE = join(ORKIFY_HOME, 'daemon.lock');
export const DAEMON_LOG_FILE = join(ORKIFY_HOME, 'daemon.log');
export const LOGS_DIR = join(ORKIFY_HOME, 'logs');

// IPC socket path - cross-platform (Unix sockets on Linux/macOS, Named Pipes on Windows)
// Include username to support multi-user setups
function getSocketPath(): string {
  const username = userInfo().username;
  if (process.platform === 'win32') {
    // Windows Named Pipe - namespaced per user
    return `\\\\.\\pipe\\orkify-${username}`;
  }
  // Unix socket in user's home directory
  return join(ORKIFY_HOME, 'orkify.sock');
}

export const SOCKET_PATH = getSocketPath();

// Timeouts (in milliseconds)
export const DAEMON_STARTUP_TIMEOUT = 5000;
export const KILL_TIMEOUT = 5000;
export const LAUNCH_TIMEOUT = 30_000;
export const IPC_CONNECT_TIMEOUT = 3000;
export const IPC_RESPONSE_TIMEOUT = 120000; // 2 minutes for long operations like reload

// Defaults
export const DEFAULT_WORKERS = 1;
export const DEFAULT_MAX_RESTARTS = 10;
export const DEFAULT_MIN_UPTIME = 1000;
export const DEFAULT_RESTART_DELAY = 100;
export const DEFAULT_RELOAD_RETRIES = 3;
export const MIN_LOG_MAX_SIZE = 1024; // 1 KB floor
export const DEFAULT_LOG_MAX_SIZE = 100 * 1024 * 1024; // 100 MB
export const DEFAULT_LOG_MAX_FILES = 90;
export const DEFAULT_LOG_MAX_AGE = 90 * 24 * 60 * 60 * 1000; // 90 days in ms

// Process status
export const ProcessStatus = {
  ONLINE: 'online',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERRORED: 'errored',
  LAUNCHING: 'launching',
} as const;

export type ProcessStatusType = (typeof ProcessStatus)[keyof typeof ProcessStatus];

// Execution modes
export const ExecMode = {
  FORK: 'fork',
  CLUSTER: 'cluster',
} as const;

export type ExecModeType = (typeof ExecMode)[keyof typeof ExecMode];

// IPC message types
export const IPCMessageType = {
  // Commands
  UP: 'up',
  DOWN: 'down',
  RESTART: 'restart',
  RELOAD: 'reload',
  DELETE: 'delete',
  LIST: 'list',
  LOGS: 'logs',
  SNAP: 'snap',
  RESTORE: 'restore',
  RESTORE_CONFIGS: 'restore_configs',
  DEPLOY_LOCAL: 'deploy_local',
  DEPLOY_RESTORE: 'deploy_restore',
  KILL_DAEMON: 'kill_daemon',
  CONFIGURE_TELEMETRY: 'configure_telemetry',
  PING: 'ping',
  CRASH_TEST: 'crash_test',
  FLUSH: 'flush',

  // Responses
  SUCCESS: 'success',
  ERROR: 'error',
  PROCESS_LIST: 'process_list',
  LOG_DATA: 'log_data',
  PONG: 'pong',
} as const;

export type IPCMessageTypeType = (typeof IPCMessageType)[keyof typeof IPCMessageType];

// Metrics probe — injected into child processes via --import data URL.
// Wrapped in try/catch so a probe failure never crashes the child process.
const METRICS_PROBE_SRC = `
try {
  if (typeof process.send === "function") {
    const { monitorEventLoopDelay } = await import("node:perf_hooks");
    const { readFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const { fileURLToPath } = await import("node:url");
    const { resolve: resolvePath } = await import("node:path");
    const v8 = await import("node:v8");
    const os = await import("node:os");
    const h = monitorEventLoopDelay({ resolution: 100 });
    h.enable();
    const s = process.send.bind(process);
    const t = setInterval(() => {
      try {
        const m = process.memoryUsage();
        s({ __orkify: true, type: "metrics", data: {
          heapUsed: m.heapUsed, heapTotal: m.heapTotal,
          external: m.external, arrayBuffers: m.arrayBuffers,
          eventLoopLag: h.mean / 1e6, eventLoopLagP95: h.percentile(95) / 1e6,
          activeHandles: process._getActiveHandles().length
        }});
        h.reset();
      } catch {}
    }, 2000);
    t.unref();

    // Mirrors parseUserFrames() in src/probe/parse-frames.ts — keep in sync
    function _orkifyParseUserFrames(stack) {
      const frames = [];
      if (!stack) return frames;
      for (const l of stack.split("\\n")) {
        const m = l.match(/at\\s+(?:.*?\\s+)?\\(?(.+?):(\\d+):(\\d+)\\)?$/);
        if (m) {
          let file = m[1];
          if (file.startsWith("file://")) {
            try { file = fileURLToPath(file); } catch {}
          } else if (file.startsWith("webpack-internal://") || file.startsWith("webpack://")) {
            const wp = file.replace(/^webpack(?:-internal)?:\\/\\/\\/(?:[^/]*\\/)?/, "");
            file = resolvePath(process.cwd(), wp);
          } else if (/^[a-z][a-z0-9+.-]+:/i.test(file)) {
            continue;
          }
          if (!file.startsWith("node:") && !file.includes("node_modules")) {
            frames.push({ file, line: parseInt(m[2],10), column: parseInt(m[3],10) });
            if (frames.length >= 10) break;
          }
        }
      }
      return frames;
    }

    function _orkifyCaptureError(err, type) {
      try {
        const message = err?.message || String(err);
        const stack = err?.stack || "";
        const frames = _orkifyParseUserFrames(stack);
        const topFrame = frames.length > 0 ? frames[0] : null;
        const sourceContextArr = [];
        for (const frame of frames) {
          try {
            const lines = readFileSync(frame.file, "utf8").split("\\n");
            const start = Math.max(0, frame.line - 6);
            const end = Math.min(lines.length, frame.line + 5);
            sourceContextArr.push({ file: frame.file, line: frame.line, column: frame.column,
              pre: lines.slice(start, frame.line - 1),
              target: lines[frame.line - 1] || "",
              post: lines.slice(frame.line, end) });
          } catch {}
        }
        const sourceContext = sourceContextArr.length > 0 ? sourceContextArr : null;
        let diagnostics = null;
        try {
          const mem = process.memoryUsage();
          const heap = v8.getHeapStatistics();
          diagnostics = {
            memoryUsage: { rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed,
              external: mem.external, arrayBuffers: mem.arrayBuffers },
            processUptime: process.uptime(),
            heapStatistics: { totalHeapSize: heap.total_heap_size, usedHeapSize: heap.used_heap_size,
              heapSizeLimit: heap.heap_size_limit, totalAvailableSize: heap.total_available_size,
              totalPhysicalSize: heap.total_physical_size },
            osFreeMemory: os.freemem(),
            osLoadAvg: os.loadavg(),
            activeResources: typeof process.getActiveResourcesInfo === "function"
              ? process.getActiveResourcesInfo() : []
          };
        } catch {}
        const raw = message + (topFrame ? topFrame.file + ":" + topFrame.line : "");
        const fingerprint = createHash("sha256").update(raw).digest("hex").slice(0, 32);
        s({ __orkify: true, type: "error", data: {
          errorType: type, name: err?.name || "Error", message, stack, fingerprint,
          sourceContext, topFrame, diagnostics, timestamp: Date.now(),
          nodeVersion: process.version, pid: process.pid
        }});
      } catch {}
    }

    process.on("uncaughtException", (err) => {
      _orkifyCaptureError(err, "uncaughtException");
      if (process.listenerCount("uncaughtException") === 1) {
        process.exit(1);
      }
    });

    process.on("unhandledRejection", (reason) => {
      _orkifyCaptureError(reason instanceof Error ? reason : new Error(String(reason)),
        "unhandledRejection");
    });
  }
} catch {}
`.trim();

export const METRICS_PROBE_IMPORT = `--import=data:text/javascript;base64,${Buffer.from(METRICS_PROBE_SRC).toString('base64')}`;

// Deploy
export const ORKIFY_DEPLOYS_DIR = join(ORKIFY_HOME, 'deploys');
export const DEPLOY_META_FILE = 'orkify-deploy-meta.json';
export const DEPLOY_CRASH_WINDOW_DEFAULT = 30; // seconds
export const ORKIFY_CONFIG_FILE = 'orkify.yml';

// Telemetry
export const TELEMETRY_DEFAULT_API_HOST = 'https://api.orkify.com';
export const TELEMETRY_METRICS_INTERVAL = 10_000;
export const TELEMETRY_FLUSH_TIMEOUT = 5_000;
export const TELEMETRY_MAX_BATCH_SIZE = 100;
export const TELEMETRY_REQUEST_TIMEOUT = 10_000;
export const TELEMETRY_LOG_RING_SIZE = 50;
export const TELEMETRY_LOG_FLUSH_MAX_LINES = 20;
export const TELEMETRY_LOG_MAX_LINE_LENGTH = 4000;
