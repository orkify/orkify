import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheFileStore } from '../../packages/cache/src/CacheFileStore.js';

const TEST_PROCESS_NAME = '__test_cachefilestore__';
const TEST_CACHE_DIR = join(process.env.HOME ?? '.', '.orkify', 'cache', TEST_PROCESS_NAME);

describe('CacheFileStore', () => {
  let store: CacheFileStore;

  beforeEach(async () => {
    vi.useFakeTimers();
    // Clean up test cache directory
    await rm(TEST_CACHE_DIR, { recursive: true, force: true });
    store = new CacheFileStore(TEST_PROCESS_NAME, {
      maxEntries: 3,
      maxMemorySize: 200,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    store.destroy();
    // Wait for pending disk writes to settle before cleanup
    await new Promise((r) => setTimeout(r, 50));
    await rm(TEST_CACHE_DIR, { recursive: true, force: true });
  });

  describe('get() — sync hot path', () => {
    it('returns from memory', () => {
      store.set('key', 'hello');
      expect(store.get<string>('key')).toBe('hello');
    });

    it('returns undefined for missing key', () => {
      expect(store.get('missing')).toBeUndefined();
    });

    it('does not read from disk', async () => {
      // Fill memory past capacity so entries spill to disk
      store.set('a', 'one');
      vi.advanceTimersByTime(10);
      store.set('b', 'two');
      vi.advanceTimersByTime(10);
      store.set('c', 'three');
      vi.advanceTimersByTime(10);
      store.set('d', 'four'); // evicts 'a' to disk
      vi.advanceTimersByTime(10);

      // Wait for disk writes to complete
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 50));
      vi.useFakeTimers();

      // Sync get should NOT find disk entries
      expect(store.get('a')).toBeUndefined();
    });
  });

  describe('getAsync() — memory + disk', () => {
    it('falls through to disk on memory miss', async () => {
      store.set('a', 'one');
      vi.advanceTimersByTime(10);
      store.set('b', 'two');
      vi.advanceTimersByTime(10);
      store.set('c', 'three');
      vi.advanceTimersByTime(10);
      store.set('d', 'four'); // evicts 'a' to disk

      // Wait for disk write
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 50));

      // Async get should find 'a' on disk
      const result = await store.getAsync<string>('a');
      expect(result).toBe('one');
    });

    it('promotes disk entry to memory', async () => {
      store.set('a', 'one');
      vi.advanceTimersByTime(10);
      store.set('b', 'two');
      vi.advanceTimersByTime(10);
      store.set('c', 'three');
      vi.advanceTimersByTime(10);
      store.set('d', 'four'); // evicts 'a' to disk

      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 50));

      // Promote 'a' back to memory
      await store.getAsync<string>('a');

      // Now sync get should find it
      expect(store.get<string>('a')).toBe('one');
    });

    it('returns undefined for true miss (not in memory or disk)', async () => {
      vi.useRealTimers();
      const result = await store.getAsync<string>('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('eviction to disk', () => {
    it('evicted entry is written to disk', async () => {
      store.set('a', 'one');
      vi.advanceTimersByTime(10);
      store.set('b', 'two');
      vi.advanceTimersByTime(10);
      store.set('c', 'three');
      vi.advanceTimersByTime(10);
      store.set('d', 'four'); // evicts 'a'

      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 100));

      // Check that the entries directory exists and has a file
      const entriesDir = join(TEST_CACHE_DIR, 'entries');
      expect(existsSync(entriesDir)).toBe(true);
      const files = await readdir(entriesDir);
      expect(files.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('TTL on disk', () => {
    it('disk entry expires and is cleaned up', async () => {
      vi.useRealTimers();

      const timedStore = new CacheFileStore(TEST_PROCESS_NAME, {
        maxEntries: 2,
      });

      // Set entry with short TTL, then evict to disk
      const expiresAt = Date.now() + 100; // 100ms from now
      timedStore.set('expires', 'val', expiresAt);
      timedStore.set('b', 'two');
      timedStore.set('c', 'three'); // evicts 'expires' to disk

      await new Promise((r) => setTimeout(r, 50));

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 100));

      // getAsync should return undefined for expired disk entry
      const result = await timedStore.getAsync<string>('expires');
      expect(result).toBeUndefined();

      timedStore.destroy();
    });
  });

  describe('tag invalidation', () => {
    it('invalidateTag deletes from memory and disk', async () => {
      store.set('a', 'one', undefined, ['group']);
      vi.advanceTimersByTime(10);
      store.set('b', 'two', undefined, ['group']);
      vi.advanceTimersByTime(10);
      store.set('c', 'three');
      vi.advanceTimersByTime(10);
      store.set('d', 'four'); // evicts 'a' to disk

      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 50));

      // Invalidate the tag — should clear both memory and disk entries with that tag
      store.invalidateTag('group');

      await new Promise((r) => setTimeout(r, 50));

      // Memory entry 'b' should be gone
      expect(store.get('b')).toBeUndefined();
      // Disk entry 'a' should be gone
      const result = await store.getAsync<string>('a');
      expect(result).toBeUndefined();
      // Non-tagged entries should survive
      expect(store.get('c')).toBeDefined();
    });

    it('tag timestamps are checked on disk reads', async () => {
      vi.useRealTimers();

      const tagStore = new CacheFileStore(TEST_PROCESS_NAME, {
        maxEntries: 2,
      });

      tagStore.set('a', 'one', undefined, ['group']);
      tagStore.set('b', 'two');
      tagStore.set('c', 'three'); // evicts 'a' to disk

      await new Promise((r) => setTimeout(r, 50));

      // Invalidate the tag after eviction — should record timestamp
      tagStore.invalidateTag('group');

      await new Promise((r) => setTimeout(r, 50));

      // getAsync should return undefined because the tag was invalidated
      const result = await tagStore.getAsync<string>('a');
      expect(result).toBeUndefined();

      tagStore.destroy();
    });
  });

  describe('shutdown and startup', () => {
    it('shutdown flushes in-memory entries to disk', async () => {
      vi.useRealTimers();

      const flushStore = new CacheFileStore(TEST_PROCESS_NAME, {
        maxEntries: 100,
      });

      flushStore.set('x', 'hello');
      flushStore.set('y', 'world');

      await flushStore.flush();

      // Verify index was written
      expect(existsSync(join(TEST_CACHE_DIR, 'index.json'))).toBe(true);

      // Verify entries were written
      const entriesDir = join(TEST_CACHE_DIR, 'entries');
      const files = await readdir(entriesDir);
      expect(files.length).toBe(2);

      flushStore.destroy();
    });

    it('startup loads disk index, promotes lazily', async () => {
      vi.useRealTimers();

      // Phase 1: populate and flush
      const store1 = new CacheFileStore(TEST_PROCESS_NAME, { maxEntries: 100 });
      store1.set('a', 'hello');
      store1.set('b', 'world');
      await store1.flush();
      store1.destroy();

      // Phase 2: new store loads index
      const store2 = new CacheFileStore(TEST_PROCESS_NAME, { maxEntries: 100 });
      await store2.loadIndex();

      // Sync get should return undefined (not loaded into memory yet)
      expect(store2.get('a')).toBeUndefined();

      // Async get should promote from disk
      const val = await store2.getAsync<string>('a');
      expect(val).toBe('hello');

      // Now sync get should work
      expect(store2.get<string>('a')).toBe('hello');

      store2.destroy();
    });
  });

  describe('disk sweep', () => {
    it('disk sweep cleans expired entries', async () => {
      vi.useRealTimers();

      const sweepStore = new CacheFileStore(TEST_PROCESS_NAME, {
        maxEntries: 2,
      });

      const expiresAt = Date.now() + 100;
      sweepStore.set('expires', 'val', expiresAt);
      sweepStore.set('b', 'two');
      sweepStore.set('c', 'three'); // evicts 'expires' to disk

      await new Promise((r) => setTimeout(r, 200));

      // Entry should have expired — getAsync returns undefined
      const result = await sweepStore.getAsync<string>('expires');
      expect(result).toBeUndefined();

      sweepStore.destroy();
    });
  });

  describe('clear()', () => {
    it('removes memory and disk entries', async () => {
      store.set('a', 'one');
      vi.advanceTimersByTime(10);
      store.set('b', 'two');
      vi.advanceTimersByTime(10);
      store.set('c', 'three');
      vi.advanceTimersByTime(10);
      store.set('d', 'four'); // evicts 'a' to disk

      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 50));

      store.clear();

      await new Promise((r) => setTimeout(r, 50));

      expect(store.stats().size).toBe(0);
      const result = await store.getAsync<string>('a');
      expect(result).toBeUndefined();
    });
  });

  describe('has() with disk entries', () => {
    it('returns false for expired disk entry', async () => {
      vi.useRealTimers();

      const timedStore = new CacheFileStore(TEST_PROCESS_NAME, {
        maxEntries: 2,
      });

      const expiresAt = Date.now() + 100; // 100ms TTL
      timedStore.set('expires', 'val', expiresAt);
      timedStore.set('b', 'two');
      timedStore.set('c', 'three'); // evicts 'expires' to disk

      await new Promise((r) => setTimeout(r, 50));

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 100));

      // has() should return false for expired disk entry
      expect(timedStore.has('expires')).toBe(false);

      timedStore.destroy();
    });

    it('returns true for non-expired disk entry', async () => {
      store.set('a', 'one');
      vi.advanceTimersByTime(10);
      store.set('b', 'two');
      vi.advanceTimersByTime(10);
      store.set('c', 'three');
      vi.advanceTimersByTime(10);
      store.set('d', 'four'); // evicts 'a' to disk

      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 50));

      // has() should find non-expired disk entry
      expect(store.has('a')).toBe(true);
    });
  });

  describe('stats() with disk entries', () => {
    it('includes diskSize count', async () => {
      store.set('a', 'one');
      vi.advanceTimersByTime(10);
      store.set('b', 'two');
      vi.advanceTimersByTime(10);
      store.set('c', 'three');
      vi.advanceTimersByTime(10);
      store.set('d', 'four'); // evicts 'a' to disk

      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 50));

      const stats = store.stats();
      expect(stats.size).toBe(3); // b, c, d in memory
      expect(stats.diskSize).toBe(1); // 'a' on disk
    });

    it('diskSize is 0 when no entries on disk', () => {
      store.set('a', 'one');
      const stats = store.stats();
      expect(stats.diskSize).toBe(0);
    });
  });

  describe('persistIndex concurrency', () => {
    it('handles concurrent changes without losing updates', async () => {
      vi.useRealTimers();

      const concStore = new CacheFileStore(TEST_PROCESS_NAME, {
        maxEntries: 2,
      });

      // Rapidly set entries that evict each other, causing many concurrent persistIndex calls
      concStore.set('a', 'one');
      concStore.set('b', 'two');
      concStore.set('c', 'three'); // evicts 'a' → writeToDisk → persistIndex
      concStore.set('d', 'four'); // evicts 'b' → writeToDisk → persistIndex
      concStore.set('e', 'five'); // evicts 'c' → writeToDisk → persistIndex

      // Wait for all async disk operations to settle
      await new Promise((r) => setTimeout(r, 200));

      // Create a new store and load the index — should find all evicted entries
      const verifyStore = new CacheFileStore(TEST_PROCESS_NAME, { maxEntries: 100 });
      await verifyStore.loadIndex();

      // All evicted entries (a, b, c) should be recoverable from disk
      const a = await verifyStore.getAsync<string>('a');
      const b = await verifyStore.getAsync<string>('b');
      const c = await verifyStore.getAsync<string>('c');
      expect(a).toBe('one');
      expect(b).toBe('two');
      expect(c).toBe('three');

      concStore.destroy();
      verifyStore.destroy();
    });
  });

  describe('readOnly mode', () => {
    it('getAsync reads from disk files written by another store', async () => {
      vi.useRealTimers();

      // Full store writes entries and evicts to disk
      const fullStore = new CacheFileStore(TEST_PROCESS_NAME, {
        maxEntries: 2,
      });
      fullStore.set('a', 'hello');
      fullStore.set('b', 'world');
      fullStore.set('c', 'evicts-a'); // evicts 'a' to disk

      await new Promise((r) => setTimeout(r, 100));

      // ReadOnly store should be able to read 'a' from disk (written by fullStore)
      const roStore = new CacheFileStore(TEST_PROCESS_NAME, { maxEntries: 10 }, { readOnly: true });

      const val = await roStore.getAsync<string>('a');
      expect(val).toBe('hello');

      // Sync get should not find it (not in readOnly's memory yet? — actually promote puts it in memory)
      expect(roStore.get<string>('a')).toBe('hello');

      fullStore.destroy();
      roStore.destroy();
    });

    it('does not write to disk on eviction', async () => {
      vi.useRealTimers();

      const roStore = new CacheFileStore(TEST_PROCESS_NAME, { maxEntries: 2 }, { readOnly: true });

      roStore.set('a', 'one');
      roStore.set('b', 'two');
      roStore.set('c', 'three'); // evicts 'a', but no onEvict so no disk write

      await new Promise((r) => setTimeout(r, 50));

      // 'a' should be gone from memory and NOT recoverable (no disk write happened)
      expect(roStore.get('a')).toBeUndefined();
      const result = await roStore.getAsync<string>('a');
      expect(result).toBeUndefined();

      roStore.destroy();
    });

    it('flush is a no-op', async () => {
      vi.useRealTimers();

      const roStore = new CacheFileStore(TEST_PROCESS_NAME, { maxEntries: 10 }, { readOnly: true });

      roStore.set('a', 'hello');
      await roStore.flush();

      // No files should have been written
      const entriesDir = join(TEST_CACHE_DIR, 'entries');
      expect(existsSync(entriesDir)).toBe(false);

      roStore.destroy();
    });

    it('loadIndex is a no-op', async () => {
      vi.useRealTimers();

      // Create index file via full store
      const fullStore = new CacheFileStore(TEST_PROCESS_NAME, { maxEntries: 100 });
      fullStore.set('a', 'hello');
      await fullStore.flush();
      fullStore.destroy();

      // ReadOnly store's loadIndex should be a no-op
      const roStore = new CacheFileStore(
        TEST_PROCESS_NAME,
        { maxEntries: 100 },
        { readOnly: true }
      );
      await roStore.loadIndex();

      // diskIndex wasn't populated, so has() returns false
      expect(roStore.has('a')).toBe(false);
      // But getAsync can still read the file directly
      const val = await roStore.getAsync<string>('a');
      expect(val).toBe('hello');

      roStore.destroy();
    });
  });
});
