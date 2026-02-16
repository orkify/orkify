import chalk from 'chalk';
import { Command } from 'commander';
import { IPCMessageType } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';
import type { ProcessInfo, RestorePayload } from '../../types/index.js';

export const restoreCommand = new Command('restore')
  .description('Restore previously saved process list')
  .argument('[file]', 'Path to snapshot file (default: ~/.orkify/snapshot.yml)')
  .action(async (file: string | undefined) => {
    try {
      const payload: RestorePayload = { file };
      const response = await daemonClient.request(IPCMessageType.RESTORE, payload);

      if (response.success) {
        const results = response.data as ProcessInfo[];

        if (results.length === 0) {
          console.log(chalk.gray('No processes to restore'));
          return;
        }

        console.log(chalk.green(`✓ Restored ${results.length} process(es):`));
        for (const info of results) {
          console.log(`  - ${info.name} (${info.workers.length} worker(s))`);
        }
      } else {
        console.error(chalk.red(`✗ Failed to restore: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });
