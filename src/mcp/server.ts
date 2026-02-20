import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import type {
  LogsPayload,
  ProcessInfo,
  RestorePayload,
  SnapPayload,
  TargetPayload,
  UpPayload,
} from '../types/index.js';
import { IPCMessageType } from '../constants.js';
import { DaemonClient } from '../ipc/DaemonClient.js';
import { isElevated, listAllUsers } from '../ipc/MultiUserClient.js';

// Shared IPC client for all MCP sessions. DaemonClient is stateless per-request,
// so concurrent tool calls from different sessions safely share a single instance.
const mcpDaemonClient = new DaemonClient();

/**
 * Format error response for AI consumption
 */
function formatError(
  error: string,
  code?: string,
  context?: Record<string, unknown>
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error: code || 'ERROR',
          message: error,
          ...context,
        }),
      },
    ],
    isError: true,
  };
}

/**
 * Format success response for AI consumption
 */
function formatSuccess(data: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: false;
} {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Parse workers option (same logic as CLI)
 */
function parseWorkers(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }
  if (value === 0) {
    return cpus().length;
  }
  if (value < 0) {
    return Math.max(1, cpus().length + value);
  }
  return value;
}

/**
 * Check if a tool is accessible given the current auth context.
 * - No authInfo (stdio mode): always allowed
 * - Scopes include "*": all tools allowed
 * - Otherwise: tool name must be in scopes
 */
export function checkToolAccess(
  toolName: string,
  authInfo?: AuthInfo
): { allowed: false; error: ReturnType<typeof formatError> } | { allowed: true } {
  if (!authInfo) return { allowed: true }; // stdio mode — no auth
  if (authInfo.scopes.includes('*')) return { allowed: true };
  if (authInfo.scopes.includes(toolName)) return { allowed: true };
  return {
    allowed: false,
    error: formatError(
      `Token "${authInfo.clientId}" does not have access to "${toolName}"`,
      'FORBIDDEN'
    ),
  };
}

/**
 * Create and configure the MCP server with all ORKIFY tools.
 * When authInfo is provided (HTTP mode), per-tool scope checks are enforced.
 */
export function createMcpServer(options?: { authInfo?: AuthInfo }): McpServer {
  const { authInfo } = options ?? {};

  const server = new McpServer({
    name: 'orkify',
    version: '1.0.0',
  });

  // Tool: list - List all managed processes
  server.tool(
    'list',
    'List all managed processes with their status, workers, memory, and CPU usage',
    {},
    async () => {
      const access = checkToolAccess('list', authInfo);
      if (!access.allowed) return access.error;
      try {
        const response = await mcpDaemonClient.request(IPCMessageType.LIST);
        if (response.success) {
          const processes = response.data as ProcessInfo[];
          if (processes.length === 0) {
            return formatSuccess({ processes: [], message: 'No processes running' });
          }
          return formatSuccess(processes);
        }
        return formatError(response.error || 'Failed to list processes', 'LIST_FAILED');
      } catch (err) {
        return formatError((err as Error).message, 'CONNECTION_ERROR');
      }
    }
  );

  // Tool: up - Start a new process
  server.tool(
    'up',
    'Start a new managed process in daemon mode',
    {
      script: z.string().describe('Path to the script file to run'),
      name: z.string().optional().describe('Process name (defaults to script basename)'),
      workers: z
        .number()
        .optional()
        .describe('Number of workers (0 = CPU cores, negative = CPUs minus value)'),
      watch: z.boolean().optional().describe('Watch for file changes and auto-reload'),
      cwd: z.string().optional().describe('Working directory for the process'),
      sticky: z.boolean().optional().describe('Enable sticky sessions for Socket.IO/WebSocket'),
      port: z
        .number()
        .optional()
        .describe('Port for sticky session routing (required with sticky)'),
      nodeArgs: z
        .array(z.string())
        .optional()
        .describe('Node.js arguments (e.g., ["--inspect", "--max-old-space-size=4096"])'),
      args: z.array(z.string()).optional().describe('Script arguments'),
      healthCheck: z
        .string()
        .optional()
        .describe('Health check endpoint path (e.g. /health). Requires port to be set.'),
    },
    async (params) => {
      const access = checkToolAccess('up', authInfo);
      if (!access.allowed) return access.error;
      try {
        const cwd = params.cwd || process.cwd();
        const payload: UpPayload = {
          script: resolve(cwd, params.script),
          name: params.name,
          workers: parseWorkers(params.workers),
          watch: params.watch || false,
          cwd,
          sticky: params.sticky || false,
          port: params.port,
          nodeArgs: params.nodeArgs || [],
          args: params.args || [],
          healthCheck: params.healthCheck,
        };

        const response = await mcpDaemonClient.request(IPCMessageType.UP, payload);
        if (response.success) {
          const info = response.data as ProcessInfo;
          return formatSuccess({
            message: `Process "${info.name}" started successfully`,
            process: info,
          });
        }
        return formatError(response.error || 'Failed to start process', 'START_FAILED');
      } catch (err) {
        return formatError((err as Error).message, 'CONNECTION_ERROR');
      }
    }
  );

  // Tool: down - Stop process(es)
  server.tool(
    'down',
    'Stop a running process by name, numeric ID, or "all" to stop all processes',
    {
      target: z.string().describe('Process name, numeric ID, or "all"'),
    },
    async (params) => {
      const access = checkToolAccess('down', authInfo);
      if (!access.allowed) return access.error;
      try {
        const payload: TargetPayload = { target: params.target };
        const response = await mcpDaemonClient.request(IPCMessageType.DOWN, payload);
        if (response.success) {
          return formatSuccess({
            message: `Successfully stopped: ${params.target}`,
            data: response.data,
          });
        }
        return formatError(response.error || 'Failed to stop process', 'STOP_FAILED', {
          target: params.target,
        });
      } catch (err) {
        return formatError((err as Error).message, 'CONNECTION_ERROR');
      }
    }
  );

  // Tool: restart - Hard restart (stop + start)
  server.tool(
    'restart',
    'Hard restart a process (stops then starts). For zero-downtime, use reload instead.',
    {
      target: z.string().describe('Process name, numeric ID, or "all"'),
    },
    async (params) => {
      const access = checkToolAccess('restart', authInfo);
      if (!access.allowed) return access.error;
      try {
        const payload: TargetPayload = { target: params.target };
        const response = await mcpDaemonClient.request(IPCMessageType.RESTART, payload);
        if (response.success) {
          return formatSuccess({
            message: `Successfully restarted: ${params.target}`,
            data: response.data,
          });
        }
        return formatError(response.error || 'Failed to restart process', 'RESTART_FAILED', {
          target: params.target,
        });
      } catch (err) {
        return formatError((err as Error).message, 'CONNECTION_ERROR');
      }
    }
  );

  // Tool: reload - Zero-downtime rolling reload
  server.tool(
    'reload',
    'Zero-downtime rolling reload for cluster mode processes. Spawns new workers before killing old ones.',
    {
      target: z.string().describe('Process name, numeric ID, or "all"'),
    },
    async (params) => {
      const access = checkToolAccess('reload', authInfo);
      if (!access.allowed) return access.error;
      try {
        const payload: TargetPayload = { target: params.target };
        const response = await mcpDaemonClient.request(IPCMessageType.RELOAD, payload);
        if (response.success) {
          return formatSuccess({
            message: `Successfully reloaded: ${params.target}`,
            data: response.data,
          });
        }
        return formatError(response.error || 'Failed to reload process', 'RELOAD_FAILED', {
          target: params.target,
        });
      } catch (err) {
        return formatError((err as Error).message, 'CONNECTION_ERROR');
      }
    }
  );

  // Tool: delete - Stop and remove from list
  server.tool(
    'delete',
    'Stop and remove a process from the managed list',
    {
      target: z.string().describe('Process name, numeric ID, or "all"'),
    },
    async (params) => {
      const access = checkToolAccess('delete', authInfo);
      if (!access.allowed) return access.error;
      try {
        const payload: TargetPayload = { target: params.target };
        const response = await mcpDaemonClient.request(IPCMessageType.DELETE, payload);
        if (response.success) {
          return formatSuccess({
            message: `Successfully deleted: ${params.target}`,
            data: response.data,
          });
        }
        return formatError(response.error || 'Failed to delete process', 'DELETE_FAILED', {
          target: params.target,
        });
      } catch (err) {
        return formatError((err as Error).message, 'CONNECTION_ERROR');
      }
    }
  );

  // Tool: logs - Get recent log lines
  server.tool(
    'logs',
    'Get recent log lines from a process or all processes',
    {
      target: z.string().optional().describe('Process name or ID (optional, defaults to all)'),
      lines: z.number().optional().describe('Number of lines to retrieve (default: 100)'),
    },
    async (params) => {
      const access = checkToolAccess('logs', authInfo);
      if (!access.allowed) return access.error;
      try {
        const payload: LogsPayload = {
          target: params.target,
          lines: params.lines || 100,
          follow: false,
        };
        const response = await mcpDaemonClient.request(IPCMessageType.LOGS, payload);
        if (response.success) {
          const data = response.data as { logs?: Array<{ file: string; lines: string[] }> };
          if (data.logs && data.logs.length > 0) {
            const output = data.logs.map((f) => f.lines.join('\n')).join('\n');
            return formatSuccess(output);
          }
          return formatSuccess({ message: 'No logs found' });
        }
        return formatError(response.error || 'Failed to get logs', 'LOGS_FAILED', {
          target: params.target,
        });
      } catch (err) {
        return formatError((err as Error).message, 'CONNECTION_ERROR');
      }
    }
  );

  // Tool: snap - Snapshot process list to disk
  server.tool(
    'snap',
    'Snapshot the current process list to disk for later restoration with restore',
    {
      noEnv: z
        .boolean()
        .optional()
        .describe(
          'Do not save environment variables in snapshot file. Processes restored via restore will inherit the daemon environment instead.'
        ),
      file: z
        .string()
        .optional()
        .describe('Path to snapshot file (default: ~/.orkify/snapshot.yml)'),
    },
    async (params) => {
      const access = checkToolAccess('snap', authInfo);
      if (!access.allowed) return access.error;
      try {
        const payload: SnapPayload = { noEnv: params.noEnv, file: params.file };
        const response = await mcpDaemonClient.request(IPCMessageType.SNAP, payload);
        if (response.success) {
          return formatSuccess({
            message: 'Snapshot saved successfully',
            data: response.data,
          });
        }
        return formatError(response.error || 'Failed to save snapshot', 'SNAP_FAILED');
      } catch (err) {
        return formatError((err as Error).message, 'CONNECTION_ERROR');
      }
    }
  );

  // Tool: restore - Restore saved processes
  server.tool(
    'restore',
    'Restore previously saved processes from a snapshot file',
    {
      file: z
        .string()
        .optional()
        .describe('Path to snapshot file (default: ~/.orkify/snapshot.yml)'),
    },
    async (params) => {
      const access = checkToolAccess('restore', authInfo);
      if (!access.allowed) return access.error;
      try {
        const payload: RestorePayload = { file: params.file };
        const response = await mcpDaemonClient.request(IPCMessageType.RESTORE, payload);
        if (response.success) {
          return formatSuccess({
            message: 'Processes restored successfully',
            data: response.data,
          });
        }
        return formatError(response.error || 'Failed to restore processes', 'RESTORE_FAILED');
      } catch (err) {
        return formatError((err as Error).message, 'CONNECTION_ERROR');
      }
    }
  );

  // Tool: listAllUsers - List processes from all users on the system
  server.tool(
    'listAllUsers',
    'List processes from all users on the system. Requires elevated privileges (sudo) on Unix.',
    {},
    async () => {
      const access = checkToolAccess('listAllUsers', authInfo);
      if (!access.allowed) return access.error;
      try {
        // Check for elevated privileges on Unix
        if (process.platform !== 'win32' && !isElevated()) {
          return formatError(
            'This command requires elevated privileges. Run the MCP server with sudo.',
            'ELEVATION_REQUIRED'
          );
        }

        const result = await listAllUsers();

        const response = {
          users: result.users,
          warnings: result.warnings,
          inaccessibleUsers: result.inaccessibleUsers,
          totalProcesses: result.users.reduce((sum, u) => sum + u.processes.length, 0),
        };

        if (result.inaccessibleUsers.length > 0) {
          return formatSuccess({
            ...response,
            incomplete: true,
            error: `Could not access some users' processes: ${result.inaccessibleUsers.join(', ')}`,
          });
        }

        if (result.users.length === 0) {
          return formatSuccess({
            ...response,
            message: 'No orkify processes running on this system.',
          });
        }

        return formatSuccess(response);
      } catch (err) {
        return formatError((err as Error).message, 'LIST_ALL_USERS_FAILED');
      }
    }
  );

  // Tool: kill - Stop the daemon
  server.tool(
    'kill',
    'Stop the ORKIFY daemon process. All managed processes will be stopped.',
    {},
    async () => {
      const access = checkToolAccess('kill', authInfo);
      if (!access.allowed) return access.error;
      try {
        const response = await mcpDaemonClient.request(IPCMessageType.KILL_DAEMON);
        if (response.success) {
          return formatSuccess({
            message: 'Daemon stopped successfully',
          });
        }
        return formatError(response.error || 'Failed to stop daemon', 'KILL_FAILED');
      } catch (err) {
        // Connection error is expected when daemon shuts down
        if ((err as Error).message.includes('Connection closed')) {
          return formatSuccess({
            message: 'Daemon stopped successfully',
          });
        }
        return formatError((err as Error).message, 'CONNECTION_ERROR');
      }
    }
  );

  return server;
}

/**
 * Start the MCP server with stdio transport
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
