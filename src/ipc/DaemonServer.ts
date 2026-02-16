import { unlinkSync, existsSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { SOCKET_PATH, IPCMessageType } from '../constants.js';
import type { IPCRequest, IPCResponse } from '../types/index.js';
import { createResponse, serialize, createMessageParser } from './protocol.js';

export type RequestHandler = (
  request: IPCRequest,
  client: ClientConnection
) => Promise<IPCResponse> | IPCResponse;

export class ClientConnection {
  private socket: Socket;
  private messageParser = createMessageParser();

  constructor(socket: Socket) {
    this.socket = socket;
  }

  send(message: IPCResponse): void {
    if (!this.socket.destroyed) {
      this.socket.write(serialize(message));
    }
  }

  onData(handler: (messages: IPCRequest[]) => void): void {
    this.socket.on('data', (chunk) => {
      const messages = this.messageParser(chunk);
      handler(messages as IPCRequest[]);
    });
  }

  onClose(handler: () => void): void {
    this.socket.on('close', handler);
  }

  onError(handler: (err: Error) => void): void {
    this.socket.on('error', handler);
  }

  close(): void {
    this.socket.end();
  }
}

export class DaemonServer {
  private server: Server | null = null;
  private clients = new Set<ClientConnection>();
  private handlers = new Map<string, RequestHandler>();
  private logSubscribers = new Map<string, Set<{ client: ClientConnection; requestId: string }>>();

  registerHandler(type: string, handler: RequestHandler): void {
    this.handlers.set(type, handler);
  }

  subscribeToLogs(processName: string, client: ClientConnection, requestId: string): void {
    let subscribers = this.logSubscribers.get(processName);
    if (!subscribers) {
      subscribers = new Set();
      this.logSubscribers.set(processName, subscribers);
    }
    subscribers.add({ client, requestId });
  }

  unsubscribeFromLogs(processName: string, client: ClientConnection): void {
    const subscribers = this.logSubscribers.get(processName);
    if (subscribers) {
      for (const sub of subscribers) {
        if (sub.client === client) {
          subscribers.delete(sub);
        }
      }
    }
  }

  broadcastLog(processName: string, data: unknown): void {
    const subscribers = this.logSubscribers.get(processName);
    if (subscribers) {
      for (const { client, requestId } of subscribers) {
        client.send({
          type: IPCMessageType.LOG_DATA,
          id: requestId,
          success: true,
          data,
        });
      }
    }

    // Also broadcast to 'all' subscribers
    const allSubscribers = this.logSubscribers.get('all');
    if (allSubscribers) {
      for (const { client, requestId } of allSubscribers) {
        client.send({
          type: IPCMessageType.LOG_DATA,
          id: requestId,
          success: true,
          data: { processName, ...(data as object) },
        });
      }
    }
  }

  async start(): Promise<void> {
    // Clean up existing socket
    if (existsSync(SOCKET_PATH)) {
      try {
        unlinkSync(SOCKET_PATH);
      } catch {
        // Ignore errors
      }
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        const client = new ClientConnection(socket);
        this.clients.add(client);

        client.onData(async (messages) => {
          for (const request of messages) {
            await this.handleRequest(request, client);
          }
        });

        client.onClose(() => {
          this.clients.delete(client);
          // Clean up log subscriptions
          for (const [name] of this.logSubscribers) {
            this.unsubscribeFromLogs(name, client);
          }
        });

        client.onError((err) => {
          console.error('Client error:', err.message);
        });
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(SOCKET_PATH, () => {
        resolve();
      });
    });
  }

  private async handleRequest(request: IPCRequest, client: ClientConnection): Promise<void> {
    const handler = this.handlers.get(request.type);

    if (!handler) {
      client.send(createResponse(request.id, false, undefined, `Unknown command: ${request.type}`));
      return;
    }

    try {
      const response = await handler(request, client);
      client.send(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      client.send(createResponse(request.id, false, undefined, message));
    }
  }

  broadcast(message: IPCResponse): void {
    for (const client of this.clients) {
      client.send(message);
    }
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();

      if (this.server) {
        this.server.close(() => {
          if (existsSync(SOCKET_PATH)) {
            try {
              unlinkSync(SOCKET_PATH);
            } catch {
              // Ignore
            }
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
