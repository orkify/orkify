import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import {
  ORKIFY_HOME,
  DAEMON_PID_FILE,
  SOCKET_PATH,
  IPCMessageType,
  TELEMETRY_DEFAULT_API_HOST,
} from '../constants.js';
import { CommandPoller } from '../deploy/CommandPoller.js';
import { DeployExecutor } from '../deploy/DeployExecutor.js';
import { DaemonServer, type ClientConnection } from '../ipc/DaemonServer.js';
import { createResponse } from '../ipc/protocol.js';
import { TelemetryReporter } from '../telemetry/TelemetryReporter.js';
import type {
  DeployCommand,
  DeployLocalPayload,
  DeployOptions,
  UpPayload,
  TargetPayload,
  LogsPayload,
  SnapPayload,
  RestorePayload,
  ProcessConfig,
} from '../types/index.js';
import { Orchestrator } from './Orchestrator.js';

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
  await orchestrator.snap({ noEnv: payload?.noEnv, file: payload?.file });
  return createResponse(request.id, true, { saved: true });
});

server.registerHandler(IPCMessageType.RESTORE, async (request) => {
  const payload = request.payload as RestorePayload | undefined;
  const results = await orchestrator.restoreFromSnapshot(payload?.file);
  return createResponse(request.id, true, results);
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

server.registerHandler(IPCMessageType.KILL_DAEMON, async (request) => {
  // Schedule shutdown after sending response
  setTimeout(async () => {
    try {
      await telemetry?.shutdown();
      await orchestrator.shutdown();
      await server.stop();
    } catch (err) {
      console.error('Error during KILL_DAEMON shutdown:', (err as Error).message);
    }
    cleanup();
    process.exit(0);
  }, 100);

  // Return telemetry env vars + process configs so daemon-reload can restore in-memory
  const env: Record<string, string> = {};
  if (process.env.ORKIFY_API_KEY) env.ORKIFY_API_KEY = process.env.ORKIFY_API_KEY;
  if (process.env.ORKIFY_API_HOST) env.ORKIFY_API_HOST = process.env.ORKIFY_API_HOST;
  const processes = orchestrator.getRunningConfigs();

  return createResponse(request.id, true, { killing: true, env, processes });
});

server.registerHandler(IPCMessageType.PING, async (request) => {
  return createResponse(request.id, true, { pong: true, status: orchestrator.getDaemonStatus() });
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

async function gracefulShutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  try {
    await telemetry?.shutdown();
    await orchestrator.shutdown();
    await server.stop();
  } catch (err) {
    console.error('Error during graceful shutdown:', (err as Error).message);
  }
  cleanup();
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
  await gracefulShutdown();
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  console.error('Unhandled rejection:', reason);
  await gracefulShutdown();
  process.exit(1);
});

// Start the server
server
  .start()
  .then(() => {
    console.log(`ORKIFY daemon started (PID: ${process.pid})`);
  })
  .catch((err) => {
    console.error('Failed to start daemon:', err);
    cleanup();
    process.exit(1);
  });
