#!/usr/bin/env node

import { startMcpServer } from './server.js';

startMcpServer().catch((err) => {
  // Use stderr for errors (stdout is reserved for MCP protocol)
  console.error('MCP server error:', err);
  process.exit(1);
});
