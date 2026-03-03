import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerializedCacheEntry } from '../../src/cache/types.js';
import { CachePersistence } from '../../src/cache/CachePersistence.js';

// Mock CACHE_DIR to use a temp directory
let tempDir: string;

vi.mock('../../src/constants.js', () => ({
  get CACHE_DIR() {
    return tempDir;
  },
}));

describe('CachePersistence', () => {
  let persistence: CachePersistence;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-cache-test-'));
    persistence = new CachePersistence('test-app');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('writes entries to a JSON file', async () => {
      const entries: Array<[string, SerializedCacheEntry]> = [
        ['key1', { value: 'hello' }],
        ['key2', { value: 42, expiresAt: Date.now() + 60_000 }],
      ];

      await persistence.save(entries);

      const filePath = join(tempDir, 'test-app.json');
      expect(existsSync(filePath)).toBe(true);

      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content).toHaveLength(2);
      expect(content[0][0]).toBe('key1');
      expect(content[0][1].value).toBe('hello');
    });

    it('creates directory if it does not exist', async () => {
      rmSync(tempDir, { recursive: true, force: true });

      await persistence.save([['key', { value: 'val' }]]);

      expect(existsSync(join(tempDir, 'test-app.json'))).toBe(true);
    });

    it('uses atomic write (no .tmp file left)', async () => {
      await persistence.save([['key', { value: 'val' }]]);

      expect(existsSync(join(tempDir, 'test-app.json.tmp'))).toBe(false);
      expect(existsSync(join(tempDir, 'test-app.json'))).toBe(true);
    });
  });

  describe('load', () => {
    it('loads saved entries', async () => {
      const entries: Array<[string, SerializedCacheEntry]> = [
        ['a', { value: 1 }],
        ['b', { value: 'two', expiresAt: Date.now() + 60_000 }],
      ];
      await persistence.save(entries);

      const loaded = await persistence.load();
      expect(loaded).toHaveLength(2);
      expect(loaded[0][0]).toBe('a');
      expect(loaded[1][1].value).toBe('two');
    });

    it('returns empty array when file does not exist', async () => {
      const loaded = await persistence.load();
      expect(loaded).toEqual([]);
    });

    it('filters out expired entries on load', async () => {
      const entries: Array<[string, SerializedCacheEntry]> = [
        ['fresh', { value: 'yes', expiresAt: Date.now() + 60_000 }],
        ['stale', { value: 'no', expiresAt: Date.now() - 1000 }],
        ['eternal', { value: 'forever' }],
      ];
      await persistence.save(entries);

      const loaded = await persistence.load();
      expect(loaded).toHaveLength(2);
      const keys = loaded.map(([k]) => k);
      expect(keys).toContain('fresh');
      expect(keys).toContain('eternal');
      expect(keys).not.toContain('stale');
    });

    it('returns empty array on corrupted file', async () => {
      const filePath = join(tempDir, 'test-app.json');
      writeFileSync(filePath, '{invalid json!!!', 'utf-8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const loaded = await persistence.load();

      expect(loaded).toEqual([]);
      expect(warnSpy).toHaveBeenCalledOnce();

      warnSpy.mockRestore();
    });
  });

  describe('clear', () => {
    it('removes the file', async () => {
      await persistence.save([['key', { value: 'val' }]]);
      await persistence.clear();

      expect(existsSync(join(tempDir, 'test-app.json'))).toBe(false);
    });

    it('does nothing if file does not exist', async () => {
      await expect(persistence.clear()).resolves.not.toThrow();
    });
  });

  describe('process isolation', () => {
    it('uses separate files for different process names', async () => {
      const p1 = new CachePersistence('app-a');
      const p2 = new CachePersistence('app-b');

      await p1.save([['key', { value: 'a' }]]);
      await p2.save([['key', { value: 'b' }]]);

      const loaded1 = await p1.load();
      const loaded2 = await p2.load();

      expect(loaded1[0][1].value).toBe('a');
      expect(loaded2[0][1].value).toBe('b');
    });

    it('same process name shares the same file', async () => {
      const p1 = new CachePersistence('app');
      const p2 = new CachePersistence('app');

      await p1.save([['key', { value: 'one' }]]);

      const loaded = await p2.load();
      expect(loaded[0][1].value).toBe('one');
    });
  });
});
