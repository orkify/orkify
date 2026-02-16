import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { connect } from 'node:net';
import { platform } from 'node:os';
import { IPC_CONNECT_TIMEOUT, IPC_RESPONSE_TIMEOUT, IPCMessageType } from '../constants.js';
import type { ProcessInfo, IPCResponse } from '../types/index.js';
import { createRequest, serialize, createMessageParser } from './protocol.js';

export interface UserProcessList {
  user: string;
  processes: ProcessInfo[];
  error?: string;
}

export interface ListAllUsersResult {
  users: UserProcessList[];
  /** Informational messages (e.g., no sockets found) */
  warnings: string[];
  /** Users whose sockets couldn't be accessed (permission denied) */
  inaccessibleUsers: string[];
}

/**
 * Check if running with elevated privileges
 */
function isElevated(): boolean {
  if (platform() === 'win32') {
    // On Windows, check if we can access a protected location
    try {
      execSync('net session', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
  // Unix: check if running as root
  return process.getuid?.() === 0;
}

/**
 * Extract username from socket path
 */
function extractUserFromSocketPath(socketPath: string): string {
  // Unix: /home/username/.orkify/orkify.sock or /Users/username/.orkify/orkify.sock
  // Also handles /root/.orkify/orkify.sock
  const match = socketPath.match(/^\/(?:home|Users|root)\/([^/]+)\/\.orkify\/orkify\.sock$/);
  if (match) {
    return match[1];
  }
  // Handle /root specifically
  if (socketPath === '/root/.orkify/orkify.sock') {
    return 'root';
  }
  // Fallback: use directory name
  const parts = socketPath.split('/');
  const orkifyIndex = parts.indexOf('.orkify');
  if (orkifyIndex > 0) {
    return parts[orkifyIndex - 1];
  }
  return 'unknown';
}

/**
 * Discover orkify sockets on Unix using lsof
 * Requires elevated privileges to see other users' sockets
 */
function discoverUnixSockets(): Array<{ user: string; socketPath: string }> {
  try {
    // lsof -U lists all Unix domain sockets
    // We filter for orkify.sock
    const output = execSync('lsof -U 2>/dev/null', {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const sockets: Array<{ user: string; socketPath: string }> = [];
    const seen = new Set<string>();

    for (const line of output.split('\n')) {
      // Look for lines containing orkify.sock
      if (line.includes('orkify.sock')) {
        // lsof output format varies, but socket path is typically at the end
        const match = line.match(/(\/\S+orkify\.sock)/);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          sockets.push({
            user: extractUserFromSocketPath(match[1]),
            socketPath: match[1],
          });
        }
      }
    }

    return sockets;
  } catch {
    return [];
  }
}

/**
 * Discover orkify named pipes on Windows
 */
function discoverWindowsPipes(): Array<{ user: string; socketPath: string }> {
  try {
    // Named pipes are enumerable in \\.\pipe\
    const pipes = readdirSync('\\\\.\\pipe');
    return pipes
      .filter((name) => name.startsWith('orkify-'))
      .map((name) => ({
        user: name.replace('orkify-', ''),
        socketPath: `\\\\.\\pipe\\${name}`,
      }));
  } catch {
    return [];
  }
}

/**
 * Connect to a socket and get the process list
 */
async function getProcessListFromSocket(
  socketPath: string
): Promise<{ processes: ProcessInfo[] } | { error: string }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ error: 'Connection timeout' });
    }, IPC_CONNECT_TIMEOUT);

    const socket = connect(socketPath);
    const messageParser = createMessageParser();

    socket.on('connect', () => {
      clearTimeout(timeout);

      const responseTimeout = setTimeout(() => {
        socket.destroy();
        resolve({ error: 'Response timeout' });
      }, IPC_RESPONSE_TIMEOUT);

      const request = createRequest(IPCMessageType.LIST);
      socket.write(serialize(request));

      socket.on('data', (chunk) => {
        const messages = messageParser(chunk);
        for (const message of messages) {
          clearTimeout(responseTimeout);
          const response = message as IPCResponse;
          socket.end();
          if (response.success) {
            resolve({ processes: response.data as ProcessInfo[] });
          } else {
            resolve({ error: response.error || 'Unknown error' });
          }
          return;
        }
      });
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      socket.destroy();

      const errorCode = (err as NodeJS.ErrnoException).code;
      if (errorCode === 'EACCES' || errorCode === 'EPERM') {
        resolve({ error: 'Permission denied' });
      } else if (errorCode === 'ECONNREFUSED') {
        resolve({ error: 'Daemon not running' });
      } else if (errorCode === 'ENOENT') {
        resolve({ error: 'Socket not found' });
      } else {
        resolve({ error: err.message });
      }
    });
  });
}

/**
 * List processes from all users on the system
 * On Unix, requires elevated privileges (sudo) to see other users' processes
 */
export async function listAllUsers(): Promise<ListAllUsersResult> {
  const os = platform();
  const users: UserProcessList[] = [];
  const warnings: string[] = [];
  const inaccessibleUsers: string[] = [];

  // Check elevation on Unix
  if (os !== 'win32' && !isElevated()) {
    return {
      users: [],
      warnings: [],
      inaccessibleUsers: [],
    };
  }

  // Discover sockets
  const sockets = os === 'win32' ? discoverWindowsPipes() : discoverUnixSockets();

  if (sockets.length === 0) {
    warnings.push('No orkify processes found on this system');
    return { users, warnings, inaccessibleUsers };
  }

  // Connect to each socket and get process list
  for (const { user, socketPath } of sockets) {
    const result = await getProcessListFromSocket(socketPath);

    if ('error' in result) {
      if (result.error === 'Permission denied') {
        inaccessibleUsers.push(user);
      } else if (result.error !== 'Socket not found' && result.error !== 'Daemon not running') {
        warnings.push(`Cannot access ${user}'s processes: ${result.error}`);
      }
      // Skip users with no running daemon (not an error)
    } else {
      users.push({
        user,
        processes: result.processes,
      });
    }
  }

  if (users.length === 0 && warnings.length === 0 && inaccessibleUsers.length === 0) {
    warnings.push('No orkify daemons running on this system');
  }

  return { users, warnings, inaccessibleUsers };
}

/**
 * Check if the current user has elevated privileges
 */
export { isElevated };
