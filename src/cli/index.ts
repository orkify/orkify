#!/usr/bin/env node

import { Command } from 'commander';
import { autostartCommand } from './commands/autostart.js';
import { crashTestCommand } from './commands/crash-test.js';
import { daemonReloadCommand } from './commands/daemon-reload.js';
import { deleteCommand } from './commands/delete.js';
import { deployCommand } from './commands/deploy.js';
import { downCommand } from './commands/down.js';
import { flushCommand } from './commands/flush.js';
import { killCommand } from './commands/kill.js';
import { listCommand } from './commands/list.js';
import { logsCommand } from './commands/logs.js';
import { mcpCommand } from './commands/mcp.js';
import { reloadCommand } from './commands/reload.js';
import { restartCommand } from './commands/restart.js';
import { restoreCommand } from './commands/restore.js';
import { runCommand } from './commands/run.js';
import { snapCommand } from './commands/snap.js';
import { upCommand } from './commands/up.js';

const program = new Command();

program
  .name('orkify')
  .description('Modern JS process orchestration and deployment for your own infrastructure')
  .version('1.0.0');

program.addCommand(upCommand);
program.addCommand(downCommand);
program.addCommand(runCommand);
program.addCommand(restartCommand);
program.addCommand(reloadCommand);
program.addCommand(listCommand);
program.addCommand(logsCommand);
program.addCommand(deleteCommand);
program.addCommand(flushCommand);
program.addCommand(snapCommand);
program.addCommand(restoreCommand);
program.addCommand(killCommand);
program.addCommand(daemonReloadCommand);
program.addCommand(deployCommand);
program.addCommand(mcpCommand);
program.addCommand(autostartCommand);
program.addCommand(crashTestCommand);

program.parse();
