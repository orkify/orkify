import { execSync } from 'node:child_process';
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type {
  DeployCommand,
  DeployLocalPayload,
  DeployOptions,
  DeployRestorePayload,
  DeploySettings,
  KillPayload,
  LogsPayload,
  McpStartPayload,
  ProcessConfig,
  RestorePayload,
  SnapPayload,
  TargetPayload,
  UpPayload,
} from '../types/index.js';
import {
  DAEMON_PID_FILE,
  IPCMessageType,
  LOGS_DIR,
  ORKIFY_DEPLOYS_DIR,
  ORKIFY_HOME,
  SOCKET_PATH,
  TELEMETRY_DEFAULT_API_HOST,
} from '../constants.js';
import { CommandPoller } from '../deploy/CommandPoller.js';
import { getOrkifyConfig } from '../deploy/config.js';
import { DeployExecutor } from '../deploy/DeployExecutor.js';
import { type ClientConnection, DaemonServer } from '../ipc/DaemonServer.js';
import { createResponse } from '../ipc/protocol.js';
import { type McpHttpServer, startMcpHttpServer } from '../mcp/http.js';
import { TelemetryReporter } from '../telemetry/TelemetryReporter.js';
import { Orchestrator } from './Orchestrator.js';

export interface DaemonOptions {
  /** Skip crash recovery, adjust KILL_DAEMON behavior (no process.exit) */
  foreground?: boolean;
  /** Don't monkey-patch console.log with timestamp prefixes */
  skipTimestampPrefix?: boolean;
}

export interface DaemonContext {
  orchestrator: Orchestrator;
  server: DaemonServer;
  telemetry: null | TelemetryReporter;
  startMcpHttp: (opts: McpStartPayload) => Promise<void>;
  getMcpOptions: () => McpStartPayload | null;
  gracefulShutdown: () => Promise<void>;
  /** Bind IPC socket and start listening */
  startServer: () => Promise<void>;
  cleanup: () => void;
  /** Mark that server.stop()/cleanup() should be skipped during shutdown
   * (e.g. because crash recovery already cleaned up the socket). */
  markSkipServerStop: () => void;
}

/**
 * Acquire an exclusive lock on the PID file using O_EXCL (atomic create).
 * Keeps the fd open for the process lifetime so the PID file's existence
 * reliably indicates a running daemon. Returns the open fd.
 *
 * If the PID file already exists, checks whether the holder is still alive.
 * Stale PID files (dead holder) are removed and re-acquired.
 *
 * Throws if another daemon is genuinely running.
 */
function acquirePidLock(): number {
  try {
    const fd = openSync(DAEMON_PID_FILE, 'wx'); // O_CREAT | O_EXCL | O_WRONLY
    writeSync(fd, String(process.pid));
    return fd;
  } catch {
    // PID file exists — check if the holder is still alive
    let holderPid: number;
    try {
      holderPid = parseInt(readFileSync(DAEMON_PID_FILE, 'utf-8').trim(), 10);
      process.kill(holderPid, 0); // throws if process is dead
    } catch (e) {
      // Holder is dead or PID file is unreadable — stale lock, take over
      if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'EPERM') {
        // EPERM means the process exists but we can't signal it (different user)
        throw new Error(
          'Another daemon is already running (cannot signal PID, permission denied)',
          { cause: e }
        );
      }
      try {
        unlinkSync(DAEMON_PID_FILE);
        const fd = openSync(DAEMON_PID_FILE, 'wx');
        writeSync(fd, String(process.pid));
        return fd;
      } catch {
        throw new Error('Failed to acquire daemon lock (race with another process)');
      }
    }

    throw new Error(`Another daemon is already running (PID ${holderPid})`);
  }
}

/**
 * Read the last N lines from a log file on disk.
 */
function tailFile(filePath: string, lines: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const buffer: string[] = [];
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = createInterface({ input: stream });

    rl.on('line', (line) => {
      buffer.push(line);
      if (buffer.length > lines) {
        buffer.shift();
      }
    });

    rl.on('close', () => resolve(buffer));
    rl.on('error', reject);
  });
}

/**
 * Read recent log lines from disk for a process (or all processes).
 */
async function readLogFiles(
  target: string,
  lines: number
): Promise<Array<{ file: string; lines: string[] }>> {
  if (!existsSync(LOGS_DIR)) return [];

  const files: string[] = [];

  if (target !== 'all') {
    const outFile = join(LOGS_DIR, `${target}.stdout.log`);
    const errFile = join(LOGS_DIR, `${target}.stderr.log`);
    if (existsSync(outFile)) files.push(outFile);
    if (existsSync(errFile)) files.push(errFile);
  } else {
    for (const file of readdirSync(LOGS_DIR)) {
      if (file.endsWith('.stdout.log') || file.endsWith('.stderr.log')) {
        files.push(join(LOGS_DIR, file));
      }
    }
  }

  const results: Array<{ file: string; lines: string[] }> = [];
  for (const file of files) {
    const tail = await tailFile(file, lines);
    if (tail.length > 0) {
      results.push({ file, lines: tail });
    }
  }
  return results;
}

export async function startDaemon(options: DaemonOptions = {}): Promise<DaemonContext> {
  const { foreground = false, skipTimestampPrefix = false } = options;

  // Prepend ISO timestamps to all daemon log output (background mode only)
  if (!skipTimestampPrefix) {
    const originalLog = console.log.bind(console);
    const originalError = console.error.bind(console);

    console.log = (...args: unknown[]) => {
      originalLog(`[${new Date().toISOString()}]`, ...args);
    };

    console.error = (...args: unknown[]) => {
      originalError(`[${new Date().toISOString()}] ERROR`, ...args);
    };
  }

  // Ensure home directory exists
  if (!existsSync(ORKIFY_HOME)) {
    mkdirSync(ORKIFY_HOME, { recursive: true });
  }

  // Acquire exclusive PID lock — throws if another daemon is running
  const pidLockFd = acquirePidLock();

  const orchestrator = new Orchestrator();
  const server = new DaemonServer();

  let telemetry: null | TelemetryReporter = null;
  const apiKey = process.env.ORKIFY_API_KEY;
  if (apiKey) {
    const apiHost = process.env.ORKIFY_API_HOST || TELEMETRY_DEFAULT_API_HOST;
    const config = { apiKey, apiHost };
    telemetry = new TelemetryReporter(config, orchestrator);
    telemetry.start();

    const poller = new CommandPoller(config, orchestrator, telemetry);
    poller.start();

    console.log(`Telemetry enabled → ${apiHost}`);
  } else {
    console.log('Telemetry disabled (no ORKIFY_API_KEY)');
  }

  // MCP HTTP server state
  let mcpServer: McpHttpServer | null = null;
  let mcpOptions: McpStartPayload | null = null;

  // Forward logs to connected clients
  orchestrator.on('log', (data) => {
    server.broadcastLog(data.processName, data);
  });

  // Register handlers
  server.registerHandler(IPCMessageType.UP, async (request) => {
    if (foreground) {
      // In foreground mode, block additional processes
      const existingProcesses = orchestrator.list();
      if (existingProcesses.length > 0) {
        return createResponse(
          request.id,
          false,
          undefined,
          'Daemon is in foreground mode — use `orkify run` for additional processes or switch to daemon mode with `orkify up`.'
        );
      }
    }

    const payload = request.payload as UpPayload;
    const info = await orchestrator.up(payload);
    return createResponse(request.id, true, info);
  });

  server.registerHandler(IPCMessageType.DOWN, async (request) => {
    const payload = request.payload as TargetPayload;
    const results = await orchestrator.down(payload.target);
    return createResponse(request.id, true, results);
  });

  server.registerHandler(IPCMessageType.RESTART, async (request) => {
    const payload = request.payload as TargetPayload;
    const results = await orchestrator.restart(payload.target);
    return createResponse(request.id, true, results);
  });

  server.registerHandler(IPCMessageType.RELOAD, async (request) => {
    const payload = request.payload as TargetPayload;
    const results = await orchestrator.reload(payload.target);
    return createResponse(request.id, true, results);
  });

  server.registerHandler(IPCMessageType.DELETE, async (request) => {
    const payload = request.payload as TargetPayload;
    const results = await orchestrator.delete(payload.target);
    return createResponse(request.id, true, results);
  });

  server.registerHandler(IPCMessageType.LIST, async (request) => {
    const list = orchestrator.list();
    return createResponse(request.id, true, list);
  });

  server.registerHandler(IPCMessageType.LOGS, async (request, client: ClientConnection) => {
    const payload = request.payload as LogsPayload;
    const target = payload.target !== undefined ? String(payload.target) : 'all';

    if (payload.follow) {
      server.subscribeToLogs(target, client, request.id);
      return createResponse(request.id, true, { subscribed: true });
    }

    // Non-follow mode: read recent lines from log files on disk
    const lines = payload.lines ?? 100;
    const logs = await readLogFiles(target, lines);
    return createResponse(request.id, true, { subscribed: false, logs });
  });

  server.registerHandler(IPCMessageType.SNAP, async (request) => {
    const payload = request.payload as SnapPayload | undefined;
    await orchestrator.snap({
      noEnv: payload?.noEnv,
      file: payload?.file,
      mcpOptions: mcpOptions ?? undefined,
    });
    return createResponse(request.id, true, { saved: true });
  });

  server.registerHandler(IPCMessageType.RESTORE, async (request) => {
    const payload = request.payload as RestorePayload | undefined;
    const { processes, mcpState } = await orchestrator.restoreFromSnapshot(payload?.file);

    // Restore MCP HTTP server if it was running when snapshot was taken
    if (mcpState && !mcpServer) {
      try {
        mcpServer = await startMcpHttpServer({
          port: mcpState.port,
          bind: mcpState.bind,
          cors: mcpState.cors,
          skipSignalHandlers: true,
        });
        mcpOptions = mcpState;
      } catch (err) {
        console.error('Failed to restore MCP server:', (err as Error).message);
      }
    }

    return createResponse(request.id, true, processes);
  });

  server.registerHandler(IPCMessageType.RESTORE_CONFIGS, async (request) => {
    const configs = request.payload as ProcessConfig[];
    const results = await orchestrator.restoreFromMemory(configs);
    return createResponse(request.id, true, results);
  });

  server.registerHandler(IPCMessageType.DEPLOY_LOCAL, async (request) => {
    const p = request.payload as DeployLocalPayload;
    const version = Math.floor(Date.now() / 1000);
    const cmd: DeployCommand = {
      type: 'deploy',
      deployId: `local-${version}`,
      targetId: 'local',
      artifactId: `local-${version}`,
      version,
      sha256: '',
      sizeBytes: 0,
      downloadToken: '',
      downloadUrl: '',
      deployConfig: p.deployConfig,
    };
    const deployOptions: DeployOptions = {
      localTarball: p.tarballPath,
      secrets: p.env ?? {},
      skipTelemetry: true,
    };
    const config = {
      apiKey: apiKey ?? '',
      apiHost: process.env.ORKIFY_API_HOST || TELEMETRY_DEFAULT_API_HOST,
    };
    const executor = new DeployExecutor(
      config,
      orchestrator,
      telemetry as TelemetryReporter,
      cmd,
      deployOptions
    );
    await executor.execute();
    return createResponse(request.id, true, { deployed: true });
  });

  server.registerHandler(IPCMessageType.DEPLOY_RESTORE, async (request) => {
    const p = request.payload as DeployRestorePayload;

    if (p.downloadUrl) {
      // New version available — run full deploy
      const cmd: DeployCommand = {
        type: 'deploy',
        deployId: `restore-${p.version}`,
        targetId: 'restore',
        artifactId: p.artifactId,
        version: p.version,
        sha256: p.sha256,
        sizeBytes: p.sizeBytes,
        downloadToken: '',
        downloadUrl: p.downloadUrl,
        deployConfig: p.deployConfig as DeploySettings,
      };
      const deployOptions: DeployOptions = {
        secrets: p.secrets,
        skipTelemetry: !telemetry,
      };
      const config = {
        apiKey: apiKey ?? '',
        apiHost: process.env.ORKIFY_API_HOST || TELEMETRY_DEFAULT_API_HOST,
      };
      const executor = new DeployExecutor(
        config,
        orchestrator,
        telemetry as TelemetryReporter,
        cmd,
        deployOptions
      );
      await executor.execute();
      return createResponse(request.id, true, { deployed: true, version: p.version });
    } else {
      // Current is latest — reconcile from local with secrets
      const currentLink = join(ORKIFY_DEPLOYS_DIR, 'current');
      const fileConfig = getOrkifyConfig(currentLink);
      if (!fileConfig?.processes?.length) {
        return createResponse(request.id, false, undefined, 'No processes defined in orkify.yml');
      }
      const configs = fileConfig.processes.map((c) => ({
        ...c,
        script: join(currentLink, c.script),
        cwd: currentLink,
      }));
      const result = await orchestrator.reconcile(configs, p.secrets);
      return createResponse(request.id, true, result);
    }
  });

  server.registerHandler(IPCMessageType.CONFIGURE_TELEMETRY, async (request) => {
    const payload = request.payload as { apiKey: string; apiHost: string };

    if (telemetry) {
      // Already configured — nothing to do
      return createResponse(request.id, true, { configured: false, reason: 'already_active' });
    }

    if (!payload.apiKey) {
      return createResponse(request.id, true, { configured: false, reason: 'no_key' });
    }

    const config = { apiKey: payload.apiKey, apiHost: payload.apiHost };
    telemetry = new TelemetryReporter(config, orchestrator);
    telemetry.start();

    const poller = new CommandPoller(config, orchestrator, telemetry);
    poller.start();

    // Store in process.env so KILL_DAEMON can forward them to the next daemon
    process.env.ORKIFY_API_KEY = payload.apiKey;
    process.env.ORKIFY_API_HOST = payload.apiHost;

    console.log(`Telemetry configured at runtime → ${payload.apiHost}`);
    return createResponse(request.id, true, { configured: true });
  });

  server.registerHandler(IPCMessageType.KILL_DAEMON, async (request) => {
    const payload = request.payload as KillPayload | undefined;
    const force = payload?.force === true;

    // Schedule shutdown after sending response
    setTimeout(async () => {
      if (force) {
        // Remove PID file + socket first, then kill everything.
        cleanup();
        if (!foreground) {
          if (process.platform === 'win32') {
            // Kill the entire process tree on Windows
            execSync(`taskkill /T /F /PID ${process.pid}`, { stdio: 'ignore' });
          } else {
            // Kill the entire process group (daemon + all children + grandchildren)
            // in one syscall. The daemon is the group leader (spawned detached).
            process.kill(-process.pid, 'SIGKILL');
          }
        }
      } else {
        await gracefulShutdown();
        if (!foreground) {
          process.exit(0);
        }
      }
    }, 100);

    // Return telemetry env vars + process configs + MCP state so daemon-reload can restore
    const env: Record<string, string> = {};
    if (process.env.ORKIFY_API_KEY) env.ORKIFY_API_KEY = process.env.ORKIFY_API_KEY;
    if (process.env.ORKIFY_API_HOST) env.ORKIFY_API_HOST = process.env.ORKIFY_API_HOST;
    const processes = orchestrator.getRunningConfigs();

    return createResponse(request.id, true, {
      killing: true,
      env,
      processes,
      mcpOptions: mcpOptions ?? undefined,
    });
  });

  server.registerHandler(IPCMessageType.PING, async (request) => {
    return createResponse(request.id, true, { pong: true, status: orchestrator.getDaemonStatus() });
  });

  server.registerHandler(IPCMessageType.FLUSH, async (request) => {
    const payload = request.payload as TargetPayload;
    await orchestrator.flushLogs(payload.target);
    return createResponse(request.id, true, { flushed: true });
  });

  server.registerHandler(IPCMessageType.MCP_START, async (request) => {
    const payload = request.payload as McpStartPayload;

    // Validate transport type
    if (payload.transport !== 'simple-http') {
      return createResponse(
        request.id,
        false,
        undefined,
        `Unknown MCP transport: "${payload.transport}"`
      );
    }

    // Already running with same options → idempotent success
    if (mcpServer && mcpOptions) {
      if (
        mcpOptions.transport === payload.transport &&
        mcpOptions.port === payload.port &&
        mcpOptions.bind === payload.bind &&
        mcpOptions.cors === payload.cors
      ) {
        return createResponse(request.id, true, {
          started: false,
          reason: 'already_running',
          port: mcpOptions.port,
          bind: mcpOptions.bind,
        });
      }
      // Different options → stop old, start new.
      // Stop first, then start. If the new one fails, the old one is gone.
      const oldServer = mcpServer;
      const oldOptions = mcpOptions;
      try {
        await oldServer.shutdown();
        mcpServer = null;
        mcpOptions = null;

        mcpServer = await startMcpHttpServer({
          port: payload.port,
          bind: payload.bind,
          cors: payload.cors,
          skipSignalHandlers: true,
        });
        mcpOptions = payload;
        return createResponse(request.id, true, {
          started: true,
          port: payload.port,
          bind: payload.bind,
        });
      } catch (err) {
        // New server failed to start — try to restore the old one
        try {
          mcpServer = await startMcpHttpServer({
            port: oldOptions.port,
            bind: oldOptions.bind,
            cors: oldOptions.cors,
            skipSignalHandlers: true,
          });
          mcpOptions = oldOptions;
        } catch {
          // Old server can't be restored either — MCP is down
        }
        throw err;
      }
    }

    mcpServer = await startMcpHttpServer({
      port: payload.port,
      bind: payload.bind,
      cors: payload.cors,
      skipSignalHandlers: true,
    });
    mcpOptions = payload;
    return createResponse(request.id, true, {
      started: true,
      port: payload.port,
      bind: payload.bind,
    });
  });

  server.registerHandler(IPCMessageType.MCP_STOP, async (request) => {
    if (!mcpServer) {
      return createResponse(request.id, true, { stopped: false, reason: 'not_running' });
    }
    await mcpServer.shutdown();
    mcpServer = null;
    mcpOptions = null;
    return createResponse(request.id, true, { stopped: true });
  });

  server.registerHandler(IPCMessageType.MCP_STATUS, async (request) => {
    if (!mcpServer || !mcpOptions) {
      return createResponse(request.id, true, { running: false });
    }
    return createResponse(request.id, true, {
      running: true,
      transport: mcpOptions.transport,
      port: mcpOptions.port,
      bind: mcpOptions.bind,
      cors: mcpOptions.cors,
    });
  });

  server.registerHandler(IPCMessageType.CRASH_TEST, async (request) => {
    // Throw after responding so the uncaughtException handler triggers crash recovery.
    setTimeout(() => {
      throw new Error('CRASH_TEST trigger');
    }, 100);
    return createResponse(request.id, true, { crashing: true });
  });

  // Release PID lock and clean up socket
  function cleanup() {
    try {
      closeSync(pidLockFd);
    } catch {
      // Ignore — may already be closed
    }
    try {
      if (existsSync(DAEMON_PID_FILE)) {
        unlinkSync(DAEMON_PID_FILE);
      }
      if (existsSync(SOCKET_PATH)) {
        unlinkSync(SOCKET_PATH);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  // Guard against concurrent shutdown sequences
  let isShuttingDown = false;
  let skipServerStop = false;

  async function gracefulShutdown(): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    try {
      // Shut down MCP HTTP server first (before closing the IPC server)
      if (mcpServer) {
        await mcpServer.shutdown().catch(() => {});
        mcpServer = null;
        mcpOptions = null;
      }
      await telemetry?.shutdown();
      await orchestrator.shutdown();
      if (!skipServerStop) {
        // Remove PID file before closing the IPC server. The socket
        // disappearing is the signal tests (and CLI) use to detect
        // the daemon is gone, so the PID file must be gone first.
        cleanup();
        await server.stop();
      }
    } catch (err) {
      console.error('Error during graceful shutdown:', (err as Error).message);
    }
  }

  async function startMcpHttpFromPayload(opts: McpStartPayload): Promise<void> {
    mcpServer = await startMcpHttpServer({
      port: opts.port,
      bind: opts.bind,
      cors: opts.cors,
      skipSignalHandlers: true,
    });
    mcpOptions = opts;
  }

  /** Allow the caller to mark that server.stop()/cleanup() should be skipped
   * (e.g. because crash recovery already cleaned up the socket). */
  function markSkipServerStop() {
    skipServerStop = true;
  }

  return {
    orchestrator,
    server,
    telemetry,
    startMcpHttp: startMcpHttpFromPayload,
    getMcpOptions: () => mcpOptions,
    gracefulShutdown,
    startServer: () => server.start(),
    cleanup,
    markSkipServerStop,
  };
}
