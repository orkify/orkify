import chalk from 'chalk';
import { Command } from 'commander';
import { IPCMessageType } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';

export const killCommand = new Command('kill')
  .description('Kill the ORKIFY daemon')
  .action(async () => {
    try {
      const response = await daemonClient.request(IPCMessageType.KILL_DAEMON);

      if (response.success) {
        console.log(chalk.yellow('⏹ ORKIFY daemon killed'));
      } else {
        console.error(chalk.red(`✗ Failed to kill daemon: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('ECONNREFUSED') || message.includes('ENOENT')) {
        console.log(chalk.gray('Daemon is not running'));
      } else {
        console.error(chalk.red(`✗ Error: ${message}`));
        process.exit(1);
      }
    } finally {
      daemonClient.disconnect();
    }
  });
