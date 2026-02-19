import { describe, expect, it } from 'vitest';
import { IPCMessageType } from '../../src/constants.js';
import {
  createMessageParser,
  createRequest,
  createResponse,
  serialize,
} from '../../src/ipc/protocol.js';

describe('IPC Protocol', () => {
  describe('createRequest', () => {
    it('creates a request with type and id', () => {
      const request = createRequest(IPCMessageType.UP, { script: 'app.js' });

      expect(request.type).toBe(IPCMessageType.UP);
      expect(request.id).toBeDefined();
      expect(typeof request.id).toBe('string');
      expect(request.payload).toEqual({ script: 'app.js' });
    });

    it('creates a request without payload', () => {
      const request = createRequest(IPCMessageType.LIST);

      expect(request.type).toBe(IPCMessageType.LIST);
      expect(request.id).toBeDefined();
      expect(request.payload).toBeUndefined();
    });

    it('generates unique IDs for each request', () => {
      const request1 = createRequest(IPCMessageType.PING);
      const request2 = createRequest(IPCMessageType.PING);

      expect(request1.id).not.toBe(request2.id);
    });
  });

  describe('createResponse', () => {
    it('creates a success response', () => {
      const response = createResponse('test-id', true, { status: 'ok' });

      expect(response.type).toBe(IPCMessageType.SUCCESS);
      expect(response.id).toBe('test-id');
      expect(response.success).toBe(true);
      expect(response.data).toEqual({ status: 'ok' });
      expect(response.error).toBeUndefined();
    });

    it('creates an error response', () => {
      const response = createResponse('test-id', false, undefined, 'Something went wrong');

      expect(response.type).toBe(IPCMessageType.ERROR);
      expect(response.id).toBe('test-id');
      expect(response.success).toBe(false);
      expect(response.data).toBeUndefined();
      expect(response.error).toBe('Something went wrong');
    });
  });

  describe('serialize', () => {
    it('serializes a message to JSON with newline delimiter', () => {
      const message = { type: IPCMessageType.PING, id: 'test-id' };
      const serialized = serialize(message);

      expect(serialized).toBe('{"type":"ping","id":"test-id"}\n');
    });
  });

  describe('createMessageParser', () => {
    it('parses a single complete message', () => {
      const parser = createMessageParser();
      const messages = parser(Buffer.from('{"type":"ping","id":"1"}\n'));

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'ping', id: '1' });
    });

    it('parses multiple messages in one chunk', () => {
      const parser = createMessageParser();
      const messages = parser(Buffer.from('{"type":"ping","id":"1"}\n{"type":"pong","id":"2"}\n'));

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ type: 'ping', id: '1' });
      expect(messages[1]).toEqual({ type: 'pong', id: '2' });
    });

    it('handles partial messages across chunks', () => {
      const parser = createMessageParser();

      const messages1 = parser(Buffer.from('{"type":"ping",'));
      expect(messages1).toHaveLength(0);

      const messages2 = parser(Buffer.from('"id":"1"}\n'));
      expect(messages2).toHaveLength(1);
      expect(messages2[0]).toEqual({ type: 'ping', id: '1' });
    });

    it('handles empty chunks', () => {
      const parser = createMessageParser();
      const messages = parser(Buffer.from(''));

      expect(messages).toHaveLength(0);
    });

    it('handles messages with no trailing newline', () => {
      const parser = createMessageParser();

      const messages1 = parser(Buffer.from('{"type":"ping","id":"1"}'));
      expect(messages1).toHaveLength(0);

      const messages2 = parser(Buffer.from('\n'));
      expect(messages2).toHaveLength(1);
    });
  });
});
