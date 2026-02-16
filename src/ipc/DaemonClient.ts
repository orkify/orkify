import { spawn } from 'node:child_process';
import { existsSync, readFileSync, openSync, mkdirSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOCKET_PATH,
  DAEMON_PID_FILE,
  DAEMON_LOG_FILE,
  ORKIFY_HOME,
  IPC_CONNECT_TIMEOUT,
  IPC_RESPONSE_TIMEOUT,
  DAEMON_STARTUP_TIMEOUT,
  IPCMessageType,
} from '../constants.js';
import type { IPCRequest, IPCResponse, IPCMessage } from '../types/index.js';
import { createRequest, serialize, createMessageParser } from './protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DaemonClient {
  private socket: Socket | null = null;
  private messageParser = createMessageParser();
  private pendingRequests = new Map<
    string,
    {
      resolve: (response: IPCResponse) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private streamHandlers = new Map<string, (data: unknown) => void>();
  private spawnEnv: Record<string, string> = {};

  async connect(): Promise<void> {
    if (this.socket) {
      return;
    }

    // Check if daemon is running
    if (!this.isDaemonRunning()) {
      await this.startDaemon();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket?.destroy();
        this.cleanup();
        reject(new Error('Connection timeout'));
      }, IPC_CONNECT_TIMEOUT);

      this.socket = connect(SOCKET_PATH);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket.on('data', (chunk) => {
        const messages = this.messageParser(chunk);
        for (const message of messages) {
          this.handleMessage(message);
        }
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        this.cleanup();
        reject(err);
      });

      this.socket.on('close', () => {
        this.cleanup();
      });
    });
  }

  private isDaemonRunning(): boolean {
    if (!existsSync(SOCKET_PATH)) {
      return false;
    }

    if (existsSync(DAEMON_PID_FILE)) {
      try {
        const pid = parseInt(readFileSync(DAEMON_PID_FILE, 'utf-8').trim(), 10);
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  private async startDaemon(): Promise<void> {
    const daemonScript = join(__dirname, '..', 'daemon', 'index.js');

    if (!existsSync(ORKIFY_HOME)) {
      mkdirSync(ORKIFY_HOME, { recursive: true });
    }
    const logFd = openSync(DAEMON_LOG_FILE, 'a');

    const child = spawn(process.execPath, [daemonScript], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, ...this.spawnEnv },
    });
    this.spawnEnv = {};

    child.unref();

    // Wait for socket to be available
    const startTime = Date.now();
    while (Date.now() - startTime < DAEMON_STARTUP_TIMEOUT) {
      if (existsSync(SOCKET_PATH)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error('Daemon failed to start');
  }

  private handleMessage(message: IPCMessage): void {
    const response = message as IPCResponse;
    const pending = this.pendingRequests.get(response.id);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
      return;
    }

    // Check for stream handlers (for logs)
    const streamHandler = this.streamHandlers.get(response.id);
    if (streamHandler && message.type === IPCMessageType.LOG_DATA) {
      streamHandler(response.data);
    }
  }

  async send(request: IPCRequest): Promise<IPCResponse> {
    const socket = this.socket;
    if (!socket) {
      throw new Error('Not connected to daemon');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error('Request timeout'));
      }, IPC_RESPONSE_TIMEOUT);

      this.pendingRequests.set(request.id, { resolve, reject, timeout });
      socket.write(serialize(request));
    });
  }

  async request(
    type: (typeof IPCMessageType)[keyof typeof IPCMessageType],
    payload?: IPCRequest['payload']
  ): Promise<IPCResponse> {
    await this.connect();
    const request = createRequest(type, payload);
    return this.send(request);
  }

  async streamLogs(
    target: string | number | undefined,
    onData: (data: unknown) => void
  ): Promise<() => void> {
    await this.connect();

    const socket = this.socket;
    if (!socket) {
      throw new Error('Not connected to daemon');
    }

    const request = createRequest(IPCMessageType.LOGS, { target, follow: true });
    this.streamHandlers.set(request.id, onData);

    socket.write(serialize(request));

    return () => {
      this.streamHandlers.delete(request.id);
    };
  }

  private cleanup(): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
    this.streamHandlers.clear();
    this.socket = null;
  }

  setSpawnEnv(env: Record<string, string>): void {
    this.spawnEnv = env;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.cleanup();
    }
  }
}

export const daemonClient = new DaemonClient();
