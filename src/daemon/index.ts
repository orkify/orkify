import { spawn as spawnChild } from 'node:child_process';
import { writeFileSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAEMON_PID_FILE, DAEMON_LOG_FILE } from '../constants.js';
import { startDaemon } from './startDaemon.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ctx = await startDaemon({ foreground: false });
const { orchestrator, gracefulShutdown, cleanup } = ctx;

// Write PID file
writeFileSync(DAEMON_PID_FILE, String(process.pid), 'utf-8');

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
    const mcpOptions = ctx.getMcpOptions();
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
    ctx.markSkipServerStop();

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
ctx
  .startServer()
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
