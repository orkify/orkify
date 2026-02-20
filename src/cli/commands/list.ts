import chalk from 'chalk';
import Table from 'cli-table3';
import { Command } from 'commander';
import type { ProcessInfo } from '../../types/index.js';
import { IPCMessageType, ProcessStatus } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';
import { isElevated, listAllUsers } from '../../ipc/MultiUserClient.js';
import { sleep } from '../parse.js';

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatMemory(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatCpu(cpu: number): string {
  return `${cpu.toFixed(1)}%`;
}

function getStatusColor(status: string, stale?: boolean): string {
  const label = stale && status === ProcessStatus.ONLINE ? `${status} (stale)` : status;
  switch (status) {
    case ProcessStatus.ONLINE:
      return stale ? chalk.yellow(label) : chalk.green(label);
    case ProcessStatus.STOPPING:
      return chalk.yellow(label);
    case ProcessStatus.STOPPED:
      return chalk.gray(label);
    case ProcessStatus.ERRORED:
      return chalk.red(label);
    case ProcessStatus.LAUNCHING:
      return chalk.blue(label);
    default:
      return label;
  }
}

function joinTreeViewLines(tableStr: string): string {
  const lines = tableStr.split('\n');

  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i];
    if (!line.includes('┼')) continue;

    // Check if the row below is a worker row (contains tree characters)
    const below = lines[i + 1];
    if (!below || (!/├─/.test(below) && !/└─/.test(below))) continue;

    // Find the tree character position in the row below to locate the ID column
    const treePos = below.search(/[├└]─/);
    if (treePos === -1) continue;

    // Find all ┼ positions in the border line
    const crosses = [...line.matchAll(/┼/g)].map((m) => m.index);

    // The ID column ends at the first ┼ after the tree character position
    const idColEnd = crosses.find((pos) => pos > treePos);
    if (idColEnd === undefined) continue;

    // The ID column starts after the previous separator (├ at pos 0, or a preceding ┼)
    const idColEndIdx = crosses.indexOf(idColEnd);
    const idColStart = idColEndIdx === 0 ? 0 : (crosses[idColEndIdx - 1] ?? 0);

    // Build the tree trunk continuation for the ID column segment
    // " │" at tree trunk position + spaces + "├" reconnecting to horizontal border
    const contentStart = idColStart + 1;
    const contentWidth = idColEnd - contentStart;
    const treeTrunk = ' │' + ' '.repeat(contentWidth - 2);

    // For the first column, change the left border ├ to │ (vertical continuation)
    const left = idColStart === 0 ? '│' : line.slice(0, contentStart);
    lines[i] = left + treeTrunk + '├' + line.slice(idColEnd + 1);
  }

  return lines.join('\n');
}

export function formatProcessTable(
  processes: ProcessInfo[],
  options?: { showUser?: string; verbose?: boolean }
): string {
  const includeUser = options?.showUser !== undefined;
  const verbose = options?.verbose ?? false;

  const headers = [
    ...(includeUser ? [chalk.cyan('user')] : []),
    chalk.cyan('id'),
    chalk.cyan('name'),
    chalk.cyan('mode'),
    ...(verbose ? [chalk.cyan('pid')] : []),
    chalk.cyan('↺'),
    chalk.cyan('✘'),
    chalk.cyan('status'),
    chalk.cyan('port'),
    chalk.cyan('cpu'),
    chalk.cyan('mem'),
    chalk.cyan('uptime'),
  ];

  const table = new Table({
    head: headers,
    style: {
      head: [],
      border: [],
    },
  });

  for (const proc of processes) {
    const userCol = includeUser ? [chalk.blue(options?.showUser)] : [];

    // For cluster mode, show each worker
    if (proc.workers.length > 1) {
      // Summary row
      const totalMem = proc.workers.reduce((sum, w) => sum + w.memory, 0);
      const avgCpu = proc.workers.reduce((sum, w) => sum + w.cpu, 0) / proc.workers.length;
      const totalRestarts = proc.workers.reduce((sum, w) => sum + w.restarts, 0);
      const totalCrashes = proc.workers.reduce((sum, w) => sum + w.crashes, 0);
      const hasStale = proc.workers.some((w) => w.stale);

      table.push([
        ...userCol,
        proc.id,
        chalk.bold(proc.name),
        proc.execMode,
        ...(verbose ? [proc.pid ?? '-'] : []),
        totalRestarts,
        totalCrashes || chalk.gray(0),
        getStatusColor(proc.status, hasStale),
        proc.port ?? chalk.gray('-'),
        formatCpu(avgCpu),
        formatMemory(totalMem),
        '-',
      ]);

      // Worker rows
      for (let i = 0; i < proc.workers.length; i++) {
        const worker = proc.workers[i];
        const isLast = i === proc.workers.length - 1;
        const prefix = isLast ? '└─' : '├─';

        table.push([
          ...(includeUser ? [''] : []),
          `${prefix} ${worker.id}`,
          chalk.gray(`worker ${worker.id}`),
          '',
          ...(verbose ? [worker.pid || '-'] : []),
          worker.restarts,
          worker.crashes || chalk.gray(0),
          getStatusColor(worker.status, worker.stale),
          '',
          formatCpu(worker.cpu),
          formatMemory(worker.memory),
          formatUptime(worker.uptime),
        ]);
      }
    } else {
      // Single process
      const worker = proc.workers[0];
      table.push([
        ...userCol,
        proc.id,
        proc.name,
        proc.execMode,
        ...(verbose ? [worker?.pid || '-'] : []),
        worker?.restarts || 0,
        worker?.crashes || chalk.gray(0),
        getStatusColor(proc.status),
        proc.port ?? chalk.gray('-'),
        formatCpu(worker?.cpu || 0),
        formatMemory(worker?.memory || 0),
        worker ? formatUptime(worker.uptime) : '-',
      ]);
    }
  }

  return joinTreeViewLines(table.toString());
}

export function renderProcessTable(
  processes: ProcessInfo[],
  options?: { showUser?: string; verbose?: boolean }
): void {
  console.log(formatProcessTable(processes, options));
}

async function followList(verbose: boolean): Promise<void> {
  // Test daemon connectivity before entering the loop
  try {
    await daemonClient.request(IPCMessageType.LIST);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('ECONNREFUSED') || message.includes('ENOENT')) {
      console.log(chalk.gray('No processes running (daemon not started)'));
    } else {
      console.error(chalk.red(`✗ Error: ${message}`));
    }
    return;
  }

  let prevLines = 0;
  let stopped = false;
  let forceExit = false;

  const onSigint = () => {
    if (stopped) {
      forceExit = true;
      return;
    }
    stopped = true;
  };
  process.on('SIGINT', onSigint);

  while (!stopped && !forceExit) {
    try {
      const response = await daemonClient.request(IPCMessageType.LIST);
      if (!response.success) break;

      const processes = response.data as ProcessInfo[];
      const tableStr =
        processes.length === 0
          ? chalk.gray('No processes running')
          : formatProcessTable(processes, { verbose });

      if (process.stdout.isTTY && prevLines > 0) {
        process.stdout.write(`\x1B[${prevLines}A\x1B[J`);
      }

      process.stdout.write(tableStr + '\n');
      prevLines = tableStr.split('\n').length;
    } catch {
      break;
    }

    await sleep(1000);
  }

  process.removeListener('SIGINT', onSigint);
}

export const listCommand = new Command('list')
  .alias('ls')
  .alias('status')
  .description('List all processes')
  .option('-v, --verbose', 'Show additional details including PIDs')
  .option('-f, --follow', 'Live-update the process table (Ctrl+C to stop)')
  .option('--all-users', 'List processes from all users (requires sudo on Unix)')
  .action(async (options) => {
    if (options.allUsers) {
      // Check for elevated privileges on Unix
      if (process.platform !== 'win32' && !isElevated()) {
        console.error(chalk.red('✗ This command requires elevated privileges'));
        console.error(chalk.red('  Run with: sudo orkify list --all-users'));
        process.exit(1);
      }

      // List processes from all users
      const result = await listAllUsers();

      // Show warnings first
      for (const warning of result.warnings) {
        console.log(chalk.yellow(`⚠ ${warning}`));
      }

      if (result.users.length === 0 && result.inaccessibleUsers.length === 0) {
        if (result.warnings.length === 0) {
          console.log(chalk.gray('No processes running on this system'));
        }
      } else {
        // Show accessible processes
        let totalProcesses = 0;
        for (const userList of result.users) {
          if (userList.processes.length > 0) {
            totalProcesses += userList.processes.length;
            renderProcessTable(userList.processes, {
              showUser: userList.user,
              verbose: options.verbose,
            });
          }
        }

        if (totalProcesses === 0 && result.inaccessibleUsers.length === 0) {
          console.log(chalk.gray('No processes running'));
        }
      }

      // Show errors at the end (important - results may be incomplete)
      if (result.inaccessibleUsers.length > 0) {
        console.log('');
        console.error(
          chalk.red(`✗ Could not access processes for: ${result.inaccessibleUsers.join(', ')}`)
        );
        process.exit(1);
      }

      return;
    }

    // Follow mode — live-updating table
    if (options.follow) {
      await followList(options.verbose ?? false);
      daemonClient.disconnect();
      return;
    }

    // Normal single-user list
    try {
      const response = await daemonClient.request(IPCMessageType.LIST);

      if (response.success) {
        const processes = response.data as ProcessInfo[];

        if (processes.length === 0) {
          console.log(chalk.gray('No processes running'));
          return;
        }

        renderProcessTable(processes, { verbose: options.verbose });
      } else {
        console.error(chalk.red(`✗ Failed to list: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('ECONNREFUSED') || message.includes('ENOENT')) {
        console.log(chalk.gray('No processes running (daemon not started)'));
      } else {
        console.error(chalk.red(`✗ Error: ${message}`));
        process.exit(1);
      }
    } finally {
      daemonClient.disconnect();
    }
  });
