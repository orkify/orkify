import chalk from 'chalk';
import { Command } from 'commander';
import type { SnapPayload } from '../../types/index.js';
import { IPCMessageType, SNAPSHOT_FILE } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';

export const snapCommand = new Command('snap')
  .description('Snapshot current process list for later restoration')
  .argument('[file]', 'Path to snapshot file (default: ~/.orkify/snapshot.yml)')
  .option('--no-env', 'Do not save environment variables in snapshot file')
  .action(async (file: string | undefined, options: { env: boolean }) => {
    try {
      const payload: SnapPayload = { noEnv: !options.env, file };
      const response = await daemonClient.request(IPCMessageType.SNAP, payload);

      if (response.success) {
        console.log(chalk.green(`✓ Snapshot saved`));
        console.log(chalk.gray(`  File: ${file || SNAPSHOT_FILE}`));
      } else {
        console.error(chalk.red(`✗ Failed to save snapshot: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });
