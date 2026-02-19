import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { connect, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IPCMessage, IPCRequest, IPCResponse } from '../types/index.js';
import {
  DAEMON_LOCK_FILE,
  DAEMON_LOG_FILE,
  DAEMON_PID_FILE,
  DAEMON_STARTUP_TIMEOUT,
  IPC_CONNECT_TIMEOUT,
  IPC_RESPONSE_TIMEOUT,
  IPCMessageType,
  ORKIFY_HOME,
  SOCKET_PATH,
  TELEMETRY_DEFAULT_API_HOST,
} from '../constants.js';
import { createMessageParser, createRequest, serialize } from './protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DaemonClient {
  private socket: null | Socket = null;
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
    const daemonAlreadyRunning = this.isDaemonRunning();
    if (!daemonAlreadyRunning) {
      await this.startDaemon();
    }

    await new Promise<void>((resolve, reject) => {
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

    // If we connected to an already-running daemon and the CLI has
    // ORKIFY_API_KEY, push the telemetry config so the daemon can
    // enable telemetry even if it started without it.
    if (daemonAlreadyRunning && process.env.ORKIFY_API_KEY) {
      this.configureTelemetry();
    }
  }

  private configureTelemetry(): void {
    if (!this.socket) return;
    const req = createRequest(IPCMessageType.CONFIGURE_TELEMETRY, {
      apiKey: process.env.ORKIFY_API_KEY as string,
      apiHost: process.env.ORKIFY_API_HOST || TELEMETRY_DEFAULT_API_HOST,
    });
    // Fire-and-forget — don't block the caller waiting for a response
    this.socket.write(serialize(req));
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

  /**
   * Attempt to acquire an exclusive lock for daemon startup.
   * Uses O_EXCL for atomic create-if-not-exists.
   * Returns true if lock acquired, false if another process holds it.
   */
  private acquireLock(): boolean {
    try {
      const fd = openSync(DAEMON_LOCK_FILE, 'wx');
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch {
      // Lock file exists — check if holder is still alive
      try {
        const holderPid = parseInt(readFileSync(DAEMON_LOCK_FILE, 'utf-8').trim(), 10);
        process.kill(holderPid, 0); // throws if dead
        return false; // holder is alive
      } catch {
        // Holder is dead — take over stale lock
        try {
          unlinkSync(DAEMON_LOCK_FILE);
          const fd = openSync(DAEMON_LOCK_FILE, 'wx');
          writeFileSync(fd, String(process.pid));
          closeSync(fd);
          return true;
        } catch {
          return false; // race with another takeover
        }
      }
    }
  }

  private releaseLock(): void {
    try {
      unlinkSync(DAEMON_LOCK_FILE);
    } catch {
      // Ignore — may already be cleaned up
    }
  }

  private async startDaemon(): Promise<void> {
    if (!existsSync(ORKIFY_HOME)) {
      mkdirSync(ORKIFY_HOME, { recursive: true });
    }

    if (!this.acquireLock()) {
      // Another process is spawning the daemon — wait for socket instead
      const startTime = Date.now();
      while (Date.now() - startTime < DAEMON_STARTUP_TIMEOUT) {
        if (existsSync(SOCKET_PATH)) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Daemon failed to start (waited for lock holder)');
    }

    try {
      const daemonScript = join(__dirname, '..', 'daemon', 'index.js');
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
    } finally {
      this.releaseLock();
    }
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
    target: number | string | undefined,
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
