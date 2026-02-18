import { spawn as spawnChild } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, unlinkSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORKIFY_HOME,
  ORKIFY_DEPLOYS_DIR,
  DAEMON_PID_FILE,
  DAEMON_LOG_FILE,
  SOCKET_PATH,
  IPCMessageType,
  TELEMETRY_DEFAULT_API_HOST,
} from '../constants.js';
import { CommandPoller } from '../deploy/CommandPoller.js';
import { getOrkifyConfig } from '../deploy/config.js';
import { DeployExecutor } from '../deploy/DeployExecutor.js';
import { DaemonServer, type ClientConnection } from '../ipc/DaemonServer.js';
import { createResponse } from '../ipc/protocol.js';
import { startMcpHttpServer, type McpHttpServer } from '../mcp/http.js';
import { TelemetryReporter } from '../telemetry/TelemetryReporter.js';
import type {
  DeployCommand,
  DeployLocalPayload,
  DeployOptions,
  DeployRestorePayload,
  DeploySettings,
  McpStartPayload,
  UpPayload,
  TargetPayload,
  LogsPayload,
  SnapPayload,
  RestorePayload,
  ProcessConfig,
} from '../types/index.js';
import { Orchestrator } from './Orchestrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Prepend ISO timestamps to all daemon log output
const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);

console.log = (...args: unknown[]) => {
  originalLog(`[${new Date().toISOString()}]`, ...args);
};

console.error = (...args: unknown[]) => {
  originalError(`[${new Date().toISOString()}] ERROR`, ...args);
};

// Ensure home directory exists
if (!existsSync(ORKIFY_HOME)) {
  mkdirSync(ORKIFY_HOME, { recursive: true });
}

// Write PID file
writeFileSync(DAEMON_PID_FILE, String(process.pid), 'utf-8');

const orchestrator = new Orchestrator();
const server = new DaemonServer();

let telemetry: TelemetryReporter | null = null;
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
  }

  return createResponse(request.id, true, { subscribed: payload.follow });
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
  // Schedule shutdown after sending response
  setTimeout(async () => {
    await gracefulShutdown();
    process.exit(0);
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

// Cleanup on exit
function cleanup() {
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
let crashRecoveryRan = false;

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
    // Skip server.stop() if crash recovery already ran — it calls cleanup()
    // which removes the socket, and by now a new daemon may have created a
    // fresh socket at the same path. server.stop() would delete that.
    if (!crashRecoveryRan) {
      await server.stop();
    }
  } catch (err) {
    console.error('Error during graceful shutdown:', (err as Error).message);
  }

  if (!crashRecoveryRan) {
    cleanup();
  }
}

/**
 * Spawn a detached crash-recovery process that will start a new daemon
 * and restore all running process configs. Only runs once — if this daemon
 * was itself started by crash recovery (ORKIFY_CRASH_RECOVERY is set),
 * we skip to prevent infinite crash loops.
 */
function crashRecovery(): void {
  if (process.env.ORKIFY_CRASH_RECOVERY) {
    console.error('Skipping crash recovery — this daemon was started by crash recovery');
    return;
  }

  try {
    const configs = orchestrator.getRunningConfigs();
    if (configs.length === 0 && !mcpOptions) {
      console.error('Crash recovery: no running processes to restore');
      return;
    }

    const env: Record<string, string> = {};
    if (process.env.ORKIFY_API_KEY) env.ORKIFY_API_KEY = process.env.ORKIFY_API_KEY;
    if (process.env.ORKIFY_API_HOST) env.ORKIFY_API_HOST = process.env.ORKIFY_API_HOST;

    const payload = JSON.stringify({
      env,
      configs,
      mcpOptions: mcpOptions ?? undefined,
    });
    const recoveryScript = join(__dirname, '..', 'cli', 'crash-recovery.js');

    // Remove PID file and socket now so the recovery script doesn't have to
    // wait for gracefulShutdown() — which may hang in a crashing process.
    cleanup();
    crashRecoveryRan = true;

    const logFd = openSync(DAEMON_LOG_FILE, 'a');

    const child = spawnChild(process.execPath, [recoveryScript], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, ORKIFY_CRASH_RECOVERY: payload },
    });
    child.unref();

    console.error(`Crash recovery: spawned recovery process (PID: ${child.pid})`);
  } catch (err) {
    console.error('Crash recovery: failed to spawn recovery process:', (err as Error).message);
  }
}

// SIGUSR2 handler for crash testing (Unix only) — triggers an uncaught exception
// which exercises the crashRecovery → gracefulShutdown → exit path.
if (process.platform !== 'win32') {
  process.on('SIGUSR2', () => {
    throw new Error('SIGUSR2 crash trigger');
  });
}

process.on('SIGTERM', async () => {
  await gracefulShutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await gracefulShutdown();
  process.exit(0);
});

process.on('uncaughtException', async (err) => {
  console.error('Uncaught exception:', err);
  crashRecovery();
  await gracefulShutdown();
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  console.error('Unhandled rejection:', reason);
  crashRecovery();
  await gracefulShutdown();
  process.exit(1);
});

// Start the server
server
  .start()
  .then(() => {
    console.log(`ORKIFY daemon started (PID: ${process.pid})`);

    // If this daemon was started by crash recovery, re-enable crash recovery
    // after a stability window. If it crashes again within 60s it's likely
    // the same root cause — the guard in crashRecovery() prevents a loop.
    if (process.env.ORKIFY_CRASH_RECOVERY) {
      const stabilityTimer = setTimeout(() => {
        delete process.env.ORKIFY_CRASH_RECOVERY;
        console.log('Crash recovery re-enabled after stability window');
      }, 60_000);
      stabilityTimer.unref();
    }
  })
  .catch((err) => {
    console.error('Failed to start daemon:', err);
    cleanup();
    process.exit(1);
  });
