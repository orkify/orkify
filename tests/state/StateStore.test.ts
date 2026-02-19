import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { McpStartPayload, ProcessConfig } from '../../src/types/index.js';
import { ExecMode } from '../../src/constants.js';
import { StateStore } from '../../src/state/StateStore.js';

describe('StateStore', () => {
  let tempDir: string;
  let stateFile: string;
  let store: StateStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-test-'));
    stateFile = join(tempDir, 'snapshot.yml');
    store = new StateStore(stateFile);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const createTestConfig = (name: string): ProcessConfig => ({
    name,
    script: `/app/${name}.js`,
    cwd: '/app',
    workerCount: 2,
    execMode: ExecMode.CLUSTER,
    watch: false,
    env: { NODE_ENV: 'production' },
    nodeArgs: [],
    args: [],
    killTimeout: 5000,
    maxRestarts: 10,
    minUptime: 1000,
    restartDelay: 100,
    sticky: false,
    logMaxSize: 100 * 1024 * 1024,
    logMaxFiles: 90,
    logMaxAge: 90 * 24 * 60 * 60 * 1000,
  });

  describe('save', () => {
    it('saves process configs to YAML file', async () => {
      const configs = [createTestConfig('app1'), createTestConfig('app2')];

      await store.save(configs);

      expect(existsSync(stateFile)).toBe(true);

      // Verify it's valid YAML
      const content = readFileSync(stateFile, 'utf-8');
      const parsed = parse(content);
      expect(parsed.version).toBe(1);
      expect(parsed.processes).toHaveLength(2);
    });

    it('creates directory if it does not exist', async () => {
      const nestedPath = join(tempDir, 'nested', 'dir', 'snapshot.yml');
      const nestedStore = new StateStore(nestedPath);

      await nestedStore.save([createTestConfig('app')]);

      expect(existsSync(nestedPath)).toBe(true);
    });
  });

  describe('load', () => {
    it('loads saved process configs', async () => {
      const configs = [createTestConfig('app1'), createTestConfig('app2')];

      await store.save(configs);
      const loaded = await store.load();

      expect(loaded).toHaveLength(2);
      expect(loaded[0].name).toBe('app1');
      expect(loaded[1].name).toBe('app2');
      expect(loaded[0].workerCount).toBe(2);
      expect(loaded[0].execMode).toBe(ExecMode.CLUSTER);
    });

    it('returns empty array if file does not exist', async () => {
      const loaded = await store.load();

      expect(loaded).toEqual([]);
    });

    it('preserves all config properties', async () => {
      const config = createTestConfig('app');
      config.env = { FOO: 'bar', BAZ: 'qux' };
      config.nodeArgs = ['--max-old-space-size=4096'];
      config.args = ['--port', '3000'];
      config.watch = true;
      config.watchPaths = ['/app/src'];
      config.sticky = true;

      await store.save([config]);
      const [loaded] = await store.load();

      expect(loaded.env).toEqual({ FOO: 'bar', BAZ: 'qux' });
      expect(loaded.nodeArgs).toEqual(['--max-old-space-size=4096']);
      expect(loaded.args).toEqual(['--port', '3000']);
      expect(loaded.watch).toBe(true);
      expect(loaded.watchPaths).toEqual(['/app/src']);
      expect(loaded.sticky).toBe(true);
    });
  });

  describe('clear', () => {
    it('clears all saved processes', async () => {
      await store.save([createTestConfig('app')]);
      await store.clear();
      const loaded = await store.load();

      expect(loaded).toEqual([]);
    });

    it('works when file does not exist', async () => {
      await expect(store.clear()).resolves.not.toThrow();
    });
  });

  describe('save with MCP options', () => {
    it('includes mcp in YAML when provided', async () => {
      const mcp: McpStartPayload = {
        transport: 'simple-http',
        port: 8787,
        bind: '127.0.0.1',
        cors: '*',
      };
      await store.save([createTestConfig('app')], mcp);

      const content = readFileSync(stateFile, 'utf-8');
      const parsed = parse(content);
      expect(parsed.mcp).toEqual({
        transport: 'simple-http',
        port: 8787,
        bind: '127.0.0.1',
        cors: '*',
      });
    });

    it('omits mcp key when not provided', async () => {
      await store.save([createTestConfig('app')]);

      const content = readFileSync(stateFile, 'utf-8');
      const parsed = parse(content);
      expect(parsed.mcp).toBeUndefined();
    });
  });

  describe('loadFull', () => {
    it('returns mcp when present in snapshot', async () => {
      const mcp: McpStartPayload = { transport: 'simple-http', port: 9090, bind: '0.0.0.0' };
      await store.save([createTestConfig('app')], mcp);

      const state = await store.loadFull();
      expect(state.mcp).toEqual({ transport: 'simple-http', port: 9090, bind: '0.0.0.0' });
      expect(state.processes).toHaveLength(1);
    });

    it('preserves all mcp fields including cors', async () => {
      const mcp: McpStartPayload = {
        transport: 'simple-http',
        port: 8787,
        bind: '127.0.0.1',
        cors: '*',
      };
      await store.save([createTestConfig('app')], mcp);

      const state = await store.loadFull();
      expect(state.mcp).toEqual({
        transport: 'simple-http',
        port: 8787,
        bind: '127.0.0.1',
        cors: '*',
      });
    });

    it('returns mcp undefined for old snapshots without mcp', async () => {
      await store.save([createTestConfig('app')]);

      const state = await store.loadFull();
      expect(state.mcp).toBeUndefined();
      expect(state.processes).toHaveLength(1);
    });

    it('returns empty state when file does not exist', async () => {
      const state = await store.loadFull();
      expect(state.processes).toEqual([]);
      expect(state.mcp).toBeUndefined();
    });

    it('ignores invalid mcp section in snapshot', async () => {
      const badState = {
        version: 1,
        processes: [],
        mcp: { transport: 'unknown', port: 'not-a-number' },
      };
      writeFileSync(stateFile, stringify(badState), 'utf-8');

      const state = await store.loadFull();
      expect(state.mcp).toBeUndefined();
    });

    it('coerces env values to strings', async () => {
      const config = createTestConfig('app');
      config.env = { PORT: '3000' };
      await store.save([config]);

      const state = await store.loadFull();
      expect(typeof state.processes[0].env.PORT).toBe('string');
    });
  });

  describe('exists', () => {
    it('returns false when file does not exist', async () => {
      const exists = await store.exists();

      expect(exists).toBe(false);
    });

    it('returns true when file exists', async () => {
      await store.save([]);
      const exists = await store.exists();

      expect(exists).toBe(true);
    });
  });
});
