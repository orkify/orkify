import chalk from 'chalk';
import { Command } from 'commander';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { LOGS_DIR } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';

export const logsCommand = new Command('logs')
  .description('Stream logs from process(es)')
  .argument('[name]', 'Process name (optional, shows all if omitted)')
  .option('-n, --lines <number>', 'Number of lines to show', '100')
  .option('-f, --follow', 'Follow log output (stream new logs)')
  .option('--err', 'Show error logs only')
  .option('--out', 'Show stdout logs only')
  .action(async (name: string | undefined, options) => {
    try {
      const lines = parseInt(options.lines, 10);

      // If not following, just read from log files
      if (!options.follow) {
        await showLogFile(name, lines, options.err, options.out);
        return;
      }

      // Follow mode: subscribe to live logs
      console.log(chalk.blue('Streaming logs... (Ctrl+C to stop)\n'));

      const unsubscribe = await daemonClient.streamLogs(name, (data: unknown) => {
        const logData = data as {
          type: string;
          workerId: number;
          data: string;
          processName?: string;
        };
        const prefix = logData.processName
          ? chalk.cyan(`[${logData.processName}:${logData.workerId}]`)
          : chalk.cyan(`[worker:${logData.workerId}]`);

        const output = logData.type === 'err' ? chalk.red(logData.data) : logData.data;

        process.stdout.write(`${prefix} ${output}`);
      });

      // Keep the process running until interrupted
      process.on('SIGINT', () => {
        unsubscribe();
        daemonClient.disconnect();
        process.exit(0);
      });

      // Keep alive
      await new Promise(() => {});
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

async function showLogFile(
  name: string | undefined,
  lines: number,
  errOnly: boolean,
  outOnly: boolean
): Promise<void> {
  if (!existsSync(LOGS_DIR)) {
    console.log(chalk.gray('No logs found'));
    return;
  }

  const files: string[] = [];

  if (name) {
    if (!errOnly) {
      const outFile = join(LOGS_DIR, `${name}.stdout.log`);
      if (existsSync(outFile)) files.push(outFile);
    }
    if (!outOnly) {
      const errFile = join(LOGS_DIR, `${name}.stderr.log`);
      if (existsSync(errFile)) files.push(errFile);
    }
  } else {
    // Show all log files
    const { readdirSync } = await import('node:fs');
    const allFiles = readdirSync(LOGS_DIR);

    for (const file of allFiles) {
      if (errOnly && !file.endsWith('.stderr.log')) continue;
      if (outOnly && !file.endsWith('.stdout.log')) continue;
      if (!file.endsWith('.stdout.log') && !file.endsWith('.stderr.log')) continue;
      files.push(join(LOGS_DIR, file));
    }
  }

  if (files.length === 0) {
    console.log(chalk.gray('No logs found'));
    return;
  }

  for (const file of files) {
    await tailFile(file, lines);
  }
}

async function tailFile(filePath: string, lines: number): Promise<void> {
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

    rl.on('close', () => {
      for (const line of buffer) {
        console.log(line);
      }
      resolve();
    });

    rl.on('error', reject);
  });
}
