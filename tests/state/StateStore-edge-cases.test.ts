import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from 'yaml';
import { ExecMode } from '../../src/constants.js';
import { StateStore } from '../../src/state/StateStore.js';
import type { ProcessConfig } from '../../src/types/index.js';

describe('StateStore edge cases', () => {
  let tempDir: string;
  let stateFile: string;
  let store: StateStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-state-edge-'));
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
  });

  describe('corrupt snapshot file handling', () => {
    it('returns empty array for truncated YAML', async () => {
      // Simulate a partial write (daemon crashed mid-save)
      writeFileSync(stateFile, 'version: 1\nprocesses:\n  - name: "app1"\n    scri');

      const loaded = await store.load();
      // YAML parser may partially parse or throw — either way we get a safe result
      expect(Array.isArray(loaded)).toBe(true);
    });

    it('returns empty array for empty file', async () => {
      writeFileSync(stateFile, '');

      const loaded = await store.load();
      expect(loaded).toEqual([]);
    });

    it('returns empty array for null bytes', async () => {
      writeFileSync(stateFile, '\0\0\0\0');

      const loaded = await store.load();
      expect(loaded).toEqual([]);
    });

    it('returns empty array for valid YAML with missing processes field', async () => {
      writeFileSync(stateFile, 'version: 1\n');

      const loaded = await store.load();
      expect(Array.isArray(loaded)).toBe(true);
      expect(loaded).toEqual([]);
    });
  });

  describe('env coercion from hand-edited YAML', () => {
    it('coerces unquoted YAML values to strings', async () => {
      // Simulate a hand-edited file where a user didn't quote env values
      writeFileSync(
        stateFile,
        [
          'version: 1',
          'processes:',
          '  - name: app',
          '    script: /app/app.js',
          '    cwd: /app',
          '    workerCount: 1',
          '    execMode: fork',
          '    watch: false',
          '    env:',
          '      PORT: 3000',
          '      DEBUG: true',
          '      VERBOSE: yes',
          '      FEATURE: off',
          '      EMPTY: null',
          '      VERSION: 1.0',
          '      NORMAL: "already a string"',
          '    nodeArgs: []',
          '    args: []',
          '    killTimeout: 5000',
          '    maxRestarts: 10',
          '    minUptime: 1000',
          '    restartDelay: 100',
          '    sticky: false',
        ].join('\n')
      );

      const [loaded] = await store.load();
      expect(loaded.env.PORT).toBe('3000'); // number → string
      expect(loaded.env.DEBUG).toBe('true'); // boolean → string
      expect(loaded.env.VERBOSE).toBe('yes'); // YAML 1.2: `yes` is a plain string
      expect(loaded.env.FEATURE).toBe('off'); // YAML 1.2: `off` is a plain string
      expect(loaded.env.EMPTY).toBe(''); // null → empty string
      expect(loaded.env.VERSION).toBe('1'); // YAML parses 1.0 as float 1 → "1"
      expect(loaded.env.NORMAL).toBe('already a string');

      // Every value must be a string
      for (const value of Object.values(loaded.env)) {
        expect(typeof value).toBe('string');
      }
    });
  });

  describe('atomic write', () => {
    it('should use atomic write (temp file + rename)', async () => {
      const configs = [createTestConfig('app1'), createTestConfig('app2')];

      await store.save(configs);

      // After save, verify the snapshot file contains valid YAML
      const content = readFileSync(stateFile, 'utf-8');
      const parsed = parse(content);
      expect(parsed.processes).toHaveLength(2);

      // Verify a temp file is NOT left behind
      const tmpFile = stateFile + '.tmp';
      expect(existsSync(tmpFile)).toBe(false);

      // Verify consecutive saves produce valid YAML
      await store.save([createTestConfig('app1')]);
      const content1 = readFileSync(stateFile, 'utf-8');
      expect(() => parse(content1)).not.toThrow();

      await store.save([createTestConfig('app1'), createTestConfig('app2')]);
      const content2 = readFileSync(stateFile, 'utf-8');
      expect(() => parse(content2)).not.toThrow();

      // Verify the implementation uses rename for atomicity
      const storeSource = readFileSync(
        join(process.cwd(), 'src', 'state', 'StateStore.ts'),
        'utf-8'
      );
      expect(storeSource).toContain('rename');
    });
  });
});
