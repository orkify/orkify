import chalk from 'chalk';
import { Command } from 'commander';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import type { McpStartPayload, ProcessInfo, UpPayload } from '../../types/index.js';
import {
  DEFAULT_LOG_MAX_AGE,
  DEFAULT_LOG_MAX_FILES,
  DEFAULT_LOG_MAX_SIZE,
  MCP_DEFAULT_PORT,
  MIN_LOG_MAX_SIZE,
} from '../../constants.js';
import { type DaemonContext, startDaemon } from '../../daemon/startDaemon.js';

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

/**
 * Parse human-readable size string to bytes.
 * Supports: 100M, 500K, 1G, or raw byte count.
 */
function parseSize(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i);
  let bytes: number;
  if (!match) {
    const num = parseInt(value, 10);
    bytes = isNaN(num) ? DEFAULT_LOG_MAX_SIZE : num;
  } else {
    const num = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    switch (unit) {
      case 'k':
        bytes = Math.round(num * 1024);
        break;
      case 'm':
        bytes = Math.round(num * 1024 * 1024);
        break;
      case 'g':
        bytes = Math.round(num * 1024 * 1024 * 1024);
        break;
      default:
        bytes = Math.round(num);
        break;
    }
  }
  return Math.max(bytes, MIN_LOG_MAX_SIZE);
}

/**
 * Run command - runs process in foreground with full daemon features
 * Designed for container environments like Docker/Kubernetes
 * Ideal for Docker/Kubernetes where process runs as PID 1
 */
