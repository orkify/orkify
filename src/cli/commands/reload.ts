import chalk from 'chalk';
import { Command } from 'commander';
import { IPCMessageType } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';
import type { ProcessInfo, TargetPayload } from '../../types/index.js';

export const reloadCommand = new Command('reload')
  .description('Zero-downtime reload - rolling restart of workers')
  .argument('<target>', 'Process name, id, or "all"')
  .action(async (target: string) => {
    try {
      const payload: TargetPayload = {
        target: target === 'all' ? 'all' : isNaN(Number(target)) ? target : Number(target),
      };

      console.log(chalk.blue(`⟳ Starting graceful reload...`));

      const response = await daemonClient.request(IPCMessageType.RELOAD, payload);

      if (response.success) {
        const results = response.data as ProcessInfo[];
        for (const info of results) {
          const staleWorkers = info.workers.filter((w) => w.stale);
          if (staleWorkers.length > 0) {
            console.log(chalk.yellow(`⚠ Process "${info.name}" reload partially failed`));
            console.log(`  Workers: ${info.workers.length}`);
            console.log(
              chalk.yellow(
                `  Stale workers: ${staleWorkers.map((w) => w.id).join(', ')} (old code still running)`
              )
            );
          } else if (info.execMode === 'fork') {
            console.log(chalk.green(`✓ Process "${info.name}" restarted`));
            console.log(
              chalk.dim(`  Fork mode does not support zero-downtime reload — performed a restart`)
            );
            console.log(`  Workers: ${info.workers.length}`);
          } else {
            console.log(chalk.green(`✓ Process "${info.name}" reloaded`));
            console.log(`  Workers: ${info.workers.length}`);
          }
        }
        if (results.length === 0) {
          console.error(chalk.red(`✗ Process not found`));
          process.exit(1);
        }
      } else {
        console.error(chalk.red(`✗ Failed to reload: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });
