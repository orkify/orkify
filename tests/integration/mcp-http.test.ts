import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { MCP_TOKEN_PREFIX } from '../../src/constants.js';
import { sleep, orkify, orkifyWithEnv } from './test-utils.js';

const IS_CI = process.env.CI === 'true';

// Test tokens
const FULL_ACCESS_TOKEN = `${MCP_TOKEN_PREFIX}${'aa'.repeat(24)}`;
const READ_ONLY_TOKEN = `${MCP_TOKEN_PREFIX}${'bb'.repeat(24)}`;
const INVALID_TOKEN = `${MCP_TOKEN_PREFIX}${'ff'.repeat(24)}`;

let tmpDir: string;
let port: number;
let testEnv: Record<string, string>;

/**
 * Wait for the HTTP server to start by polling the endpoint.
 */
async function waitForServer(serverPort = port, maxWait = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`http://127.0.0.1:${serverPort}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      // Any response (even 401) means the server is up
      if (res.status > 0) return;
    } catch {
      // Not ready yet
    }
    await sleep(100);
  }
  throw new Error(`MCP HTTP server not ready after ${maxWait}ms`);
}

/**
 * Find an available TCP port.
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createNetServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const p = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(p));
    });
  });
}

/**
 * Make an MCP JSON-RPC request to the HTTP server.
 */
async function mcpRequest(
  method: string,
  params: Record<string, unknown> = {},
  token?: string,
  sessionId?: string
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });
}

/**
 * Parse a response that may be JSON or SSE.
 * SSE responses contain "event: message\ndata: {...}\n\n" blocks.
 */
async function parseResponse(res: Response): Promise<Record<string, unknown>> {
  const contentType = res.headers.get('content-type') || '';
  const body = await res.text();

  if (contentType.includes('text/event-stream')) {
    // Parse SSE: extract data lines from message events
    const lines = body.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        try {
          return JSON.parse(data);
        } catch {
          // continue to next data line
        }
      }
    }
    throw new Error(`No valid JSON-RPC message found in SSE response: ${body}`);
  }

  return JSON.parse(body);
}

/**
 * Helper to run orkify commands with our test HOME.
 */
function orkifyTest(args: string, timeout = 30000): string {
  return orkifyWithEnv(args, { HOME: tmpDir }, timeout);
}

describe('MCP HTTP Server', () => {
  beforeAll(async () => {
    // Kill any existing daemon
    if (!IS_CI) {
      orkify('kill');
    }

    // Create temp config at tmpDir/.orkify/mcp.yml (since HOME=tmpDir)
    tmpDir = mkdtempSync(join(tmpdir(), 'orkify-mcp-http-test-'));
    const orkifyHome = join(tmpDir, '.orkify');
    mkdirSync(orkifyHome, { recursive: true });
    const configPath = join(orkifyHome, 'mcp.yml');
    writeFileSync(
      configPath,
      stringifyYaml({
        keys: [
          { name: 'full-access', token: FULL_ACCESS_TOKEN, tools: ['*'] },
          { name: 'read-only', token: READ_ONLY_TOKEN, tools: ['list', 'logs'] },
        ],
      })
    );

    // Find an available port
    port = await findFreePort();
    testEnv = { HOME: tmpDir };

    // Start the MCP HTTP server via daemon IPC
    orkifyWithEnv(`mcp --simple-http --port ${port} --bind 127.0.0.1`, testEnv);

    // Wait for server to be ready
    await waitForServer();
  }, 15000);

  afterAll(async () => {
    // Stop MCP and kill daemon
    try {
      orkifyWithEnv('mcp stop', testEnv);
    } catch {
      // ignore
    }

    if (!IS_CI) {
      orkify('down all');
      orkify('kill');
    }

    try {
      orkifyWithEnv('kill', testEnv);
    } catch {
      // ignore
    }

    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Authentication', () => {
    it('rejects requests without auth header (401)', async () => {
      const res = await mcpRequest('initialize');
      expect(res.status).toBe(401);
    });

    it('rejects requests with invalid token (401)', async () => {
      const res = await mcpRequest('initialize', {}, INVALID_TOKEN);
      expect(res.status).toBe(401);
    });

    it('accepts requests with valid full-access token', async () => {
      const res = await mcpRequest(
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
        FULL_ACCESS_TOKEN
      );
      // Should be 200 (success) — the init response
      expect(res.status).toBe(200);
    });

    it('accepts requests with valid read-only token', async () => {
      const res = await mcpRequest(
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-readonly', version: '1.0.0' },
        },
        READ_ONLY_TOKEN
      );
      expect(res.status).toBe(200);
    });
  });

  describe('Tool scope enforcement', () => {
    let fullAccessSessionId: string;
    let readOnlySessionId: string;

    beforeAll(async () => {
      // Initialize a full-access session
      const fullRes = await mcpRequest(
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'full-access-client', version: '1.0.0' },
        },
        FULL_ACCESS_TOKEN
      );
      fullAccessSessionId = fullRes.headers.get('mcp-session-id') || '';

      // Send initialized notification
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
        'Mcp-Session-Id': fullAccessSessionId,
      };
      await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });

      // Initialize a read-only session
      const readRes = await mcpRequest(
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'read-only-client', version: '1.0.0' },
        },
        READ_ONLY_TOKEN
      );
      readOnlySessionId = readRes.headers.get('mcp-session-id') || '';

      // Send initialized notification
      const readHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${READ_ONLY_TOKEN}`,
        'Mcp-Session-Id': readOnlySessionId,
      };
      await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: readHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });
    });

    it('full-access token can call list tool', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
          'Mcp-Session-Id': fullAccessSessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'list', arguments: {} },
        }),
      });

      expect(res.status).toBe(200);
      const data = await parseResponse(res);
      const result = data.result as Record<string, unknown> | undefined;
      expect(result?.isError).toBeFalsy();
    });

    it('read-only token can call list tool', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${READ_ONLY_TOKEN}`,
          'Mcp-Session-Id': readOnlySessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'list', arguments: {} },
        }),
      });

      expect(res.status).toBe(200);
      const data = await parseResponse(res);
      const result = data.result as Record<string, unknown> | undefined;
      expect(result?.isError).toBeFalsy();
    });

    it('read-only token gets FORBIDDEN for up tool', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${READ_ONLY_TOKEN}`,
          'Mcp-Session-Id': readOnlySessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'up',
            arguments: { script: '/tmp/test.js' },
          },
        }),
      });

      expect(res.status).toBe(200);
      const data = await parseResponse(res);
      const result = data.result as { isError?: boolean; content?: Array<{ text: string }> };
      expect(result?.isError).toBe(true);
      const errorText = result?.content?.[0]?.text || '';
      const parsed = JSON.parse(errorText);
      expect(parsed.error).toBe('FORBIDDEN');
    });

    it('read-only token gets FORBIDDEN for down tool', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${READ_ONLY_TOKEN}`,
          'Mcp-Session-Id': readOnlySessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: { name: 'down', arguments: { target: 'test' } },
        }),
      });

      expect(res.status).toBe(200);
      const data = await parseResponse(res);
      const result = data.result as { isError?: boolean; content?: Array<{ text: string }> };
      expect(result?.isError).toBe(true);
      const errorText = result?.content?.[0]?.text || '';
      const parsed = JSON.parse(errorText);
      expect(parsed.error).toBe('FORBIDDEN');
    });
  });

  describe('HTTP method routing', () => {
    it('DELETE /mcp terminates session and returns 200', async () => {
      // Create a session first
      const initRes = await mcpRequest(
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'delete-test', version: '1.0.0' },
        },
        FULL_ACCESS_TOKEN
      );
      expect(initRes.status).toBe(200);
      const sessionId = initRes.headers.get('mcp-session-id') || '';
      expect(sessionId).toBeTruthy();

      // DELETE the session
      const deleteRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
          'Mcp-Session-Id': sessionId,
        },
      });
      expect(deleteRes.status).toBe(200);

      // Subsequent POST to the same session should create a new session (old one gone)
      const postRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
          'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'delete-test-2', version: '1.0.0' },
          },
        }),
      });
      // The old session ID won't be found, so a new session is created
      expect(postRes.status).toBe(200);
      const newSessionId = postRes.headers.get('mcp-session-id') || '';
      expect(newSessionId).not.toBe(sessionId);
    });

    it('GET /mcp without session ID returns 400', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
          Accept: 'text/event-stream',
        },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Missing Mcp-Session-Id header');
    });

    it('GET /mcp with unknown session ID returns 404', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
          Accept: 'text/event-stream',
          'Mcp-Session-Id': 'nonexistent-session-id',
        },
      });
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Unknown session');
    });
  });

  describe('Session-auth binding', () => {
    it('rejects a different token from using an existing session (POST)', async () => {
      // Create a session with the full-access token
      const initRes = await mcpRequest(
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'binding-test', version: '1.0.0' },
        },
        FULL_ACCESS_TOKEN
      );
      expect(initRes.status).toBe(200);
      const sessionId = initRes.headers.get('mcp-session-id') || '';
      expect(sessionId).toBeTruthy();

      // Try to use that session with the read-only token — should be rejected
      const hijackRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${READ_ONLY_TOKEN}`,
          'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 99,
          method: 'tools/call',
          params: { name: 'list', arguments: {} },
        }),
      });

      expect(hijackRes.status).toBe(403);
      const data = await hijackRes.json();
      expect(data.error).toBe('Session belongs to a different key');
    });

    it('rejects a different token from using an existing session (GET)', async () => {
      // Create a session with the full-access token
      const initRes = await mcpRequest(
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'binding-get-test', version: '1.0.0' },
        },
        FULL_ACCESS_TOKEN
      );
      expect(initRes.status).toBe(200);
      const sessionId = initRes.headers.get('mcp-session-id') || '';

      // Try GET with the read-only token
      const hijackRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${READ_ONLY_TOKEN}`,
          Accept: 'text/event-stream',
          'Mcp-Session-Id': sessionId,
        },
      });

      expect(hijackRes.status).toBe(403);
      const data = await hijackRes.json();
      expect(data.error).toBe('Session belongs to a different key');
    });

    it('rejects a different token from deleting an existing session', async () => {
      // Create a session with the full-access token
      const initRes = await mcpRequest(
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'binding-delete-test', version: '1.0.0' },
        },
        FULL_ACCESS_TOKEN
      );
      expect(initRes.status).toBe(200);
      const sessionId = initRes.headers.get('mcp-session-id') || '';

      // Try DELETE with the read-only token
      const hijackRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${READ_ONLY_TOKEN}`,
          'Mcp-Session-Id': sessionId,
        },
      });

      expect(hijackRes.status).toBe(403);
      const data = await hijackRes.json();
      expect(data.error).toBe('Session belongs to a different key');
    });

    it('allows the original token to continue using its session', async () => {
      // Create a session with the full-access token
      const initRes = await mcpRequest(
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'binding-owner-test', version: '1.0.0' },
        },
        FULL_ACCESS_TOKEN
      );
      expect(initRes.status).toBe(200);
      const sessionId = initRes.headers.get('mcp-session-id') || '';

      // Send initialized notification
      await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
          'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });

      // Same token calling a tool on its own session — should succeed
      const toolRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
          'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 100,
          method: 'tools/call',
          params: { name: 'list', arguments: {} },
        }),
      });

      expect(toolRes.status).toBe(200);
      const data = await parseResponse(toolRes);
      const result = data.result as Record<string, unknown> | undefined;
      expect(result?.isError).toBeFalsy();
    });
  });

  describe('MCP stop and status', () => {
    it('mcp status reports running', () => {
      const output = orkifyTest('mcp status');
      expect(output).toContain('running');
      expect(output).toContain(String(port));
    });

    it('mcp stop stops the server', async () => {
      const output = orkifyTest('mcp stop');
      expect(output).toContain('stopped');

      // Port should be freed
      await sleep(200);
      const portFree = await new Promise<boolean>((resolve) => {
        const srv = createNetServer();
        srv.once('error', () => resolve(false));
        srv.listen(port, '127.0.0.1', () => {
          srv.close(() => resolve(true));
        });
      });
      expect(portFree).toBe(true);

      // Status should show not running
      const statusOutput = orkifyTest('mcp status');
      expect(statusOutput).toContain('not running');

      // Restart for remaining tests
      orkifyWithEnv(`mcp --simple-http --port ${port} --bind 127.0.0.1`, testEnv);
      await waitForServer();
    });
  });

  describe('kill stops MCP', () => {
    it('orkify kill frees the MCP port', async () => {
      // Start a fresh MCP server on a new port for this test
      const killTestPort = await findFreePort();
      orkifyWithEnv(`mcp --simple-http --port ${killTestPort} --bind 127.0.0.1`, testEnv);
      await waitForServer(killTestPort);

      // Kill the daemon
      orkifyWithEnv('kill', testEnv);
      await sleep(500);

      // Port should be freed
      const portFree = await new Promise<boolean>((resolve) => {
        const srv = createNetServer();
        srv.once('error', () => resolve(false));
        srv.listen(killTestPort, '127.0.0.1', () => {
          srv.close(() => resolve(true));
        });
      });
      expect(portFree).toBe(true);

      // Restart daemon and MCP for other tests
      orkifyWithEnv(`mcp --simple-http --port ${port} --bind 127.0.0.1`, testEnv);
      await waitForServer();
    });
  });

  describe('snap and restore preserves MCP', () => {
    it('snap → kill → restore brings MCP back', async () => {
      const snapPort = await findFreePort();

      // Start MCP on a dedicated port (restarts daemon)
      orkifyWithEnv('kill', testEnv);
      await sleep(300);
      orkifyWithEnv(`mcp --simple-http --port ${snapPort} --bind 127.0.0.1`, testEnv);
      await waitForServer(snapPort);

      // Snap current state (includes MCP options)
      orkifyWithEnv('snap', testEnv);

      // Kill daemon — MCP port should be freed
      orkifyWithEnv('kill', testEnv);
      await sleep(500);

      // Restore — should bring MCP back
      orkifyWithEnv('restore', testEnv);
      await waitForServer(snapPort);

      // Verify MCP is responding
      const res = await fetch(`http://127.0.0.1:${snapPort}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBeGreaterThan(0);

      // Clean up and restart the main test MCP server
      orkifyWithEnv('kill', testEnv);
      await sleep(300);
      orkifyWithEnv(`mcp --simple-http --port ${port} --bind 127.0.0.1`, testEnv);
      await waitForServer();
    });
  });

  describe('idempotent and double start', () => {
    it('double start with same options is idempotent', () => {
      // MCP is already running on `port` — start again with same options
      const output = orkifyTest(`mcp --simple-http --port ${port} --bind 127.0.0.1`);
      expect(output).toContain('already running');
    });

    it('double start with different port restarts on new port', async () => {
      const newPort = await findFreePort();
      const output = orkifyTest(`mcp --simple-http --port ${newPort} --bind 127.0.0.1`);
      expect(output).toContain('started');

      // New port should be serving
      await waitForServer(newPort);

      // Old port should be freed
      const oldPortFree = await new Promise<boolean>((resolve) => {
        const srv = createNetServer();
        srv.once('error', () => resolve(false));
        srv.listen(port, '127.0.0.1', () => {
          srv.close(() => resolve(true));
        });
      });
      expect(oldPortFree).toBe(true);

      // Restore original port for remaining tests
      orkifyTest(`mcp --simple-http --port ${port} --bind 127.0.0.1`);
      await waitForServer();
    });
  });

  describe('stop when not running', () => {
    it('mcp stop when not running returns not-running message', async () => {
      // Stop first to ensure it's not running
      orkifyTest('mcp stop');
      await sleep(200);

      // Stop again — should not error
      const output = orkifyTest('mcp stop');
      expect(output).toContain('not running');

      // Restart for remaining tests
      orkifyWithEnv(`mcp --simple-http --port ${port} --bind 127.0.0.1`, testEnv);
      await waitForServer();
    });
  });

  describe('port conflict', () => {
    it('returns error when port is already in use', async () => {
      // Bind a TCP server to a port
      const conflictPort = await findFreePort();
      const blockingServer = createNetServer();
      await new Promise<void>((resolve) => {
        blockingServer.listen(conflictPort, '127.0.0.1', resolve);
      });

      try {
        // Try to start MCP on that port — should fail
        const output = orkifyTest(`mcp --simple-http --port ${conflictPort} --bind 127.0.0.1`);
        // Should contain an error about the port being in use
        expect(output.toLowerCase()).toMatch(/eaddrinuse|address already in use|error/);
      } finally {
        await new Promise<void>((resolve) => blockingServer.close(() => resolve()));
      }

      // Original MCP should still be running
      const status = orkifyTest('mcp status');
      expect(status).toContain('running');
    });
  });
});

/**
 * Start an isolated MCP HTTP server via daemon with custom flags.
 * Returns the port and temp dir for cleanup.
 */
async function startIsolatedServer(
  extraArgs: string[] = [],
  customKeys?: Array<{ name: string; token: string; tools: string[]; allowedIps?: string[] }>
): Promise<{ serverPort: number; dir: string; env: Record<string, string> }> {
  const dir = mkdtempSync(join(tmpdir(), 'orkify-mcp-isolated-'));
  const home = join(dir, '.orkify');
  mkdirSync(home, { recursive: true });
  const keys = customKeys ?? [{ name: 'test', token: FULL_ACCESS_TOKEN, tools: ['*'] }];
  writeFileSync(join(home, 'mcp.yml'), stringifyYaml({ keys }));

  const serverPort = await findFreePort();
  const env = { HOME: dir };
  const quotedArgs = extraArgs.map((a) => (a.includes('*') ? `'${a}'` : a)).join(' ');
  orkifyWithEnv(`mcp --simple-http --port ${serverPort} --bind 127.0.0.1 ${quotedArgs}`, env);

  await waitForServer(serverPort);
  return { serverPort, dir, env };
}

/**
 * Stop an isolated server and clean up its temp dir.
 */
async function stopIsolatedServer(dir: string, env: Record<string, string>): Promise<void> {
  try {
    orkifyWithEnv('mcp stop', env);
  } catch {
    // ignore
  }
  try {
    orkifyWithEnv('kill', env);
  } catch {
    // ignore
  }
  await sleep(300);
  rmSync(dir, { recursive: true, force: true });
}

describe('MCP HTTP graceful shutdown', () => {
  it('mcp stop frees the port', async () => {
    const { serverPort, dir, env } = await startIsolatedServer();

    try {
      // Create a session so there's state to clean up
      await fetch(`http://127.0.0.1:${serverPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'shutdown-test', version: '1.0.0' },
          },
        }),
      });

      // Stop via CLI
      orkifyWithEnv('mcp stop', env);
      await sleep(300);

      // Verify port is freed — we can bind to it again
      const portFree = await new Promise<boolean>((resolve) => {
        const srv = createNetServer();
        srv.once('error', () => resolve(false));
        srv.listen(serverPort, '127.0.0.1', () => {
          srv.close(() => resolve(true));
        });
      });
      expect(portFree).toBe(true);
    } finally {
      await stopIsolatedServer(dir, env);
    }
  }, 15000);
});