export const runCommand = new Command('run')
  .description('Run a process in foreground (for containers) with full daemon features')
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
  .option('--max-restarts <count>', 'Maximum restart attempts (default 0 in run mode)', '0')
  .option('--min-uptime <ms>', 'Minimum uptime before restart counts', '1000')
  .option('--restart-delay <ms>', 'Delay between restarts', '100')
  .option('--watch', 'Watch for file changes and reload')
  .option('--watch-paths <paths...>', 'Specific paths to watch')
  .option('--health-check <path>', 'Health check endpoint path (e.g. /health)')
  .option(
    '--log-max-size <size>',
    'Max log file size before rotation (e.g. 100M, 500K, 1G)',
    String(DEFAULT_LOG_MAX_SIZE)
  )
  .option(
    '--log-max-files <count>',
    'Rotated log files to keep (0 = no rotation)',
    String(DEFAULT_LOG_MAX_FILES)
  )
  .option(
    '--log-max-age <days>',
    'Delete rotated log files older than N days (0 = no age limit)',
    String(DEFAULT_LOG_MAX_AGE / (24 * 60 * 60 * 1000))
  )
  .option('--mcp-simple-http', 'Start MCP HTTP server (local key auth)')
  .option('--mcp-port <port>', 'MCP HTTP port', String(MCP_DEFAULT_PORT))
  .option('--mcp-bind <address>', 'MCP bind address', '127.0.0.1')
  .option('--mcp-cors <origin>', 'MCP CORS setting')
  .option('--silent', 'Suppress startup messages')
  .action(async (script: string, options) => {
    const cwd = options.cwd || process.cwd();
    const scriptPath = resolve(cwd, script);
    const workerCount = parseWorkers(options.workers);
    const name =
      options.name ||
      script
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') ||
      'app';
    const silent = options.silent || false;

    // Start daemon stack in-process (foreground mode).
    // startDaemon() acquires an exclusive PID lock — if another daemon
    // or orkify-run instance is active, it throws.
    let ctx: DaemonContext;
    try {
      ctx = await startDaemon({ foreground: true, skipTimestampPrefix: true });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('already running')) {
        console.error(
          chalk.red(`✗ ${msg}\n` + '  Stop it first with `orkify kill` or wait for it to exit.')
        );
      } else {
        console.error(chalk.red(`✗ Failed to initialize daemon: ${msg}`));
      }
      process.exit(1);
    }

    try {
      await ctx.startServer();
    } catch (err) {
      console.error(chalk.red(`✗ Failed to start IPC server: ${(err as Error).message}`));
      ctx.cleanup();
      process.exit(1);
    }

    // Start MCP HTTP server if requested
    if (options.mcpSimpleHttp) {
      try {
        const mcpPayload: McpStartPayload = {
          transport: 'simple-http',
          port: parseInt(options.mcpPort, 10),
          bind: options.mcpBind,
          cors: options.mcpCors,
        };
        await ctx.startMcpHttp(mcpPayload);
        if (!silent) {
          console.log(
            chalk.cyan(`[orkify] MCP HTTP server → ${options.mcpBind}:${options.mcpPort}`)
          );
        }
      } catch (err) {
        console.error(chalk.yellow(`[orkify] MCP HTTP server failed: ${(err as Error).message}`));
      }
    }

    // Build UpPayload and start the process via orchestrator
    const payload: UpPayload = {
      script: scriptPath,
      name,
      workers: workerCount,
      watch: options.watch || false,
      watchPaths: options.watchPaths,
      cwd,
      env: process.env as Record<string, string>,
      nodeArgs: options.nodeArgs ? options.nodeArgs.split(/\s+/) : [],
      args: options.args ? options.args.split(/\s+/) : [],
      killTimeout: parseInt(options.killTimeout, 10),
      maxRestarts: parseInt(options.maxRestarts, 10),
      minUptime: parseInt(options.minUptime, 10),
      restartDelay: parseInt(options.restartDelay, 10),
      sticky: options.sticky || false,
      port: options.port ? parseInt(options.port, 10) : undefined,
      reloadRetries: parseInt(options.reloadRetries, 10),
      healthCheck: options.healthCheck,
      logMaxSize: parseSize(options.logMaxSize),
      logMaxFiles: parseInt(options.logMaxFiles, 10),
      logMaxAge: parseInt(options.logMaxAge, 10) * 24 * 60 * 60 * 1000,
    };

    let info: ProcessInfo;
    try {
      info = await ctx.orchestrator.up(payload);
    } catch (err) {
      console.error(chalk.red(`✗ Failed to start process: ${(err as Error).message}`));
      await ctx.gracefulShutdown();
      process.exit(1);
    }

    if (!silent) {
      console.log(chalk.cyan(`[orkify] Starting ${info.name} in foreground mode`));
      if (workerCount > 1) {
        console.log(chalk.cyan(`[orkify] Cluster mode: ${workerCount} workers`));
      }
      if (options.sticky) {
        console.log(chalk.cyan(`[orkify] Sticky sessions: port ${options.port}`));
      }
      if (ctx.telemetry) {
        console.log(chalk.cyan(`[orkify] Telemetry enabled`));
      }
    }

    // Forward process output to stdout/stderr (foreground mode shows output directly)
    ctx.orchestrator.on('log', (data: { type: string; data: string }) => {
      if (data.type === 'err') {
        process.stderr.write(data.data);
      } else {
        process.stdout.write(data.data);
      }
    });

    // Track exit code from the primary process
    let exitCode = 0;
    let shuttingDown = false;

    async function shutdown(code: number): Promise<never> {
      if (shuttingDown) return undefined as never;
      shuttingDown = true;
      await ctx.gracefulShutdown();
      process.exit(code);
    }

    // Wait for primary process to reach terminal state
    const managedProcess = ctx.orchestrator.getProcess(info.name);
    if (managedProcess) {
      managedProcess.on(
        'process:finished',
        (data: { code: null | number; signal: null | string }) => {
          if (shuttingDown) return;

          if (data.signal) {
            const signalNum =
              data.signal === 'SIGTERM'
                ? 15
                : data.signal === 'SIGINT'
                  ? 2
                  : data.signal === 'SIGHUP'
                    ? 1
                    : 9;
            exitCode = 128 + signalNum;
          } else {
            exitCode = data.code ?? 0;
          }

          if (!silent && exitCode !== 0) {
            console.log(chalk.red(`[orkify] Process exited with code ${exitCode}`));
          }

          // Use setTimeout to let any pending I/O flush
          setTimeout(() => void shutdown(exitCode), 100);
        }
      );
    }

    // Signal handlers
    const handleSignal = (signal: string) => {
      if (!silent) {
        console.log(chalk.yellow(`\n[orkify] Received ${signal}, shutting down...`));
      }
      void shutdown(0);
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('SIGHUP', () => handleSignal('SIGHUP'));

    process.on('uncaughtException', async (err) => {
      console.error('Uncaught exception:', err);
      await shutdown(1);
    });

    process.on('unhandledRejection', async (reason) => {
      console.error('Unhandled rejection:', reason);
      await shutdown(1);
    });
  });
