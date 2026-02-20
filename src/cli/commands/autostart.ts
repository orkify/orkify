import chalk from 'chalk';
import { Command } from 'commander';

export const autostartCommand = new Command('autostart')
  .alias('boot')
  .description('Configure orkify to start on system boot')
  .action(() => {
    console.log(
      `${chalk.bold('Boot persistence')} requires a one-time systemd (Linux) or launchd (macOS) setup.\n` +
        `\n` +
        `See the guide: ${chalk.cyan('https://github.com/orkify/orkify#boot-persistence')}`
    );
  });
