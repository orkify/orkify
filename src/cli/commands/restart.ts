import chalk from 'chalk';
import { Command } from 'commander';
import type { ProcessInfo, TargetPayload } from '../../types/index.js';
import { IPCMessageType } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';
import { formatProcessTable } from './list.js';

export const restartCommand = new Command('restart')
  .description('Restart process(es) - hard restart (kill + start)')
  .argument('<target>', 'Process name, id, or "all"')
  .action(async (target: string) => {
    try {
      const payload: TargetPayload = {
        target: target === 'all' ? 'all' : isNaN(Number(target)) ? target : Number(target),
      };

      const response = await daemonClient.request(IPCMessageType.RESTART, payload);

      if (response.success) {
        const results = response.data as ProcessInfo[];
        if (results.length === 0) {
          console.log(chalk.gray('No processes to restart'));
        } else {
          for (const info of results) {
            console.log(chalk.green(`↻ Process "${info.name}" restarted`));
          }

          const listResponse = await daemonClient.request(IPCMessageType.LIST);
          if (listResponse.success) {
            console.log(formatProcessTable(listResponse.data as ProcessInfo[]));
          }
        }
      } else {
        console.error(chalk.red(`✗ Failed to restart: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });
