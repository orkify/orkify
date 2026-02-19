import chalk from 'chalk';
import { Command } from 'commander';
import type { ProcessInfo, TargetPayload } from '../../types/index.js';
import { IPCMessageType } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';

export const deleteCommand = new Command('delete')
  .alias('rm')
  .description('Stop and remove process(es) from list')
  .argument('<target>', 'Process name, id, or "all"')
  .action(async (target: string) => {
    try {
      const payload: TargetPayload = {
        target: target === 'all' ? 'all' : isNaN(Number(target)) ? target : Number(target),
      };

      const response = await daemonClient.request(IPCMessageType.DELETE, payload);

      if (response.success) {
        const results = response.data as ProcessInfo[];
        for (const info of results) {
          console.log(chalk.red(`✗ Process "${info.name}" deleted`));
        }
        if (results.length === 0) {
          console.log(chalk.gray('No processes to delete'));
        }
      } else {
        console.error(chalk.red(`✗ Failed to delete: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });
