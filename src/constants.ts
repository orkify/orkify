import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

// Base paths
export const ORKIFY_HOME = join(homedir(), '.orkify');
export const SNAPSHOT_FILE = join(ORKIFY_HOME, 'snapshot.yml');
export const DAEMON_PID_FILE = join(ORKIFY_HOME, 'daemon.pid');
export const DAEMON_LOCK_FILE = join(ORKIFY_HOME, 'daemon.lock');
export const DAEMON_LOG_FILE = join(ORKIFY_HOME, 'daemon.log');
export const LOGS_DIR = join(ORKIFY_HOME, 'logs');
export const AGENT_NAME_FILE = join(ORKIFY_HOME, 'agent-name');

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
export const MEMORY_RESTART_COOLDOWN = 30_000; // 30s cooldown after memory-triggered restart

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
  MCP_START: 'mcp_start',
  MCP_STOP: 'mcp_stop',
  MCP_STATUS: 'mcp_status',

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
    // Buffer IPC cache messages globally BEFORE any await so that snapshots
    // sent on the 'online' event are captured even if cache/index.ts hasn't
    // loaded yet. The CacheClient constructor drains this buffer on creation.
    const _buf = globalThis.__orkifyCacheBuffer = [];
    const _el = (msg) => {
      if (msg?.__orkify && msg.type?.startsWith("cache:")) _buf.push(msg);
    };
    process.on("message", _el);
    globalThis.__orkifyCacheBufferCleanup = () => process.removeListener("message", _el);

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
        const data = {
          heapUsed: m.heapUsed, heapTotal: m.heapTotal,
          external: m.external, arrayBuffers: m.arrayBuffers,
          eventLoopLag: h.mean / 1e6, eventLoopLagP95: h.percentile(95) / 1e6,
          activeHandles: process._getActiveHandles().length
        };
        const _cacheStats = globalThis.__orkifyCacheStats;
        if (typeof _cacheStats === "function") {
          try {
            const cs = _cacheStats();
            data.cacheSize = cs.size;
            data.cacheTotalBytes = cs.totalBytes;
            data.cacheHits = cs.hits;
            data.cacheMisses = cs.misses;
            data.cacheHitRate = cs.hitRate;
          } catch {}
        }
        s({ __orkify: true, type: "metrics", data });
        h.reset();
      } catch {}
    }, 2000);
    t.unref();

    // Port auto-detection for fork mode: hook net.Server.listen to report
    // the first port the child binds, mirroring cluster mode's worker:listening.
    // Falls back to PORT env var if the monkey-patch fails.
    try {
      const net = await import("node:net");
      const _origListen = net.Server.prototype.listen;
      let _portReported = false;
      net.Server.prototype.listen = function(...args) {
        if (!_portReported) {
          this.once("listening", () => {
            if (!_portReported) {
              const addr = this.address();
              if (addr && typeof addr === "object" && addr.port) {
                _portReported = true;
                s({ __orkify: true, type: "listening", data: { port: addr.port } });
              }
            }
          });
        }
        return _origListen.apply(this, args);
      };
    } catch {
      const envPort = parseInt(process.env.PORT || "", 10);
      if (envPort > 0) {
        s({ __orkify: true, type: "listening", data: { port: envPort } });
      }
    }

    // CVE-2025-29927 / CVE-2024-46982: strip dangerous headers from external requests
    try {
      const _stripHeaders = ["x-middleware-subrequest", "x-now-route-matches"];
      const _isLoopback = (a) => a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
      function _wrapEmit(Server) {
        const orig = Server.prototype.emit;
        Server.prototype.emit = function(event, ...args) {
          if (event === "request") {
            const req = args[0];
            if (!_isLoopback(req?.socket?.remoteAddress || "")) {
              for (const h of _stripHeaders) delete req.headers[h];
            }
          }
          return orig.apply(this, [event, ...args]);
        };
      }
      const _http = await import("node:http");
      _wrapEmit(_http.Server);
      try { const _https = await import("node:https"); _wrapEmit(_https.Server); } catch {}
    } catch {}

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

// MCP HTTP
export const MCP_CONFIG_FILE = join(ORKIFY_HOME, 'mcp.yml');
export const MCP_DEFAULT_PORT = 8787;
export const MCP_TOKEN_PREFIX = 'orkify_mcp_';

// Deploy
export const ORKIFY_DEPLOYS_DIR = join(ORKIFY_HOME, 'deploys');
export const DEPLOY_META_FILE = 'orkify-deploy-meta.json';
export const DEPLOY_CRASH_WINDOW_DEFAULT = 30; // seconds
export const ORKIFY_CONFIG_FILE = 'orkify.yml';

// Cache
export const CACHE_DIR = join(ORKIFY_HOME, 'cache');
export const CACHE_DEFAULT_MAX_ENTRIES = 10_000;
export const CACHE_DEFAULT_MAX_MEMORY_SIZE = 64 * 1024 * 1024; // 64 MB
export const CACHE_DEFAULT_MAX_VALUE_SIZE = 1024 * 1024; // 1 MB
export const CACHE_CLEANUP_INTERVAL = 60_000; // 60s

// Telemetry
export const TELEMETRY_DEFAULT_API_HOST = 'https://api.orkify.com';
export const TELEMETRY_METRICS_INTERVAL = 10_000;
export const TELEMETRY_FLUSH_TIMEOUT = 5_000;
export const TELEMETRY_MAX_BATCH_SIZE = 100;
export const TELEMETRY_REQUEST_TIMEOUT = 10_000;
export const TELEMETRY_LOG_RING_SIZE = 50;
export const TELEMETRY_LOG_FLUSH_MAX_LINES = 20;
export const TELEMETRY_LOG_MAX_LINE_LENGTH = 4000;
