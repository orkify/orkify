import chalk from 'chalk';
import { Command } from 'commander';
import type { McpStartPayload, ProcessConfig, ProcessInfo } from '../../types/index.js';
import { IPCMessageType } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';
import { restoreDaemon } from '../../ipc/restoreDaemon.js';

export const daemonReloadCommand = new Command('daemon-reload')
  .description('Reload the daemon to pick up new code')
  .action(async () => {
    try {
      // 1. Kill the daemon and capture its state (env vars + process configs + MCP)
      console.log(chalk.blue('⟳ Stopping daemon...'));
      let daemonEnv: Record<string, string> = {};
      let processes: ProcessConfig[] = [];
      let savedMcpOptions: McpStartPayload | undefined;
      try {
        const killResponse = await daemonClient.request(IPCMessageType.KILL_DAEMON);
        const data = killResponse.data as {
          env?: Record<string, string>;
          processes?: ProcessConfig[];
          mcpOptions?: McpStartPayload;
        };
        if (data?.env) daemonEnv = data.env;
        if (data?.processes) processes = data.processes;
        if (data?.mcpOptions) savedMcpOptions = data.mcpOptions;
      } catch {
        // Connection close is expected when daemon shuts down
      }
      daemonClient.disconnect();

      // 2. Start new daemon and restore processes from in-memory configs
      console.log(chalk.blue('⟳ Starting new daemon and restoring processes...'));
      const resResponse = await restoreDaemon(daemonClient, processes, daemonEnv);

      if (resResponse.success) {
        const results = resResponse.data as ProcessInfo[];

        if (results.length === 0) {
          console.log(chalk.green('✓ Daemon reloaded (no processes to restore)'));
        } else {
          console.log(chalk.green(`✓ Daemon reloaded, restored ${results.length} process(es):`));
          for (const info of results) {
            console.log(`  - ${info.name} (${info.workers.length} worker(s))`);
          }
        }
      } else {
        console.error(chalk.red(`✗ Daemon restarted but failed to restore: ${resResponse.error}`));
        process.exit(1);
      }

      // 3. Restore MCP HTTP server if it was running
      if (savedMcpOptions) {
        try {
          const mcpResponse = await daemonClient.request(IPCMessageType.MCP_START, savedMcpOptions);
          if (mcpResponse.success) {
            console.log(
              chalk.green(
                `✓ MCP HTTP server restored on http://${savedMcpOptions.bind}:${savedMcpOptions.port}/mcp`
              )
            );
          } else {
            console.error(chalk.red(`✗ Failed to restore MCP server: ${mcpResponse.error}`));
          }
        } catch (err) {
          console.error(chalk.red(`✗ MCP restore error: ${(err as Error).message}`));
        }
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });
