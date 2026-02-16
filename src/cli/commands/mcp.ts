import { Command } from 'commander';
import { startMcpServer } from '../../mcp/server.js';

export const mcpCommand = new Command('mcp')
  .description('Start MCP server for AI tool integration (e.g., Claude Code)')
  .action(async () => {
    try {
      await startMcpServer();
    } catch (err) {
      // Use stderr for errors (stdout is reserved for MCP protocol)
      console.error('MCP server error:', (err as Error).message);
      process.exit(1);
    }
  });
