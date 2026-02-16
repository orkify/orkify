import chalk from 'chalk';
import { Command } from 'commander';
import { IPCMessageType } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';
import type { ProcessInfo, TargetPayload } from '../../types/index.js';

export const downCommand = new Command('down')
  .description('Stop process(es)')
  .argument('<target>', 'Process name, id, or "all"')
  .action(async (target: string) => {
    try {
      const payload: TargetPayload = {
        target: target === 'all' ? 'all' : isNaN(Number(target)) ? target : Number(target),
      };

      const response = await daemonClient.request(IPCMessageType.DOWN, payload);

      if (response.success) {
        const results = response.data as ProcessInfo[];
        for (const info of results) {
          console.log(chalk.yellow(`⏹ Process "${info.name}" stopped`));
        }
        if (results.length === 0) {
          console.log(chalk.gray('No processes to stop'));
        }
      } else {
        console.error(chalk.red(`✗ Failed to stop: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });
