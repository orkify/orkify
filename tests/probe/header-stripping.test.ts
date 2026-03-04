import { fork } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { METRICS_PROBE_IMPORT } from '../../src/constants.js';

describe('header stripping via metrics probe', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-header-strip-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function spawnServer(): Promise<{
    port: number;
    kill: () => void;
    request: (headers: Record<string, string>) => Promise<Record<string, string>>;
  }> {
    return new Promise((resolve, reject) => {
      // Write a test script that echoes back request headers as JSON
      const script = join(tempDir, 'echo-headers.mjs');
      writeFileSync(
        script,
        `
import { createServer } from 'node:http';
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(req.headers));
});
server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  if (process.send) process.send({ type: 'listening', port: addr.port });
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`,
        'utf-8'
      );

      const child = fork(script, [], {
        execArgv: [METRICS_PROBE_IMPORT],
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Server did not start in time'));
      }, 10_000);

      child.on('message', (msg: { type: string; port?: number }) => {
        if (msg && typeof msg === 'object' && 'port' in msg && msg.port) {
          clearTimeout(timeout);
          const port = msg.port;
          resolve({
            port,
            kill: () => child.kill('SIGTERM'),
            request: async (headers: Record<string, string>) => {
              const res = await fetch(`http://127.0.0.1:${port}/`, { headers });
              return (await res.json()) as Record<string, string>;
            },
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  it('probe loads without errors in a forked process', async () => {
    const server = await spawnServer();
    try {
      const headers = await server.request({ 'x-custom': 'hello' });
      expect(headers['x-custom']).toBe('hello');
    } finally {
      server.kill();
    }
  }, 15000);

  it('preserves x-middleware-subrequest from loopback (127.0.0.1)', async () => {
    const server = await spawnServer();
    try {
      // Requests from 127.0.0.1 should NOT have headers stripped
      const headers = await server.request({ 'x-middleware-subrequest': 'test-value' });
      expect(headers['x-middleware-subrequest']).toBe('test-value');
    } finally {
      server.kill();
    }
  }, 15000);

  it('preserves x-now-route-matches from loopback (127.0.0.1)', async () => {
    const server = await spawnServer();
    try {
      const headers = await server.request({ 'x-now-route-matches': 'test-value' });
      expect(headers['x-now-route-matches']).toBe('test-value');
    } finally {
      server.kill();
    }
  }, 15000);

  it('normal headers are never stripped regardless of source', async () => {
    const server = await spawnServer();
    try {
      const headers = await server.request({
        'x-custom': 'keep-me',
        authorization: 'Bearer token',
      });
      expect(headers['x-custom']).toBe('keep-me');
      expect(headers['authorization']).toBe('Bearer token');
    } finally {
      server.kill();
    }
  }, 15000);

  it('server still works normally (non-request events not affected)', async () => {
    const server = await spawnServer();
    try {
      // Multiple sequential requests should all work
      const h1 = await server.request({ 'x-first': '1' });
      const h2 = await server.request({ 'x-second': '2' });
      expect(h1['x-first']).toBe('1');
      expect(h2['x-second']).toBe('2');
    } finally {
      server.kill();
    }
  }, 15000);
});
