import { randomUUID } from 'node:crypto';
import type { IPCMessage, IPCRequest, IPCResponse } from '../types/index.js';
import { IPCMessageType } from '../constants.js';

const DELIMITER = '\n';

export function createRequest(
  type: (typeof IPCMessageType)[keyof typeof IPCMessageType],
  payload?: IPCRequest['payload']
): IPCRequest {
  return {
    type,
    id: randomUUID(),
    payload,
  };
}

export function createResponse(
  requestId: string,
  success: boolean,
  data?: unknown,
  error?: string
): IPCResponse {
  return {
    type: success ? IPCMessageType.SUCCESS : IPCMessageType.ERROR,
    id: requestId,
    success,
    data,
    error,
  };
}

export function serialize(message: IPCMessage): string {
  return JSON.stringify(message) + DELIMITER;
}

// Max buffer size: 10MB. Prevents unbounded memory growth from
// malformed data that never includes a newline delimiter.
const MAX_BUFFER_SIZE = 10 * 1024 * 1024;

export function createMessageParser(): (chunk: Buffer) => IPCMessage[] {
  let buffer = '';

  return (chunk: Buffer): IPCMessage[] => {
    buffer += chunk.toString();

    // Guard against unbounded buffer growth
    if (buffer.length >= MAX_BUFFER_SIZE) {
      console.error(`IPC message buffer exceeded ${MAX_BUFFER_SIZE} bytes, discarding`);
      buffer = '';
      throw new Error('IPC message buffer overflow');
    }

    const messages: IPCMessage[] = [];
    let delimiterIndex: number;

    while ((delimiterIndex = buffer.indexOf(DELIMITER)) !== -1) {
      const messageStr = buffer.slice(0, delimiterIndex);
      buffer = buffer.slice(delimiterIndex + 1);

      if (messageStr.trim()) {
        try {
          messages.push(JSON.parse(messageStr));
        } catch {
          console.error('Failed to parse IPC message:', messageStr.slice(0, 200));
        }
      }
    }

    return messages;
  };
}
