import { IPCMessageType } from '../constants.js';
import { DaemonClient } from '../ipc/DaemonClient.js';
import { restoreDaemon } from '../ipc/restoreDaemon.js';
import type { McpStartPayload, ProcessConfig } from '../types/index.js';

async function main() {
  const raw = process.env.ORKIFY_CRASH_RECOVERY;
  if (!raw) process.exit(0);

  const { env, configs, mcpOptions } = JSON.parse(raw) as {
    env: Record<string, string>;
    configs: ProcessConfig[];
    mcpOptions?: McpStartPayload;
  };

  if (env.ORKIFY_API_KEY) process.env.ORKIFY_API_KEY = env.ORKIFY_API_KEY;
  if (env.ORKIFY_API_HOST) process.env.ORKIFY_API_HOST = env.ORKIFY_API_HOST;

  const client = new DaemonClient();
  try {
    const response = await restoreDaemon(client, configs);
    if (response.success) {
      console.log('Crash recovery: processes restored');
    } else {
      console.error('Crash recovery: restore failed:', response.error);
    }

    // Restore MCP HTTP server if it was running
    if (mcpOptions) {
      try {
        const mcpResponse = await client.request(IPCMessageType.MCP_START, mcpOptions);
        if (mcpResponse.success) {
          console.log('Crash recovery: MCP HTTP server restored');
        } else {
          console.error('Crash recovery: MCP restore failed:', mcpResponse.error);
        }
      } catch (err) {
        console.error('Crash recovery: MCP restore error:', (err as Error).message);
      }
    }
  } finally {
    client.disconnect();
  }
}

main().catch((err) => {
  console.error('Crash recovery error:', err);
  process.exit(1);
});