describe('MCP HTTP CORS', () => {
  describe('--cors "*"', () => {
    let corsPort: number;
    let dir: string;
    let env: Record<string, string>;

    beforeAll(async () => {
      ({ serverPort: corsPort, dir, env } = await startIsolatedServer(['--cors', '*']));
    }, 15000);

    afterAll(async () => {
      await stopIsolatedServer(dir, env);
    });

    it('sets Access-Control-Allow-Origin: * on responses', async () => {
      const res = await fetch(`http://127.0.0.1:${corsPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'cors-test', version: '1.0.0' },
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-expose-headers')).toBe('Mcp-Session-Id');
      // Wildcard origin should not add Origin to Vary
      expect(res.headers.get('vary') ?? '').not.toContain('Origin');
    });

    it('handles OPTIONS preflight with 204', async () => {
      const res = await fetch(`http://127.0.0.1:${corsPort}/mcp`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
      expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
      expect(res.headers.get('access-control-max-age')).toBe('86400');
    });
  });

  describe('--cors <specific origin>', () => {
    let corsPort: number;
    let dir: string;
    let env: Record<string, string>;
    const ORIGIN = 'https://dashboard.example.com';

    beforeAll(async () => {
      ({ serverPort: corsPort, dir, env } = await startIsolatedServer(['--cors', ORIGIN]));
    }, 15000);

    afterAll(async () => {
      await stopIsolatedServer(dir, env);
    });

    it('sets Access-Control-Allow-Origin to the specific origin', async () => {
      const res = await fetch(`http://127.0.0.1:${corsPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'cors-origin-test', version: '1.0.0' },
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      // Specific origin should set Vary: Origin for correct caching
      expect(res.headers.get('vary')).toContain('Origin');
    });

    it('OPTIONS preflight returns specific origin', async () => {
      const res = await fetch(`http://127.0.0.1:${corsPort}/mcp`, {
        method: 'OPTIONS',
        headers: {
          Origin: ORIGIN,
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    });
  });

  it('does not set CORS headers when --cors is not used', async () => {
    const { serverPort: noCorsPort, dir, env } = await startIsolatedServer();
    try {
      const res = await fetch(`http://127.0.0.1:${noCorsPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'no-cors-test', version: '1.0.0' },
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await stopIsolatedServer(dir, env);
    }
  }, 15000);

  describe('--cors with multiple origins', () => {
    let corsPort: number;
    let dir: string;
    let env: Record<string, string>;

    beforeAll(async () => {
      ({
        serverPort: corsPort,
        dir,
        env,
      } = await startIsolatedServer(['--cors', 'https://app1.com,https://app2.com']));
    }, 15000);

    afterAll(async () => {
      await stopIsolatedServer(dir, env);
    });

    it('echoes matching origin (app1)', async () => {
      const res = await fetch(`http://127.0.0.1:${corsPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
          Origin: 'https://app1.com',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'multi-cors-1', version: '1.0.0' },
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app1.com');
      expect(res.headers.get('vary')).toContain('Origin');
    });

    it('echoes matching origin (app2)', async () => {
      const res = await fetch(`http://127.0.0.1:${corsPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
          Origin: 'https://app2.com',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'multi-cors-2', version: '1.0.0' },
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app2.com');
    });

    it('omits ACAO header for non-matching origin', async () => {
      const res = await fetch(`http://127.0.0.1:${corsPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
          Origin: 'https://evil.com',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'multi-cors-evil', version: '1.0.0' },
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('OPTIONS preflight with matching origin returns 204 with CORS headers', async () => {
      const res = await fetch(`http://127.0.0.1:${corsPort}/mcp`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app1.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app1.com');
      expect(res.headers.get('access-control-max-age')).toBe('86400');
    });

    it('OPTIONS preflight with non-matching origin returns 204 without ACAO', async () => {
      const res = await fetch(`http://127.0.0.1:${corsPort}/mcp`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});

describe('MCP HTTP IP allowlisting', () => {
  it('allows requests from localhost when allowedIps includes 127.0.0.1', async () => {
    const {
      serverPort: ipPort,
      dir,
      env,
    } = await startIsolatedServer(
      [],
      [{ name: 'local-only', token: FULL_ACCESS_TOKEN, tools: ['*'], allowedIps: ['127.0.0.1'] }]
    );

    try {
      const res = await fetch(`http://127.0.0.1:${ipPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'ip-allow-test', version: '1.0.0' },
          },
        }),
      });

      expect(res.status).toBe(200);
    } finally {
      await stopIsolatedServer(dir, env);
    }
  }, 15000);

  it('rejects requests from localhost when allowedIps excludes it', async () => {
    const {
      serverPort: ipPort,
      dir,
      env,
    } = await startIsolatedServer(
      [],
      [
        {
          name: 'remote-only',
          token: FULL_ACCESS_TOKEN,
          tools: ['*'],
          allowedIps: ['192.168.99.99'],
        },
      ]
    );

    try {
      const res = await fetch(`http://127.0.0.1:${ipPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${FULL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'ip-deny-test', version: '1.0.0' },
          },
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('IP address not allowed for this key');
    } finally {
      await stopIsolatedServer(dir, env);
    }
  }, 15000);
});
