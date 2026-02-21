import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, watchFile, writeFileSync } from 'node:fs';
import { BlockList, isIPv4 } from 'node:net';
import { dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { MCP_CONFIG_FILE, MCP_TOKEN_PREFIX } from '../constants.js';

/**
 * Valid MCP tool names — kept in sync with tools registered in server.ts.
 */
export const TOOL_NAMES = [
  'list',
  'logs',
  'snap',
  'listAllUsers',
  'up',
  'down',
  'restart',
  'reload',
  'delete',
  'restore',
  'kill',
] as const;

// Zod schemas

const mcpKeySchema = z.object({
  name: z.string().min(1),
  token: z.string().startsWith(MCP_TOKEN_PREFIX),
  tools: z.array(z.string()),
  allowedIps: z.array(z.string()).optional(),
});

const mcpConfigSchema = z.object({
  keys: z.array(mcpKeySchema).default([]),
});

export type McpConfig = z.infer<typeof mcpConfigSchema>;
export type McpKey = z.infer<typeof mcpKeySchema>;

// In-memory config cache
let cachedConfig: McpConfig | null = null;
let watching = false;

/**
 * Load and validate the MCP config from ~/.orkify/mcp.yml.
 * Returns cached version if available; cache is invalidated on SIGHUP or file change.
 */
export function loadMcpConfig(configPath: string = MCP_CONFIG_FILE): McpConfig {
  if (cachedConfig && configPath === MCP_CONFIG_FILE) return cachedConfig;

  let raw: unknown;
  try {
    const content = readFileSync(configPath, 'utf8');
    raw = parseYaml(content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      const empty = { keys: [] };
      if (configPath === MCP_CONFIG_FILE) cachedConfig = empty;
      return empty;
    }
    throw err;
  }

  const config = mcpConfigSchema.parse(raw);
  if (configPath === MCP_CONFIG_FILE) cachedConfig = config;
  return config;
}

/**
 * Start watching the config file for changes and listen for SIGHUP to reload.
 * Called once when the HTTP server starts.
 */
export function startConfigWatcher(): void {
  if (watching) return;
  watching = true;

  // Reload on SIGHUP
  process.on('SIGHUP', () => {
    cachedConfig = null;
    console.error('MCP config cache cleared (SIGHUP)');
  });

  // Reload on file change. watchFile uses stat polling, so it works even if
  // the file doesn't exist yet — the callback fires when the file is created.
  watchFile(MCP_CONFIG_FILE, { interval: 2000 }, () => {
    cachedConfig = null;
  });
}

/**
 * Token verifier that reads keys from the local YAML config.
 * Implements the MCP SDK's OAuthTokenVerifier interface.
 */
export class LocalConfigVerifier implements OAuthTokenVerifier {
  private configPath: string;

  constructor(configPath: string = MCP_CONFIG_FILE) {
    this.configPath = configPath;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const config = loadMcpConfig(this.configPath);
    const tokenBuf = Buffer.from(token);

    for (const key of config.keys) {
      const keyBuf = Buffer.from(key.token);
      if (tokenBuf.length === keyBuf.length && timingSafeEqual(tokenBuf, keyBuf)) {
        return {
          token,
          clientId: key.name,
          scopes: key.tools,
          // Static local tokens don't expire — this satisfies the AuthInfo interface.
          expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
        };
      }
    }

    throw new InvalidTokenError('Invalid or unknown token');
  }
}

/**
 * Generate a new MCP token: prefix + 48 hex chars (24 random bytes).
 */
export function generateToken(): string {
  return MCP_TOKEN_PREFIX + randomBytes(24).toString('hex');
}

/**
 * Append a new key to the MCP config file.
 * Creates the file with 0o600 permissions if it doesn't exist.
 */
export function appendKeyToConfig(key: McpKey, configPath: string = MCP_CONFIG_FILE): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let config: McpConfig;
  try {
    config = loadMcpConfig(configPath);
  } catch (err) {
    console.error('Failed to load MCP config, starting fresh:', (err as Error).message);
    config = { keys: [] };
  }

  config.keys.push(key);

  const yaml = stringifyYaml(config);

  if (!existsSync(configPath)) {
    // Create with restrictive permissions (owner-only)
    writeFileSync(configPath, yaml, { mode: 0o600 });
  } else {
    writeFileSync(configPath, yaml);
  }

  // Invalidate cache so next load picks up the new key
  if (configPath === MCP_CONFIG_FILE) {
    cachedConfig = null;
  }
}

/**
 * Warn to stderr if the MCP config file has permissions more open than 0600.
 * Skipped on Windows where Unix mode bits don't apply.
 */
export function warnIfConfigInsecure(configPath: string = MCP_CONFIG_FILE): void {
  if (process.platform === 'win32') return;
  try {
    const mode = statSync(configPath).mode & 0o777;
    if (mode !== 0o600) {
      console.error(
        `Warning: ${configPath} has mode 0${mode.toString(8)} — expected 0600. ` +
          'Other users may be able to read your MCP tokens.'
      );
    }
  } catch {
    // File doesn't exist or can't stat — nothing to warn about
  }
}

/**
 * Strip the `::ffff:` prefix from IPv4-mapped IPv6 addresses.
 * Express may report `::ffff:127.0.0.1` for IPv4 clients.
 */
export function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    if (isIPv4(v4)) return v4;
  }
  return ip;
}

/**
 * Check if a client IP is allowed by the key's `allowedIps` list.
 * Returns `true` if `allowedIps` is absent or empty (all IPs allowed).
 * Uses Node.js `BlockList` as an allowlist — `check()` returns `true` for listed IPs.
 */
export function isIpAllowed(clientIp: string, allowedIps?: string[]): boolean {
  if (!allowedIps || allowedIps.length === 0) return true;

  const normalized = normalizeIp(clientIp);
  const list = new BlockList();

  for (const entry of allowedIps) {
    if (entry.includes('/')) {
      const [prefix, bits] = entry.split('/');
      const type = isIPv4(prefix) ? 'ipv4' : 'ipv6';
      list.addSubnet(prefix, Number(bits), type);
    } else {
      const type = isIPv4(entry) ? 'ipv4' : 'ipv6';
      list.addAddress(entry, type);
    }
  }

  const type = isIPv4(normalized) ? 'ipv4' : 'ipv6';
  return list.check(normalized, type);
}

/**
 * Look up a key by name from the config.
 */
export function findKeyByName(name: string, configPath?: string): McpKey | undefined {
  const config = configPath ? loadMcpConfig(configPath) : loadMcpConfig();
  return config.keys.find((k) => k.name === name);
}
