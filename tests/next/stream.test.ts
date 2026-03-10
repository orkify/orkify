import { describe, expect, it } from 'vitest';
import { bufferToStream, streamToBuffer } from '../../packages/next/src/stream.js';

describe('stream utilities', () => {
  it('round-trips a single-chunk stream', async () => {
    const original = Buffer.from('hello world');
    const stream = bufferToStream(original);
    const result = await streamToBuffer(stream);
    expect(result.equals(original)).toBe(true);
  });

  it('round-trips a multi-chunk stream', async () => {
    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8, 9]),
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });

    const buffer = await streamToBuffer(stream);
    expect(buffer).toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]));

    // Convert back and verify
    const backStream = bufferToStream(buffer);
    const backBuffer = await streamToBuffer(backStream);
    expect(backBuffer.equals(buffer)).toBe(true);
  });

  it('handles empty stream', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    const buffer = await streamToBuffer(stream);
    expect(buffer.length).toBe(0);
  });

  it('handles empty Buffer', async () => {
    const stream = bufferToStream(Buffer.alloc(0));
    const buffer = await streamToBuffer(stream);
    expect(buffer.length).toBe(0);
  });

  it('handles large payload (1 MB+)', async () => {
    const size = 1024 * 1024 + 42; // 1 MB + 42 bytes
    const original = Buffer.alloc(size, 0xab);
    const stream = bufferToStream(original);
    const result = await streamToBuffer(stream);
    expect(result.length).toBe(size);
    expect(result.equals(original)).toBe(true);
  });
});
