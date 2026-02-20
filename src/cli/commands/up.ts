import chalk from 'chalk';
import { Command } from 'commander';
import { resolve } from 'node:path';
import type { ProcessInfo, UpPayload } from '../../types/index.js';
import {
  DEFAULT_LOG_MAX_AGE,
  DEFAULT_LOG_MAX_FILES,
  DEFAULT_LOG_MAX_SIZE,
  IPCMessageType,
} from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';
import { parseLogSize, parseMemorySize, parseWorkers } from '../parse.js';

export const upCommand = new Command('up')
  .description('Start a process in daemon mode')
  .argument('<script>', 'Script file to run')
  .option('-n, --name <name>', 'Process name')
  .option('-w, --workers <number>', 'Number of workers (0 = CPU cores, -1 = CPUs-1)', '1')
  .option('--watch', 'Watch for file changes and reload')
  .option('--watch-paths <paths...>', 'Specific paths to watch')
  .option('--cwd <path>', 'Working directory')
  .option('--node-args <args>', 'Node.js arguments (space-separated, quoted)')
  .option('--args <args>', 'Script arguments (space-separated, quoted)')
  .option('--kill-timeout <ms>', 'Kill timeout in milliseconds', '5000')
  .option('--max-restarts <count>', 'Maximum restart attempts', '10')
  .option('--min-uptime <ms>', 'Minimum uptime before restart counts', '1000')
  .option('--restart-delay <ms>', 'Delay between restarts', '100')
  .option('--sticky', 'Enable sticky sessions for Socket.IO')
  .option('--port <port>', 'Port for sticky session routing (required with --sticky)')
  .option('--reload-retries <count>', 'Retries per worker slot during reload (0-3)', '3')
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
  .option('--restart-on-mem <size>', 'Restart when RSS exceeds threshold (e.g. 512M, 1G)')
  .option('--restart-on-memory <size>', 'Alias for --restart-on-mem')
  .action(async (script: string, options) => {
    try {
      // Validate script path
      if (!script || script.trim() === '') {
        console.error(chalk.red('✗ Error: Script path is required'));
        process.exit(1);
      }

      const restartOnMemRaw = options.restartOnMem || options.restartOnMemory;

      const payload: UpPayload = {
        script: resolve(options.cwd || process.cwd(), script),
        name: options.name,
        workers: parseWorkers(options.workers),
        watch: options.watch || false,
        watchPaths: options.watchPaths,
        cwd: options.cwd || process.cwd(),
        // Pass current process.env to daemon - includes vars from Node's --env-file
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
        logMaxSize: parseLogSize(options.logMaxSize),
        logMaxFiles: parseInt(options.logMaxFiles, 10),
        logMaxAge: parseInt(options.logMaxAge, 10) * 24 * 60 * 60 * 1000,
        restartOnMemory: restartOnMemRaw ? parseMemorySize(restartOnMemRaw) : undefined,
      };

      const response = await daemonClient.request(IPCMessageType.UP, payload);

      if (response.success) {
        const info = response.data as ProcessInfo;
        console.log(chalk.green(`✓ Process "${info.name}" started`));
        console.log(`  ID: ${info.id}`);
        console.log(`  Mode: ${info.execMode}`);
        console.log(`  Workers: ${info.workers.length}`);
        if (info.sticky) {
          console.log(`  Sticky sessions: enabled`);
        }
      } else {
        console.error(chalk.red(`✗ Failed to start: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });
