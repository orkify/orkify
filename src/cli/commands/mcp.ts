import chalk from 'chalk';
import { Command, Option } from 'commander';
import type { McpStatusResponse } from '../../types/index.js';
import { IPCMessageType, MCP_DEFAULT_PORT } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';
import {
  appendKeyToConfig,
  generateToken,
  loadMcpConfig,
  type McpKey,
  TOOL_NAMES,
  warnIfConfigInsecure,
} from '../../mcp/auth.js';
import { startMcpServer } from '../../mcp/server.js';

export const mcpCommand = new Command('mcp')
  .description('Start MCP server for AI tool integration (e.g., Claude Code)')
  .addOption(new Option('--simple-http', 'Use HTTP transport with local key auth'))
  .addOption(new Option('--port <port>', 'HTTP port').default(MCP_DEFAULT_PORT).argParser(Number))
  .addOption(new Option('--bind <address>', 'HTTP bind address').default('127.0.0.1'))
  .addOption(
    new Option(
      '--cors [origin]',
      'Enable CORS ("*" for any origin, a specific URL, or comma-separated URLs)'
    ).preset('*')
  )
  .action(async (opts) => {
    try {
      if (opts.simpleHttp) {
        warnIfConfigInsecure();
        // Delegate to daemon via IPC
        const payload = {
          transport: 'simple-http' as const,
          port: opts.port,
          bind: opts.bind,
          cors: opts.cors,
        };
        const response = await daemonClient.request(IPCMessageType.MCP_START, payload);

        if (!response.success) {
          console.error(chalk.red(`✗ ${response.error}`));
          process.exit(1);
        }

        const data = response.data as {
          started: boolean;
          reason?: string;
          port: number;
          bind: string;
        };
        if (data.started) {
          console.log(
            chalk.green(`✓ MCP HTTP server started on http://${data.bind}:${data.port}/mcp`)
          );
        } else {
          console.log(
            chalk.yellow(`MCP HTTP server already running on http://${data.bind}:${data.port}/mcp`)
          );
        }
      } else {
        warnIfConfigInsecure();
        await startMcpServer();
      }
    } catch (err) {
      // Use stderr for errors (stdout is reserved for MCP protocol)
      console.error('MCP server error:', (err as Error).message);
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });

mcpCommand
  .command('stop')
  .description('Stop the MCP HTTP server')
  .action(async () => {
    try {
      const response = await daemonClient.request(IPCMessageType.MCP_STOP);

      if (!response.success) {
        console.error(chalk.red(`✗ ${response.error}`));
        process.exit(1);
      }

      const data = response.data as { stopped: boolean; reason?: string };
      if (data.stopped) {
        console.log(chalk.green('✓ MCP HTTP server stopped'));
      } else {
        console.log(chalk.yellow('MCP HTTP server is not running'));
      }
    } catch (err) {
      console.error(chalk.red(`✗ ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });

mcpCommand
  .command('status')
  .description('Show MCP HTTP server status')
  .action(async () => {
    try {
      const response = await daemonClient.request(IPCMessageType.MCP_STATUS);

      if (!response.success) {
        console.error(chalk.red(`✗ ${response.error}`));
        process.exit(1);
      }

      const data = response.data as McpStatusResponse;
      if (data.running) {
        console.log(
          chalk.green(
            `MCP server running (${data.transport}) on http://${data.bind}:${data.port}/mcp`
          )
        );
        if (data.cors) console.log(`  CORS: ${data.cors}`);
      } else {
        console.log('MCP HTTP server is not running');
      }
    } catch (err) {
      console.error(chalk.red(`✗ ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });

mcpCommand
  .command('keygen')
  .description('Generate a new MCP API key and add it to ~/.orkify/mcp.yml')
  .option('--name <name>', 'Key name for identification', 'default')
  .option('--tools <tools>', 'Comma-separated list of allowed tools (default: all)')
  .option('--allowed-ips <ips>', 'Comma-separated list of allowed IPs or CIDRs')
  .action((opts) => {
    const tools: string[] = opts.tools ? opts.tools.split(',').map((t: string) => t.trim()) : ['*'];

    // Validate tool names (skip wildcard)
    for (const tool of tools) {
      if (tool !== '*' && !(TOOL_NAMES as readonly string[]).includes(tool)) {
        console.error(`Unknown tool: "${tool}". Valid tools: ${TOOL_NAMES.join(', ')}`);
        process.exit(1);
      }
    }

    // Warn about duplicate names
    try {
      const existing = loadMcpConfig();
      if (existing.keys.some((k) => k.name === opts.name)) {
        console.error(
          `Warning: a key named "${opts.name}" already exists — creating a second entry`
        );
      }
    } catch {
      // Config unreadable — appendKeyToConfig will handle it
    }

    const token = generateToken();
    const key: McpKey = { name: opts.name, token, tools };

    if (opts.allowedIps) {
      key.allowedIps = opts.allowedIps.split(',').map((ip: string) => ip.trim());
    }

    appendKeyToConfig(key);

    // Print token to stdout for piping; info to stderr
    const extras = key.allowedIps ? `, allowedIps: ${key.allowedIps.join(', ')}` : '';
    console.error(`Key "${opts.name}" added to mcp.yml (tools: ${tools.join(', ')}${extras})`);
    console.log(token);
  });
