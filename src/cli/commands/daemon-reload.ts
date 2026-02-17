import chalk from 'chalk';
import { Command } from 'commander';
import { IPCMessageType } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';
import { restoreDaemon } from '../../ipc/restoreDaemon.js';
import type { ProcessConfig, ProcessInfo } from '../../types/index.js';

export const daemonReloadCommand = new Command('daemon-reload')
  .description('Reload the daemon to pick up new code')
  .action(async () => {
    try {
      // 1. Kill the daemon and capture its state (env vars + process configs)
      console.log(chalk.blue('⟳ Stopping daemon...'));
      let daemonEnv: Record<string, string> = {};
      let processes: ProcessConfig[] = [];
      try {
        const killResponse = await daemonClient.request(IPCMessageType.KILL_DAEMON);
        const data = killResponse.data as {
          env?: Record<string, string>;
          processes?: ProcessConfig[];
        };
        if (data?.env) daemonEnv = data.env;
        if (data?.processes) processes = data.processes;
      } catch {
        // Connection close is expected when daemon shuts down
      }
      daemonClient.disconnect();

      // 2. Start new daemon and restore processes from in-memory configs
      console.log(chalk.blue('⟳ Starting new daemon and restoring processes...'));
      const resResponse = await restoreDaemon(daemonClient, processes, daemonEnv);

      if (resResponse.success) {
        const results = resResponse.data as ProcessInfo[];

        if (results.length === 0) {
          console.log(chalk.green('✓ Daemon reloaded (no processes to restore)'));
        } else {
          console.log(chalk.green(`✓ Daemon reloaded, restored ${results.length} process(es):`));
          for (const info of results) {
            console.log(`  - ${info.name} (${info.workers.length} worker(s))`);
          }
        }
      } else {
        console.error(chalk.red(`✗ Daemon restarted but failed to restore: ${resResponse.error}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });
