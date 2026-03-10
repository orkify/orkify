import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let POST: (request: Request) => Promise<Response>;

// Mock process.send
const mockSend = vi.fn();

beforeAll(async () => {
  // Set up process.send mock
  vi.stubGlobal('process', { ...process, send: mockSend, cwd: process.cwd });

  const mod = await import('../../packages/next/src/error-handler.js');
  POST = mod.POST;
});

beforeEach(() => {
  mockSend.mockClear();
});

function makeRequest(
  body: unknown,
  overrides?: {
    origin?: null | string;
    host?: string;
    forwardedHost?: string;
    contentLength?: string;
  }
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // Default: same-origin (browser always sends Origin on POST)
  const origin =
    overrides?.origin === null ? undefined : (overrides?.origin ?? 'http://localhost:3000');
  if (origin) headers['Origin'] = origin;
  const host = overrides?.host ?? 'localhost:3000';
  if (host) headers['Host'] = host;
  if (overrides?.forwardedHost) headers['X-Forwarded-Host'] = overrides.forwardedHost;
  if (overrides?.contentLength) headers['Content-Length'] = overrides.contentLength;

  return new Request('http://localhost:3000/orkify/errors', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function validPayload(overrides?: Record<string, unknown>) {
  return {
    name: 'TypeError',
    message: 'Cannot read properties of undefined',
    stack: '    at handleClick (http://localhost:3000/_next/static/chunks/app/page.js:42:15)',
    errorType: 'browser:error',
    url: 'http://localhost:3000/dashboard',
    userAgent: 'Mozilla/5.0',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('POST handler', () => {
  describe('origin validation', () => {
    it('rejects missing origin with 403', async () => {
      const res = await POST(makeRequest(validPayload(), { origin: null }));
      expect(res.status).toBe(403);
    });

    it('rejects mismatched origin', async () => {
      const res = await POST(
        makeRequest(validPayload(), {
          origin: 'http://evil.com',
          host: 'localhost:3000',
        })
      );
      expect(res.status).toBe(403);
    });

    it('accepts matching origin', async () => {
      const res = await POST(
        makeRequest(validPayload(), {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
        })
      );
      expect(res.status).toBe(200);
    });

    it('accepts X-Forwarded-Host behind reverse proxy', async () => {
      // Behind nginx/Cloudflare: Host is internal, X-Forwarded-Host is public
      const res = await POST(
        makeRequest(validPayload(), {
          origin: 'https://app.example.com',
          host: '127.0.0.1:3000',
          forwardedHost: 'app.example.com',
        })
      );
      expect(res.status).toBe(200);
    });

    it('rejects mismatched X-Forwarded-Host', async () => {
      const res = await POST(
        makeRequest(validPayload(), {
          origin: 'http://evil.com',
          host: '127.0.0.1:3000',
          forwardedHost: 'app.example.com',
        })
      );
      expect(res.status).toBe(403);
    });
  });

  describe('payload validation', () => {
    it('rejects oversized Content-Length', async () => {
      const res = await POST(makeRequest(validPayload(), { contentLength: '100000' }));
      expect(res.status).toBe(413);
    });

    it('rejects invalid JSON', async () => {
      const req = new Request('http://localhost:3000/orkify/errors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          Host: 'localhost:3000',
        },
        body: 'not json',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('rejects missing required fields', async () => {
      const res = await POST(makeRequest({ name: 'Error' }));
      expect(res.status).toBe(400);
    });

    it('rejects invalid errorType', async () => {
      const res = await POST(makeRequest(validPayload({ errorType: 'uncaughtException' })));
      expect(res.status).toBe(400);
    });
  });

  describe('IPC relay', () => {
    it('calls process.send with correct __orkify format', async () => {
      const payload = validPayload();
      const res = await POST(makeRequest(payload));

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean };
      expect(json.ok).toBe(true);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const sent = mockSend.mock.calls[0][0] as Record<string, unknown>;
      expect(sent.__orkify).toBe(true);
      expect(sent.type).toBe('error');

      const data = sent.data as Record<string, unknown>;
      expect(data.errorType).toBe('browser:error');
      expect(data.name).toBe('TypeError');
      expect(data.message).toBe('Cannot read properties of undefined');
      expect(data.url).toBe('http://localhost:3000/dashboard');
      expect(data.userAgent).toBe('Mozilla/5.0');
      expect(data.fingerprint).toBe(''); // Daemon recomputes
    });

    it('returns ok when process.send throws', async () => {
      mockSend.mockImplementationOnce(() => {
        throw new Error('IPC broken');
      });
      const res = await POST(makeRequest(validPayload()));
      expect(res.status).toBe(200);
    });
  });

  describe('response', () => {
    it('never reflects input data', async () => {
      const res = await POST(makeRequest(validPayload()));
      const json = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(json)).toEqual(['ok']);
      expect(json.ok).toBe(true);
    });
  });
});

// Rate limit test uses a unique IP to avoid interference from prior tests.
// The rate limiter keys by IP; X-Forwarded-For sets a custom IP.
describe('rate limiting', () => {
  it('allows up to 10 requests then rejects with 429', async () => {
    const uniqueIp = `10.99.99.${Math.floor(Math.random() * 255)}`;

    function makeRateLimitRequest() {
      const body = JSON.stringify(validPayload());
      return new Request('http://localhost:3000/orkify/errors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          Host: 'localhost:3000',
          'X-Forwarded-For': uniqueIp,
        },
        body,
      });
    }

    for (let i = 0; i < 10; i++) {
      const res = await POST(makeRateLimitRequest());
      expect(res.status).toBe(200);
    }
    // 11th request should be rate limited
    const res = await POST(makeRateLimitRequest());
    expect(res.status).toBe(429);
  });
});
