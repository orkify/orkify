import { fork, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { Command } from 'commander';
import { LAUNCH_TIMEOUT } from '../../constants.js';

/**
 * Parse workers option:
 * - "0" → CPU cores
 * - negative number → CPU cores minus that value (-1 = CPUs - 1)
 * - positive number → that many workers
 */
function parseWorkers(value: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return 1;
  }
  if (num === 0) {
    return cpus().length;
  }
  if (num < 0) {
    // Negative: CPU cores minus the absolute value
    return Math.max(1, cpus().length + num);
  }
  return num;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLUSTER_WRAPPER_PATH = join(__dirname, '..', '..', 'cluster', 'ClusterWrapper.js');

/**
 * Run command - runs process in foreground (no daemon)
 * Designed for container environments like Docker/Kubernetes
 * Ideal for Docker/Kubernetes where process runs as PID 1
 */
export const runCommand = new Command('run')
  .description('Run a process in foreground (no daemon, for containers)')
  .argument('<script>', 'Script file to run')
  .option('-n, --name <name>', 'Process name')
  .option('-w, --workers <number>', 'Number of workers (0 = CPU cores, -1 = CPUs-1)', '1')
  .option('--cwd <path>', 'Working directory')
  .option('--node-args <args>', 'Node.js arguments (space-separated, quoted)')
  .option('--args <args>', 'Script arguments (space-separated, quoted)')
  .option('--sticky', 'Enable sticky sessions for Socket.IO')
  .option('--port <port>', 'Port for sticky session routing (required with --sticky)')
  .option('--kill-timeout <ms>', 'Time to wait for graceful shutdown before SIGKILL', '5000')
  .option('--reload-retries <count>', 'Retries per worker slot during reload (0-3)', '3')
  .option('--silent', 'Suppress startup messages')
  .action(async (script: string, options) => {
    const scriptPath = resolve(options.cwd || process.cwd(), script);
    const workerCount = parseWorkers(options.workers);
    const name =
      options.name ||
      script
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') ||
      'app';
    const cwd = options.cwd || process.cwd();
    const nodeArgs = options.nodeArgs ? options.nodeArgs.split(/\s+/) : [];
    const scriptArgs = options.args ? options.args.split(/\s+/) : [];
    const sticky = options.sticky || false;
    const port = options.port ? parseInt(options.port, 10) : undefined;
    const killTimeout = parseInt(options.killTimeout, 10);
    const silent = options.silent || false;

    if (!silent) {
      console.log(chalk.cyan(`[orkify] Starting ${name} in foreground mode`));
      if (workerCount > 1) {
        console.log(chalk.cyan(`[orkify] Cluster mode: ${workerCount} workers`));
      }
      if (sticky) {
        console.log(chalk.cyan(`[orkify] Sticky sessions: port ${port}`));
      }
    }

    let child: ChildProcess;
    let isShuttingDown = false;
    let killTimer: NodeJS.Timeout | null = null;

    if (workerCount > 1) {
      // Cluster mode - use ClusterWrapper
      // process.env already includes vars from Node's --env-file if used
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        ORKIFY_SCRIPT: scriptPath,
        ORKIFY_WORKERS: String(workerCount),
        ORKIFY_PROCESS_NAME: name,
        ORKIFY_PROCESS_ID: '0',
        ORKIFY_KILL_TIMEOUT: String(killTimeout),
        ORKIFY_STICKY: String(sticky),
        ORKIFY_RELOAD_RETRIES: options.reloadRetries,
      };

      if (sticky && port) {
        env.ORKIFY_STICKY_PORT = String(port);
      }

      child = fork(CLUSTER_WRAPPER_PATH, [], {
        cwd,
        env,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        execArgv: nodeArgs,
      });
    } else {
      // Fork mode - run script directly
      // process.env already includes vars from Node's --env-file if used
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        ORKIFY_PROCESS_ID: '0',
        ORKIFY_PROCESS_NAME: name,
        ORKIFY_WORKER_ID: '0',
        ORKIFY_CLUSTER_MODE: 'false',
        ORKIFY_WORKERS: '1',
        ORKIFY_STICKY: String(sticky),
      };

      child = spawn(process.execPath, [...nodeArgs, scriptPath, ...scriptArgs], {
        cwd,
        env,
        stdio: 'inherit',
      });
    }

    // Graceful shutdown handler
    const shutdown = (signal: NodeJS.Signals) => {
      if (isShuttingDown) return; // Prevent double shutdown
      isShuttingDown = true;

      if (!silent) {
        console.log(chalk.yellow(`\n[orkify] Received ${signal}, shutting down...`));
      }

      // Forward signal to child
      child.kill(signal);

      // Set up kill timeout - force kill if child doesn't exit
      killTimer = setTimeout(() => {
        if (!silent) {
          console.log(chalk.red(`[orkify] Kill timeout (${killTimeout}ms), forcing exit...`));
        }
        child.kill('SIGKILL');
      }, killTimeout);
    };

    // Forward signals to child
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGHUP', () => shutdown('SIGHUP'));

    // Handle child exit
    child.on('exit', (code, signal) => {
      if (killTimer) {
        clearTimeout(killTimer);
      }

      if (signal) {
        if (!silent) {
          console.log(chalk.yellow(`[orkify] Process killed by ${signal}`));
        }
        // Exit with 128 + signal number (standard convention)
        const signalNum =
          signal === 'SIGTERM' ? 15 : signal === 'SIGINT' ? 2 : signal === 'SIGHUP' ? 1 : 9;
        process.exit(128 + signalNum);
      } else {
        if (!silent && code !== 0) {
          console.log(chalk.red(`[orkify] Process exited with code ${code}`));
        }
        process.exit(code ?? 0);
      }
    });

    child.on('error', (err) => {
      console.error(chalk.red(`[orkify] Process error: ${err.message}`));
      process.exit(1);
    });

    // Handle cluster mode IPC messages
    if (workerCount > 1) {
      const launchTimers = new Map<number, NodeJS.Timeout>();
      const readyWorkers = new Set<number>();

      const clearLaunchTimer = (workerId: number) => {
        const timer = launchTimers.get(workerId);
        if (timer) {
          clearTimeout(timer);
          launchTimers.delete(workerId);
        }
      };

      const startLaunchTimer = (workerId: number) => {
        clearLaunchTimer(workerId);
        const timer = setTimeout(() => {
          launchTimers.delete(workerId);
          if (!readyWorkers.has(workerId)) {
            console.error(
              chalk.red(
                `[orkify] Worker ${workerId} failed to start — not listening and no ready signal after ${LAUNCH_TIMEOUT / 1000}s.\n` +
                  `  Common causes:\n` +
                  `  - Application crashed or hung during startup\n` +
                  `  - Running a dev server in cluster mode (e.g., Next.js dev with -w 0)\n` +
                  `  - Missing process.send('ready') for apps that don't bind a port`
              )
            );
          }
        }, LAUNCH_TIMEOUT);
        launchTimers.set(workerId, timer);
      };

      child.on('message', (msg: unknown) => {
        const message = msg as { type?: string; workerId?: number };
        const wid = message.workerId ?? -1;
        switch (message.type) {
          case 'primary:ready':
            if (!silent) {
              console.log(chalk.green('[orkify] Cluster ready'));
            }
            break;
          case 'worker:online':
            startLaunchTimer(wid);
            break;
          case 'worker:listening':
          case 'worker:ready':
            clearLaunchTimer(wid);
            readyWorkers.add(wid);
            break;
          case 'worker:exit':
            clearLaunchTimer(wid);
            readyWorkers.delete(wid);
            break;
        }
      });

      // Clean up timers on shutdown
      const origShutdown = shutdown;
      const shutdownWithTimerCleanup = (signal: NodeJS.Signals) => {
        for (const timer of launchTimers.values()) {
          clearTimeout(timer);
        }
        launchTimers.clear();
        origShutdown(signal);
      };
      // Replace signal handlers
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');
      process.removeAllListeners('SIGHUP');
      process.on('SIGINT', () => shutdownWithTimerCleanup('SIGINT'));
      process.on('SIGTERM', () => shutdownWithTimerCleanup('SIGTERM'));
      process.on('SIGHUP', () => shutdownWithTimerCleanup('SIGHUP'));
    }
  });
