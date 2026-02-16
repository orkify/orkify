import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { Command } from 'commander';
import { DAEMON_PID_FILE, IPCMessageType } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';
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

      // Forward the old daemon's telemetry env vars to the new daemon
      daemonClient.setSpawnEnv(daemonEnv);

      // Wait for the old daemon to fully exit before starting a new one.
      // A fixed delay is not enough — on slow CI systems shutdown() can take longer
      // than the delay, causing us to reconnect to the dying daemon instead of a new one.
      const deadline = Date.now() + 10000;
      while (existsSync(DAEMON_PID_FILE) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }

      // 2. Start new daemon and restore processes from in-memory configs
      console.log(chalk.blue('⟳ Starting new daemon and restoring processes...'));
      const resResponse = await daemonClient.request(IPCMessageType.RESTORE_CONFIGS, processes);

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
