import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock constants before importing the module under test
const tmpDir = join(process.cwd(), 'tests', '.tmp-agent-name-' + process.pid);
const mockAgentNameFile = join(tmpDir, 'agent-name');

vi.mock('../src/constants.js', () => ({
  ORKIFY_HOME: tmpDir,
  AGENT_NAME_FILE: mockAgentNameFile,
}));

// Import after mock setup
const { getAgentName, _resetAgentNameCache } = await import('../src/agent-name.js');

describe('getAgentName', () => {
  beforeEach(() => {
    _resetAgentNameCache();
    delete process.env.ORKIFY_AGENT_NAME;
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true });
    }
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.ORKIFY_AGENT_NAME;
    _resetAgentNameCache();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('returns env var when ORKIFY_AGENT_NAME is set', () => {
    process.env.ORKIFY_AGENT_NAME = 'my-custom-agent';
    expect(getAgentName()).toBe('my-custom-agent');
  });

  it('reads from file when it exists', () => {
    writeFileSync(mockAgentNameFile, 'persisted-name\n', 'utf8');
    expect(getAgentName()).toBe('persisted-name');
  });

  it('generates hostname-6hex format when no file or env', () => {
    const name = getAgentName();
    const host = hostname();
    const pattern = new RegExp(`^${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[0-9a-f]{6}$`);
    expect(name).toMatch(pattern);
  });

  it('persists generated name to file', () => {
    const name = getAgentName();
    expect(existsSync(mockAgentNameFile)).toBe(true);
    const fileContent = readFileSync(mockAgentNameFile, 'utf8').trim();
    expect(fileContent).toBe(name);
  });

  it('caches result across repeat calls', () => {
    const first = getAgentName();
    const second = getAgentName();
    expect(second).toBe(first);
  });

  it('_resetAgentNameCache clears cache', () => {
    process.env.ORKIFY_AGENT_NAME = 'first';
    const first = getAgentName();
    expect(first).toBe('first');

    _resetAgentNameCache();
    process.env.ORKIFY_AGENT_NAME = 'second';
    const second = getAgentName();
    expect(second).toBe('second');
  });
});
