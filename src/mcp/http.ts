import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  findKeyByName,
  isIpAllowed,
  LocalConfigVerifier,
  type RemoteConfigVerifier,
  startConfigWatcher,
} from './auth.js';
import { createMcpServer } from './server.js';

export interface HttpOptions {
  port: number;
  bind: string;
  /** Enable CORS — "*" for any origin, a specific origin URL, or comma-separated origins. */
  cors?: string;
  /** Skip registering SIGTERM/SIGINT handlers (used when running inside the daemon). */
  skipSignalHandlers?: boolean;
  /** Custom token verifier — when provided, skips LocalConfigVerifier and local config watcher. */
  tokenVerifier?: OAuthTokenVerifier;
}

export interface McpHttpServer {
  /** Gracefully close all sessions and stop the HTTP server. */
  shutdown(): Promise<void>;
  /** The underlying Node.js HTTP server (for testing). */
  server: Server;
}

// How long a session can be idle before it's reaped (30 minutes)
const SESSION_TTL_MS = 30 * 60 * 1000;
// How often to check for expired sessions (5 minutes)
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export async function startMcpHttpServer(options: HttpOptions): Promise<McpHttpServer> {
  const verifier =
    options.tokenVerifier ??
    (() => {
      startConfigWatcher();
      return new LocalConfigVerifier();
    })();
  const app = express();
  app.use(express.json());

  // CORS middleware — must run before auth so OPTIONS preflights aren't rejected with 401
  if (options.cors) {
    const raw = options.cors;
    const isWildcard = raw === '*';
    const origins = isWildcard ? [] : raw.split(',').map((o) => o.trim());
    const isMulti = origins.length > 1;

    app.use('/mcp', (req, res, next) => {
      if (isWildcard) {
        res.header('Access-Control-Allow-Origin', '*');
      } else if (isMulti) {
        const reqOrigin = req.headers.origin;
        if (reqOrigin && origins.includes(reqOrigin)) {
          res.header('Access-Control-Allow-Origin', reqOrigin);
        }
        res.header('Vary', 'Origin');
      } else {
        // Single origin — always echo (backward compat)
        res.header('Access-Control-Allow-Origin', origins[0]);
        res.header('Vary', 'Origin');
      }

      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, Mcp-Session-Id, Accept'
      );
      res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');

      if (req.method === 'OPTIONS') {
        res.header('Access-Control-Max-Age', '86400');
        res.status(204).end();
        return;
      }
      next();
    });
  }

  // Auth middleware on the /mcp endpoint
  app.use('/mcp', requireBearerAuth({ verifier }));

  // IP allowlist middleware — runs after auth, before route handlers
  const isRemoteVerifier = 'getAllowedIpsForToken' in verifier;
  app.use('/mcp', (req, res, next) => {
    // Skip for OPTIONS (no auth on preflights — they're handled by CORS above)
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    if (isRemoteVerifier) {
      // Remote verifier: look up allowed IPs by token hash
      const token = req.auth?.token;
      if (token) {
        const allowedIps = (verifier as RemoteConfigVerifier).getAllowedIpsForToken(token);
        if (allowedIps && allowedIps.length > 0) {
          const clientIp = req.ip || req.socket.remoteAddress || '';
          if (!isIpAllowed(clientIp, allowedIps)) {
            res.status(403).json({ error: 'IP address not allowed for this key' });
            return;
          }
        }
      }
    } else {
      // Local verifier: look up allowed IPs by key name from YAML config
      const clientId = req.auth?.clientId;
      if (clientId) {
        const key = findKeyByName(clientId);
        if (key?.allowedIps && key.allowedIps.length > 0) {
          const clientIp = req.ip || req.socket.remoteAddress || '';
          if (!isIpAllowed(clientIp, key.allowedIps)) {
            res.status(403).json({ error: 'IP address not allowed for this key' });
            return;
          }
        }
      }
    }

    next();
  });

  // Session management
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const lastActivity = new Map<string, number>();
  // Maps session ID → clientId of the token that created it.
  // Prevents a different key from hijacking another key's session.
  const sessionOwners = new Map<string, string>();

  function touchSession(sessionId: string): void {
    lastActivity.set(sessionId, Date.now());
  }

  function removeSession(sessionId: string): void {
    transports.delete(sessionId);
    lastActivity.delete(sessionId);
    sessionOwners.delete(sessionId);
  }

  // Periodic sweep of idle sessions
  const sweepTimer = setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [sessionId, ts] of lastActivity) {
      if (ts < cutoff) {
        const transport = transports.get(sessionId);
        if (transport) transport.close().catch(() => {});
        removeSession(sessionId);
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  // POST /mcp — initialize new sessions and handle messages
  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId) {
      const existing = transports.get(sessionId);
      if (existing) {
        const owner = sessionOwners.get(sessionId);
        if (owner && req.auth?.clientId !== owner) {
          res.status(403).json({ error: 'Session belongs to a different key' });
          return;
        }
        touchSession(sessionId);
        await existing.handleRequest(req, res, req.body);
        return;
      }
    }

    // New session: create transport + server
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = createMcpServer({ authInfo: req.auth });

    transport.onclose = () => {
      if (transport.sessionId) removeSession(transport.sessionId);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    if (transport.sessionId) {
      transports.set(transport.sessionId, transport);
      if (req.auth?.clientId) {
        sessionOwners.set(transport.sessionId, req.auth.clientId);
      }
      touchSession(transport.sessionId);
    }
  });

  // GET /mcp — SSE stream for server-initiated messages
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: 'Missing Mcp-Session-Id header' });
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'Unknown session' });
      return;
    }

    const owner = sessionOwners.get(sessionId);
    if (owner && req.auth?.clientId !== owner) {
      res.status(403).json({ error: 'Session belongs to a different key' });
      return;
    }

    touchSession(sessionId);
    await transport.handleRequest(req, res);
  });

  // DELETE /mcp — session termination
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId) {
      const owner = sessionOwners.get(sessionId);
      if (owner && req.auth?.clientId !== owner) {
        res.status(403).json({ error: 'Session belongs to a different key' });
        return;
      }
      const transport = transports.get(sessionId);
      if (transport) {
        await transport.close();
        removeSession(sessionId);
      }
    }
    res.status(200).end();
  });

  const httpServer = createServer(app);

  // Wait for the server to actually be listening (surfaces bind errors like port conflicts)
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.bind, () => {
      httpServer.removeListener('error', reject);
      console.error(`MCP HTTP server listening on http://${options.bind}:${options.port}/mcp`);
      resolve();
    });
  });

  async function shutdown(): Promise<void> {
    clearInterval(sweepTimer);

    // Close all active transports
    const closePromises: Promise<void>[] = [];
    for (const [, transport] of transports) {
      closePromises.push(transport.close().catch(() => {}));
    }
    await Promise.all(closePromises);
    transports.clear();
    lastActivity.clear();
    sessionOwners.clear();

    // Stop accepting new connections and close the server
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  }

  // Graceful shutdown on signals (skip when running inside the daemon)
  if (!options.skipSignalHandlers) {
    const onSignal = async () => {
      await shutdown();
      process.exit(0);
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
  }

  return { shutdown, server: httpServer };
}
