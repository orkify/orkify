import { chmodSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { MCP_TOKEN_PREFIX } from '../../src/constants.js';
import {
  loadMcpConfig,
  LocalConfigVerifier,
  generateToken,
  appendKeyToConfig,
  warnIfConfigInsecure,
  normalizeIp,
  isIpAllowed,
  TOOL_NAMES,
} from '../../src/mcp/auth.js';
import { checkToolAccess } from '../../src/mcp/server.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'orkify-mcp-test-'));
});

afterAll(() => {
  // Clean up all temp dirs created during tests
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------
describe('loadMcpConfig', () => {
  it('parses a valid YAML config', () => {
    const configPath = join(tmpDir, 'mcp.yml');
    const yaml = stringifyYaml({
      keys: [
        {
          name: 'test-key',
          token: `${MCP_TOKEN_PREFIX}${'ab'.repeat(24)}`,
          tools: ['list', 'logs'],
        },
      ],
    });
    writeFileSync(configPath, yaml);

    const config = loadMcpConfig(configPath);
    expect(config.keys).toHaveLength(1);
    expect(config.keys[0].name).toBe('test-key');
    expect(config.keys[0].tools).toEqual(['list', 'logs']);
  });

  it('returns empty keys array when file is missing', () => {
    const configPath = join(tmpDir, 'nonexistent.yml');
    const config = loadMcpConfig(configPath);
    expect(config.keys).toEqual([]);
  });

  it('rejects token without the required prefix', () => {
    const configPath = join(tmpDir, 'bad-prefix.yml');
    writeFileSync(
      configPath,
      stringifyYaml({
        keys: [{ name: 'bad', token: 'wrong_prefix_abc123', tools: ['*'] }],
      })
    );

    expect(() => loadMcpConfig(configPath)).toThrow();
  });

  it('handles empty keys array', () => {
    const configPath = join(tmpDir, 'empty.yml');
    writeFileSync(configPath, stringifyYaml({ keys: [] }));
    const config = loadMcpConfig(configPath);
    expect(config.keys).toEqual([]);
  });

  it('handles empty YAML file (defaults to empty keys)', () => {
    const configPath = join(tmpDir, 'empty-file.yml');
    writeFileSync(configPath, '{}\n');
    const config = loadMcpConfig(configPath);
    expect(config.keys).toEqual([]);
  });

  it('rejects key with empty name', () => {
    const configPath = join(tmpDir, 'empty-name.yml');
    writeFileSync(
      configPath,
      stringifyYaml({
        keys: [{ name: '', token: `${MCP_TOKEN_PREFIX}${'ab'.repeat(24)}`, tools: ['*'] }],
      })
    );

    expect(() => loadMcpConfig(configPath)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// LocalConfigVerifier
// ---------------------------------------------------------------------------
describe('LocalConfigVerifier', () => {
  function writeConfig(keys: Array<{ name: string; token: string; tools: string[] }>): string {
    const configPath = join(
      tmpDir,
      `config-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`
    );
    writeFileSync(configPath, stringifyYaml({ keys }));
    return configPath;
  }

  it('accepts a matching token and returns correct AuthInfo', async () => {
    const token = `${MCP_TOKEN_PREFIX}${'cd'.repeat(24)}`;
    const configPath = writeConfig([{ name: 'my-key', token, tools: ['list', 'logs'] }]);

    const verifier = new LocalConfigVerifier(configPath);
    const info = await verifier.verifyAccessToken(token);

    expect(info.clientId).toBe('my-key');
    expect(info.scopes).toEqual(['list', 'logs']);
    expect(info.token).toBe(token);
    expect(info.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a non-matching token', async () => {
    const token = `${MCP_TOKEN_PREFIX}${'aa'.repeat(24)}`;
    const configPath = writeConfig([{ name: 'key', token, tools: ['*'] }]);

    const verifier = new LocalConfigVerifier(configPath);
    await expect(
      verifier.verifyAccessToken(`${MCP_TOKEN_PREFIX}${'bb'.repeat(24)}`)
    ).rejects.toThrow(InvalidTokenError);
  });

  it('rejects an empty token', async () => {
    const token = `${MCP_TOKEN_PREFIX}${'cc'.repeat(24)}`;
    const configPath = writeConfig([{ name: 'key', token, tools: ['*'] }]);

    const verifier = new LocalConfigVerifier(configPath);
    await expect(verifier.verifyAccessToken('')).rejects.toThrow(InvalidTokenError);
  });

  it('handles multiple keys and matches the correct one', async () => {
    const token1 = `${MCP_TOKEN_PREFIX}${'11'.repeat(24)}`;
    const token2 = `${MCP_TOKEN_PREFIX}${'22'.repeat(24)}`;
    const configPath = writeConfig([
      { name: 'key-one', token: token1, tools: ['list'] },
      { name: 'key-two', token: token2, tools: ['*'] },
    ]);

    const verifier = new LocalConfigVerifier(configPath);
    const info = await verifier.verifyAccessToken(token2);
    expect(info.clientId).toBe('key-two');
    expect(info.scopes).toEqual(['*']);
  });

  it('rejects token with wrong length (timing-safe)', async () => {
    const token = `${MCP_TOKEN_PREFIX}${'dd'.repeat(24)}`;
    const configPath = writeConfig([{ name: 'key', token, tools: ['*'] }]);

    const verifier = new LocalConfigVerifier(configPath);
    // Shorter token
    await expect(verifier.verifyAccessToken(`${MCP_TOKEN_PREFIX}short`)).rejects.toThrow(
      InvalidTokenError
    );
  });
});

// ---------------------------------------------------------------------------
// checkToolAccess
// ---------------------------------------------------------------------------
describe('checkToolAccess', () => {
  it('allows all tools when no authInfo (stdio mode)', () => {
    const result = checkToolAccess('list');
    expect(result.allowed).toBe(true);
  });

  it('allows all tools when scopes include "*"', () => {
    const authInfo: AuthInfo = {
      token: 'test',
      clientId: 'admin',
      scopes: ['*'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    expect(checkToolAccess('list', authInfo).allowed).toBe(true);
    expect(checkToolAccess('up', authInfo).allowed).toBe(true);
    expect(checkToolAccess('delete', authInfo).allowed).toBe(true);
  });

  it('allows tools in the scopes list', () => {
    const authInfo: AuthInfo = {
      token: 'test',
      clientId: 'reader',
      scopes: ['list', 'logs'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    expect(checkToolAccess('list', authInfo).allowed).toBe(true);
    expect(checkToolAccess('logs', authInfo).allowed).toBe(true);
  });

  it('blocks tools not in the scopes list', () => {
    const authInfo: AuthInfo = {
      token: 'test',
      clientId: 'reader',
      scopes: ['list', 'logs'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const result = checkToolAccess('up', authInfo);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.error.isError).toBe(true);
      const text = result.error.content[0].text;
      expect(text).toContain('FORBIDDEN');
      expect(text).toContain('reader');
      expect(text).toContain('up');
    }
  });

  it('blocks delete, kill, restart for read-only key', () => {
    const authInfo: AuthInfo = {
      token: 'test',
      clientId: 'monitor',
      scopes: ['list', 'logs'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
    expect(checkToolAccess('delete', authInfo).allowed).toBe(false);
    expect(checkToolAccess('kill', authInfo).allowed).toBe(false);
    expect(checkToolAccess('restart', authInfo).allowed).toBe(false);
    expect(checkToolAccess('up', authInfo).allowed).toBe(false);
    expect(checkToolAccess('down', authInfo).allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------
describe('generateToken', () => {
  it('has the correct prefix', () => {
    const token = generateToken();
    expect(token.startsWith(MCP_TOKEN_PREFIX)).toBe(true);
  });

  it('is the correct length (prefix + 48 hex chars)', () => {
    const token = generateToken();
    expect(token.length).toBe(MCP_TOKEN_PREFIX.length + 48);
  });

  it('produces unique tokens on each call', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateToken()));
    expect(tokens.size).toBe(20);
  });

  it('contains only hex characters after the prefix', () => {
    const token = generateToken();
    const hex = token.slice(MCP_TOKEN_PREFIX.length);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });
});

// ---------------------------------------------------------------------------
// TOOL_NAMES
// ---------------------------------------------------------------------------
describe('TOOL_NAMES', () => {
  it('contains all expected tool names', () => {
    expect(TOOL_NAMES).toContain('list');
    expect(TOOL_NAMES).toContain('logs');
    expect(TOOL_NAMES).toContain('up');
    expect(TOOL_NAMES).toContain('down');
    expect(TOOL_NAMES).toContain('restart');
    expect(TOOL_NAMES).toContain('reload');
    expect(TOOL_NAMES).toContain('delete');
    expect(TOOL_NAMES).toContain('restore');
    expect(TOOL_NAMES).toContain('snap');
    expect(TOOL_NAMES).toContain('listAllUsers');
    expect(TOOL_NAMES).toContain('kill');
    expect(TOOL_NAMES).toHaveLength(11);
  });
});

// ---------------------------------------------------------------------------
// appendKeyToConfig
// ---------------------------------------------------------------------------
describe('appendKeyToConfig', () => {
  it('creates config file if missing', () => {
    const configPath = join(tmpDir, 'new-config.yml');
    const token = generateToken();
    appendKeyToConfig({ name: 'new-key', token, tools: ['*'] }, configPath);

    const config = loadMcpConfig(configPath);
    expect(config.keys).toHaveLength(1);
    expect(config.keys[0].name).toBe('new-key');
  });

  it('appends to existing config', () => {
    const configPath = join(tmpDir, 'append.yml');
    const token1 = generateToken();
    const token2 = generateToken();

    appendKeyToConfig({ name: 'key-1', token: token1, tools: ['list'] }, configPath);
    appendKeyToConfig({ name: 'key-2', token: token2, tools: ['*'] }, configPath);

    const config = loadMcpConfig(configPath);
    expect(config.keys).toHaveLength(2);
    expect(config.keys[0].name).toBe('key-1');
    expect(config.keys[1].name).toBe('key-2');
  });
});

// ---------------------------------------------------------------------------
// warnIfConfigInsecure
// ---------------------------------------------------------------------------
describe('warnIfConfigInsecure', () => {
  it.skipIf(process.platform === 'win32')('warns when permissions are too open', () => {
    const configPath = join(tmpDir, 'insecure.yml');
    writeFileSync(configPath, stringifyYaml({ keys: [] }), { mode: 0o644 });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnIfConfigInsecure(configPath);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('mode 0644');
    expect(spy.mock.calls[0][0]).toContain('expected 0600');
    spy.mockRestore();
  });

  it.skipIf(process.platform === 'win32')('does not warn when permissions are correct', () => {
    const configPath = join(tmpDir, 'secure.yml');
    writeFileSync(configPath, stringifyYaml({ keys: [] }), { mode: 0o600 });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnIfConfigInsecure(configPath);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not warn when file does not exist', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnIfConfigInsecure(join(tmpDir, 'nonexistent.yml'));

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it.skipIf(process.platform === 'win32')('warns for world-readable file (0o644)', () => {
    const configPath = join(tmpDir, 'world-readable.yml');
    writeFileSync(configPath, stringifyYaml({ keys: [] }), { mode: 0o600 });
    chmodSync(configPath, 0o644);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnIfConfigInsecure(configPath);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('Other users may be able to read');
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// normalizeIp
// ---------------------------------------------------------------------------
describe('normalizeIp', () => {
  it('strips ::ffff: prefix from IPv4-mapped IPv6', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('leaves plain IPv4 unchanged', () => {
    expect(normalizeIp('192.168.1.1')).toBe('192.168.1.1');
  });

  it('leaves plain IPv6 unchanged', () => {
    expect(normalizeIp('::1')).toBe('::1');
  });

  it('strips ::ffff: prefix from other IPv4-mapped addresses', () => {
    expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
  });
});

// ---------------------------------------------------------------------------
// isIpAllowed
// ---------------------------------------------------------------------------
describe('isIpAllowed', () => {
  it('returns true when allowedIps is undefined', () => {
    expect(isIpAllowed('1.2.3.4', undefined)).toBe(true);
  });

  it('returns true when allowedIps is empty', () => {
    expect(isIpAllowed('1.2.3.4', [])).toBe(true);
  });

  it('allows exact IPv4 match', () => {
    expect(isIpAllowed('192.168.1.50', ['192.168.1.50'])).toBe(true);
  });

  it('rejects non-matching IPv4', () => {
    expect(isIpAllowed('10.0.0.1', ['192.168.1.50'])).toBe(false);
  });

  it('allows IPv4 within CIDR range', () => {
    expect(isIpAllowed('10.0.5.99', ['10.0.0.0/8'])).toBe(true);
  });

  it('rejects IPv4 outside CIDR range', () => {
    expect(isIpAllowed('192.168.1.1', ['10.0.0.0/8'])).toBe(false);
  });

  it('normalizes IPv4-mapped IPv6 and matches against IPv4 entry', () => {
    expect(isIpAllowed('::ffff:192.168.1.50', ['192.168.1.50'])).toBe(true);
  });

  it('normalizes IPv4-mapped IPv6 and matches against CIDR', () => {
    expect(isIpAllowed('::ffff:10.0.0.5', ['10.0.0.0/8'])).toBe(true);
  });

  it('allows with multiple entries when one matches', () => {
    expect(isIpAllowed('203.0.113.50', ['10.0.0.0/8', '192.168.1.0/24', '203.0.113.50'])).toBe(
      true
    );
  });

  it('rejects with multiple entries when none match', () => {
    expect(isIpAllowed('8.8.8.8', ['10.0.0.0/8', '192.168.1.0/24', '203.0.113.50'])).toBe(false);
  });

  it('allows exact IPv6 match', () => {
    expect(isIpAllowed('::1', ['::1'])).toBe(true);
  });

  it('rejects non-matching IPv6', () => {
    expect(isIpAllowed('::2', ['::1'])).toBe(false);
  });

  it('allows IPv6 within CIDR range', () => {
    expect(isIpAllowed('fd00::1', ['fd00::/8'])).toBe(true);
  });

  it('rejects IPv6 outside CIDR range', () => {
    expect(isIpAllowed('2001:db8::1', ['fd00::/8'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Schema with allowedIps
// ---------------------------------------------------------------------------
describe('mcpKeySchema with allowedIps', () => {
  it('parses config with allowedIps', () => {
    const configPath = join(tmpDir, 'allowed-ips.yml');
    writeFileSync(
      configPath,
      stringifyYaml({
        keys: [
          {
            name: 'restricted',
            token: `${MCP_TOKEN_PREFIX}${'ab'.repeat(24)}`,
            tools: ['*'],
            allowedIps: ['10.0.0.0/8', '192.168.1.50'],
          },
        ],
      })
    );

    const config = loadMcpConfig(configPath);
    expect(config.keys[0].allowedIps).toEqual(['10.0.0.0/8', '192.168.1.50']);
  });

  it('parses config without allowedIps (backward compat)', () => {
    const configPath = join(tmpDir, 'no-allowed-ips.yml');
    writeFileSync(
      configPath,
      stringifyYaml({
        keys: [
          {
            name: 'open',
            token: `${MCP_TOKEN_PREFIX}${'cd'.repeat(24)}`,
            tools: ['*'],
          },
        ],
      })
    );

    const config = loadMcpConfig(configPath);
    expect(config.keys[0].allowedIps).toBeUndefined();
  });
});
