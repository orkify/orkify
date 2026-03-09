import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration test: browser error payload → handler → process.send IPC message.
 *
 * Verifies the full server-side pipeline without a browser:
 * 1. Construct a browser error payload
 * 2. Call the POST handler (mocked Request)
 * 3. Assert process.send() is called with correct __orkify IPC format
 * 4. Verify the IPC message has the fields the daemon's TelemetryReporter expects
 */

let POST: (request: Request) => Promise<Response>;

const mockSend = vi.fn();

beforeAll(async () => {
  vi.stubGlobal('process', { ...process, send: mockSend, cwd: process.cwd });
  const mod = await import('../../src/next/error-handler.js');
  POST = mod.POST;
});

beforeEach(() => {
  mockSend.mockClear();
});

function makeRequest(body: unknown): Request {
  const json = JSON.stringify(body);
  return new Request('http://localhost:3000/orkify/errors', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(json)),
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
    },
    body: json,
  });
}

const validPayload = {
  name: 'TypeError',
  message: "Cannot read properties of null (reading 'foo')",
  stack: [
    "TypeError: Cannot read properties of null (reading 'foo')",
    '    at handleClick (http://localhost:3000/_next/static/chunks/app/page-abc123.js:42:15)',
    '    at HTMLButtonElement.dispatch (http://localhost:3000/_next/static/chunks/framework-def456.js:100:20)',
  ].join('\n'),
  errorType: 'browser:error' as const,
  url: 'http://localhost:3000/dashboard',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  timestamp: Date.now(),
};

describe('browser error integration', () => {
  it('sends IPC message with __orkify wrapper', async () => {
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(200);

    expect(mockSend).toHaveBeenCalledOnce();
    const msg = mockSend.mock.calls[0][0];
    expect(msg.__orkify).toBe(true);
    expect(msg.type).toBe('error');
  });

  it('IPC data has all fields expected by TelemetryReporter', async () => {
    await POST(makeRequest(validPayload));

    const { data } = mockSend.mock.calls[0][0];

    // Fields the TelemetryReporter reads from err.*
    expect(data).toMatchObject({
      errorType: 'browser:error',
      name: 'TypeError',
      message: expect.stringContaining('Cannot read properties of null'),
      stack: expect.stringContaining('handleClick'),
      fingerprint: '', // Daemon recomputes
      nodeVersion: '',
      pid: 0,
      url: 'http://localhost:3000/dashboard',
      userAgent: expect.stringContaining('Mozilla'),
    });

    // Timestamp should be close to now
    expect(data.timestamp).toBeGreaterThan(Date.now() - 10_000);
  });

  it('IPC data includes topFrame from parsed browser stack', async () => {
    await POST(makeRequest(validPayload));

    const { data } = mockSend.mock.calls[0][0];

    // topFrame should be the first user frame (the handleClick line)
    expect(data.topFrame).not.toBeNull();
    expect(data.topFrame.file).toContain('.next/static/chunks/app/page-abc123.js');
    expect(data.topFrame.line).toBe(42);
    expect(data.topFrame.column).toBe(15);
  });

  it('IPC data has null sourceContext when files do not exist on disk', async () => {
    await POST(makeRequest(validPayload));

    const { data } = mockSend.mock.calls[0][0];

    // The mapped files don't exist on disk, so sourceContext should be null
    expect(data.sourceContext).toBeNull();
  });

  it('handles unhandledRejection errorType', async () => {
    const payload = {
      ...validPayload,
      errorType: 'browser:unhandledRejection',
      name: 'Error',
      message: 'Network request failed',
    };
    const res = await POST(makeRequest(payload));
    expect(res.status).toBe(200);

    const { data } = mockSend.mock.calls[0][0];
    expect(data.errorType).toBe('browser:unhandledRejection');
    expect(data.name).toBe('Error');
  });

  it('IPC data has diagnostics as null for browser errors', async () => {
    await POST(makeRequest(validPayload));

    const { data } = mockSend.mock.calls[0][0];
    expect(data.diagnostics).toBeNull();
  });
});
