import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheSnapshot, SerializedCacheEntry } from '../../packages/cache/src/types.js';
import { CachePersistence } from '../../packages/cache/src/CachePersistence.js';

// Mock CACHE_DIR to use a temp directory
let tempDir: string;

vi.mock('../../packages/cache/src/constants.js', () => ({
  get CACHE_DIR() {
    return tempDir;
  },
}));

function snap(
  entries: Array<[string, SerializedCacheEntry]>,
  tagTimestamps: Array<[string, number]> = []
): CacheSnapshot {
  return { entries, tagTimestamps };
}

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
      await persistence.save(
        snap([
          ['key1', { value: 'hello' }],
          ['key2', { value: 42, expiresAt: Date.now() + 60_000 }],
        ])
      );

      const filePath = join(tempDir, 'test-app.json');
      expect(existsSync(filePath)).toBe(true);

      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.entries).toHaveLength(2);
      expect(content.entries[0][0]).toBe('key1');
      // On disk, values are encoded as { data, encoding }
      expect(content.entries[0][1].value).toEqual({ data: '"hello"', encoding: 'json' });
    });

    it('creates directory if it does not exist', async () => {
      rmSync(tempDir, { recursive: true, force: true });

      await persistence.save(snap([['key', { value: 'val' }]]));

      expect(existsSync(join(tempDir, 'test-app.json'))).toBe(true);
    });

    it('uses atomic write (no .tmp file left)', async () => {
      await persistence.save(snap([['key', { value: 'val' }]]));

      expect(existsSync(join(tempDir, 'test-app.json.tmp'))).toBe(false);
      expect(existsSync(join(tempDir, 'test-app.json'))).toBe(true);
    });
  });

  describe('load', () => {
    it('loads saved entries', async () => {
      await persistence.save(
        snap([
          ['a', { value: 1 }],
          ['b', { value: 'two', expiresAt: Date.now() + 60_000 }],
        ])
      );

      const loaded = await persistence.load();
      expect(loaded.entries).toHaveLength(2);
      expect(loaded.entries[0][0]).toBe('a');
      expect(loaded.entries[1][1].value).toBe('two');
    });

    it('returns empty snapshot when file does not exist', async () => {
      const loaded = await persistence.load();
      expect(loaded.entries).toEqual([]);
      expect(loaded.tagTimestamps).toEqual([]);
    });

    it('filters out expired entries on load', async () => {
      await persistence.save(
        snap([
          ['fresh', { value: 'yes', expiresAt: Date.now() + 60_000 }],
          ['stale', { value: 'no', expiresAt: Date.now() - 1000 }],
          ['eternal', { value: 'forever' }],
        ])
      );

      const loaded = await persistence.load();
      expect(loaded.entries).toHaveLength(2);
      const keys = loaded.entries.map(([k]) => k);
      expect(keys).toContain('fresh');
      expect(keys).toContain('eternal');
      expect(keys).not.toContain('stale');
    });

    it('returns empty snapshot on corrupted file', async () => {
      const filePath = join(tempDir, 'test-app.json');
      writeFileSync(filePath, '{invalid json!!!', 'utf-8');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const loaded = await persistence.load();

      expect(loaded.entries).toEqual([]);
      expect(loaded.tagTimestamps).toEqual([]);
      expect(warnSpy).toHaveBeenCalledOnce();

      warnSpy.mockRestore();
    });
  });

  describe('clear', () => {
    it('removes the file', async () => {
      await persistence.save(snap([['key', { value: 'val' }]]));
      await persistence.clear();

      expect(existsSync(join(tempDir, 'test-app.json'))).toBe(false);
    });

    it('does nothing if file does not exist', async () => {
      await expect(persistence.clear()).resolves.not.toThrow();
    });
  });

  describe('V8-encoded values', () => {
    it('save/load round-trips Map values', async () => {
      const map = new Map([
        ['a', 1],
        ['b', 2],
      ]);
      await persistence.save(snap([['map-key', { value: map }]]));

      const loaded = await persistence.load();
      expect(loaded.entries).toHaveLength(1);
      const value = loaded.entries[0][1].value as Map<string, number>;
      expect(value).toBeInstanceOf(Map);
      expect(value.get('a')).toBe(1);
      expect(value.get('b')).toBe(2);
    });

    it('save/load round-trips Set values', async () => {
      const set = new Set(['x', 'y', 'z']);
      await persistence.save(snap([['set-key', { value: set }]]));

      const loaded = await persistence.load();
      expect(loaded.entries).toHaveLength(1);
      const value = loaded.entries[0][1].value as Set<string>;
      expect(value).toBeInstanceOf(Set);
      expect(value.has('x')).toBe(true);
      expect(value.size).toBe(3);
    });

    it('save/load round-trips complex V8 values', async () => {
      const value = {
        statuses: new Map([['err1', 'resolved']]),
        known: new Set(['fp1', 'fp2']),
      };
      await persistence.save(snap([['complex', { value }]]));

      const loaded = await persistence.load();
      const result = loaded.entries[0][1].value as typeof value;
      expect(result.statuses).toBeInstanceOf(Map);
      expect(result.statuses.get('err1')).toBe('resolved');
      expect(result.known).toBeInstanceOf(Set);
      expect(result.known.has('fp1')).toBe(true);
    });
  });

  describe('tags', () => {
    it('save/load round-trips tags', async () => {
      await persistence.save(
        snap([
          ['a', { value: 1, tags: ['group'] }],
          ['b', { value: 2, tags: ['group', 'extra'], expiresAt: Date.now() + 60_000 }],
        ])
      );

      const loaded = await persistence.load();
      expect(loaded.entries).toHaveLength(2);
      expect(loaded.entries[0][1].tags).toEqual(['group']);
      expect(loaded.entries[1][1].tags).toEqual(['group', 'extra']);
    });

    it('entries without tags load correctly', async () => {
      await persistence.save(snap([['no-tags', { value: 'plain' }]]));

      const loaded = await persistence.load();
      expect(loaded.entries[0][1].tags).toBeUndefined();
    });
  });

  describe('tag timestamps', () => {
    it('save/load round-trips tag timestamps', async () => {
      await persistence.save(
        snap(
          [],
          [
            ['tag-a', 1000],
            ['tag-b', 2000],
          ]
        )
      );

      const loaded = await persistence.load();
      expect(loaded.tagTimestamps).toEqual([
        ['tag-a', 1000],
        ['tag-b', 2000],
      ]);
    });

    it('save/load round-trips entries and tag timestamps together', async () => {
      await persistence.save(snap([['key', { value: 'val' }]], [['tag-x', 5000]]));

      const loaded = await persistence.load();
      expect(loaded.entries).toHaveLength(1);
      expect(loaded.entries[0][1].value).toBe('val');
      expect(loaded.tagTimestamps).toEqual([['tag-x', 5000]]);
    });
  });

  describe('process isolation', () => {
    it('uses separate files for different process names', async () => {
      const p1 = new CachePersistence('app-a');
      const p2 = new CachePersistence('app-b');

      await p1.save(snap([['key', { value: 'a' }]]));
      await p2.save(snap([['key', { value: 'b' }]]));

      const loaded1 = await p1.load();
      const loaded2 = await p2.load();

      expect(loaded1.entries[0][1].value).toBe('a');
      expect(loaded2.entries[0][1].value).toBe('b');
    });

    it('same process name shares the same file', async () => {
      const p1 = new CachePersistence('app');
      const p2 = new CachePersistence('app');

      await p1.save(snap([['key', { value: 'one' }]]));

      const loaded = await p2.load();
      expect(loaded.entries[0][1].value).toBe('one');
    });
  });
});
