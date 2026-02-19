import chalk from 'chalk';
import { Command } from 'commander';
import type { TargetPayload } from '../../types/index.js';
import { IPCMessageType } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';

export const flushCommand = new Command('flush')
  .description('Truncate log files and remove rotated archives')
  .argument('[target]', 'Process name or id (default: all)', 'all')
  .action(async (target: string) => {
    try {
      const payload: TargetPayload = { target };

      const response = await daemonClient.request(IPCMessageType.FLUSH, payload);

      if (response.success) {
        console.log(
          chalk.green(`✓ Logs flushed for ${target === 'all' ? 'all processes' : `"${target}"`}`)
        );
      } else {
        console.error(chalk.red(`✗ Failed to flush logs: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });
