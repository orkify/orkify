import chalk from 'chalk';
import { Command } from 'commander';
import { IPCMessageType } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';

export const killCommand = new Command('kill')
  .description('Kill the ORKIFY daemon')
  .option('-f, --force', 'Skip graceful shutdown and SIGKILL all processes immediately')
  .action(async (opts: { force?: boolean }) => {
    try {
      const response = await daemonClient.request(IPCMessageType.KILL_DAEMON, {
        force: opts.force === true,
      });

      if (response.success) {
        // Wait for the daemon to close the IPC connection, which happens
        // at the end of graceful shutdown (after PID file cleanup).
        // Without this, callers like systemd may start a new daemon
        // while the old one is still shutting down.
        await daemonClient.waitForClose();
        console.log(chalk.yellow('⏹ ORKIFY daemon killed'));
      } else {
        console.error(chalk.red(`✗ Failed to kill daemon: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('ECONNREFUSED') || message.includes('ENOENT')) {
        console.log(chalk.gray('Daemon is not running'));
      } else if (message.includes('Connection closed')) {
        // Daemon closed the connection during shutdown — expected for force kill
        console.log(chalk.yellow('⏹ ORKIFY daemon killed'));
      } else {
        console.error(chalk.red(`✗ Error: ${message}`));
        process.exit(1);
      }
    } finally {
      daemonClient.disconnect();
    }
  });
