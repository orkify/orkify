import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheStore } from '../../src/cache/CacheStore.js';

describe('CacheStore', () => {
  let store: CacheStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new CacheStore({ maxEntries: 100 });
  });

  afterEach(() => {
    store.destroy();
    vi.useRealTimers();
  });

  describe('get/set', () => {
    it('stores and retrieves a value', () => {
      store.set('key', 'value');
      expect(store.get('key')).toBe('value');
    });

    it('returns undefined for missing key', () => {
      expect(store.get('missing')).toBeUndefined();
    });

    it('stores objects', () => {
      const obj = { name: 'test', count: 42 };
      store.set('obj', obj);
      expect(store.get('obj')).toEqual(obj);
    });

    it('overwrites existing key', () => {
      store.set('key', 'first');
      store.set('key', 'second');
      expect(store.get('key')).toBe('second');
    });

    it('supports generic type parameter', () => {
      store.set('num', 42);
      const val: number | undefined = store.get<number>('num');
      expect(val).toBe(42);
    });
  });

  describe('TTL', () => {
    it('returns value before expiry', () => {
      const expiresAt = Date.now() + 60_000;
      store.set('key', 'value', expiresAt);
      expect(store.get('key')).toBe('value');
    });

    it('returns undefined after expiry', () => {
      const expiresAt = Date.now() + 1000;
      store.set('key', 'value', expiresAt);

      vi.advanceTimersByTime(1001);
      expect(store.get('key')).toBeUndefined();
    });

    it('has() returns false for expired entry', () => {
      const expiresAt = Date.now() + 1000;
      store.set('key', 'value', expiresAt);

      vi.advanceTimersByTime(1001);
      expect(store.has('key')).toBe(false);
    });

    it('stores entry without TTL indefinitely', () => {
      store.set('key', 'value');
      vi.advanceTimersByTime(3_600_000); // 1 hour
      expect(store.get('key')).toBe('value');
    });
  });

  describe('delete', () => {
    it('removes an existing key', () => {
      store.set('key', 'value');
      expect(store.delete('key')).toBe(true);
      expect(store.get('key')).toBeUndefined();
    });

    it('returns false for missing key', () => {
      expect(store.delete('missing')).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      store.set('a', 1);
      store.set('b', 2);
      store.clear();
      expect(store.get('a')).toBeUndefined();
      expect(store.get('b')).toBeUndefined();
      expect(store.stats().size).toBe(0);
    });
  });

  describe('has', () => {
    it('returns true for existing key', () => {
      store.set('key', 'value');
      expect(store.has('key')).toBe(true);
    });

    it('returns false for missing key', () => {
      expect(store.has('missing')).toBe(false);
    });
  });

  describe('stats', () => {
    it('tracks hits and misses', () => {
      store.set('key', 'value');
      store.get('key'); // hit
      store.get('key'); // hit
      store.get('missing'); // miss

      const stats = store.stats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2 / 3);
      expect(stats.size).toBe(1);
    });

    it('returns 0 hitRate when no lookups', () => {
      expect(store.stats().hitRate).toBe(0);
    });

    it('counts expired reads as misses', () => {
      store.set('key', 'value', Date.now() + 1000);
      vi.advanceTimersByTime(1001);
      store.get('key'); // miss (expired)

      expect(store.stats().misses).toBe(1);
      expect(store.stats().hits).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entry when at capacity', () => {
      const small = new CacheStore({ maxEntries: 3 });

      small.set('a', 1);
      vi.advanceTimersByTime(10);
      small.set('b', 2);
      vi.advanceTimersByTime(10);
      small.set('c', 3);
      vi.advanceTimersByTime(10);

      // At capacity, inserting new key should evict 'a' (oldest lastAccessedAt)
      small.set('d', 4);
      expect(small.get('a')).toBeUndefined();
      expect(small.get('b')).toBe(2);
      expect(small.get('c')).toBe(3);
      expect(small.get('d')).toBe(4);

      small.destroy();
    });

    it('accessing a key refreshes its LRU position', () => {
      const small = new CacheStore({ maxEntries: 3 });

      small.set('a', 1);
      vi.advanceTimersByTime(10);
      small.set('b', 2);
      vi.advanceTimersByTime(10);
      small.set('c', 3);
      vi.advanceTimersByTime(10);

      // Access 'a' to refresh it
      small.get('a');
      vi.advanceTimersByTime(10);

      // Now 'b' is the oldest — it should be evicted
      small.set('d', 4);
      expect(small.get('a')).toBe(1);
      expect(small.get('b')).toBeUndefined();

      small.destroy();
    });

    it('does not evict when overwriting existing key', () => {
      const small = new CacheStore({ maxEntries: 2 });

      small.set('a', 1);
      small.set('b', 2);
      // Overwrite 'a' — should not evict anything
      small.set('a', 10);

      expect(small.get('a')).toBe(10);
      expect(small.get('b')).toBe(2);
      expect(small.stats().size).toBe(2);

      small.destroy();
    });
  });

  describe('background sweep', () => {
    it('removes expired entries on sweep interval', () => {
      store.set('a', 1, Date.now() + 30_000);
      store.set('b', 2); // no TTL

      // Advance past the TTL
      vi.advanceTimersByTime(31_000);
      // Advance to sweep interval (60s)
      vi.advanceTimersByTime(30_000);

      // 'a' should have been swept
      expect(store.stats().size).toBe(1);
      expect(store.get('b')).toBe(2);
    });
  });

  describe('applySet', () => {
    it('applies an external set', () => {
      store.applySet('key', 'value', Date.now() + 60_000);
      expect(store.get('key')).toBe('value');
    });
  });

  describe('applyDelete', () => {
    it('applies an external delete', () => {
      store.set('key', 'value');
      store.applyDelete('key');
      expect(store.get('key')).toBeUndefined();
    });
  });

  describe('applySnapshot', () => {
    it('replaces all entries', () => {
      store.set('old', 'data');

      store.applySnapshot([
        ['a', { value: 1 }],
        ['b', { value: 2, expiresAt: Date.now() + 60_000 }],
      ]);

      expect(store.get('old')).toBeUndefined();
      expect(store.get('a')).toBe(1);
      expect(store.get('b')).toBe(2);
    });

    it('skips expired entries in snapshot', () => {
      store.applySnapshot([
        ['fresh', { value: 'yes' }],
        ['stale', { value: 'no', expiresAt: Date.now() - 1000 }],
      ]);

      expect(store.get('fresh')).toBe('yes');
      expect(store.has('stale')).toBe(false);
    });
  });

  describe('serialize', () => {
    it('exports all non-expired entries', () => {
      store.set('a', 1);
      store.set('b', 2, Date.now() + 60_000);
      store.set('expired', 3, Date.now() + 500);

      vi.advanceTimersByTime(501);

      const serialized = store.serialize();
      expect(serialized).toHaveLength(2);

      const keys = serialized.map(([k]) => k);
      expect(keys).toContain('a');
      expect(keys).toContain('b');
      expect(keys).not.toContain('expired');
    });

    it('returns empty array for empty store', () => {
      expect(store.serialize()).toEqual([]);
    });
  });

  describe('tags', () => {
    it('set() with tags creates tag index entries', () => {
      store.set('config:proj1:hostA', 'val1', undefined, ['project:proj1']);
      store.set('config:proj1:hostB', 'val2', undefined, ['project:proj1']);
      expect(store.get('config:proj1:hostA')).toBe('val1');
      expect(store.get('config:proj1:hostB')).toBe('val2');
    });

    it('invalidateTag() deletes all keys with that tag', () => {
      store.set('a', 1, undefined, ['group']);
      store.set('b', 2, undefined, ['group']);
      store.set('c', 3); // no tag
      store.invalidateTag('group');
      expect(store.get('a')).toBeUndefined();
      expect(store.get('b')).toBeUndefined();
      expect(store.get('c')).toBe(3);
    });

    it('invalidateTag() returns the list of deleted keys', () => {
      store.set('x', 1, undefined, ['t']);
      store.set('y', 2, undefined, ['t']);
      const deleted = store.invalidateTag('t');
      expect(deleted).toHaveLength(2);
      expect(deleted).toContain('x');
      expect(deleted).toContain('y');
    });

    it('invalidateTag() for unknown tag returns empty array', () => {
      expect(store.invalidateTag('nonexistent')).toEqual([]);
    });

    it('overwriting a key updates tag associations', () => {
      store.set('key', 1, undefined, ['old-tag']);
      store.set('key', 2, undefined, ['new-tag']);

      // Old tag should no longer have the key
      expect(store.invalidateTag('old-tag')).toEqual([]);
      // New tag should have the key
      expect(store.invalidateTag('new-tag')).toEqual(['key']);
    });

    it('delete() cleans up tag index', () => {
      store.set('key', 1, undefined, ['tag1']);
      store.delete('key');
      expect(store.invalidateTag('tag1')).toEqual([]);
    });

    it('clear() cleans up tag index', () => {
      store.set('a', 1, undefined, ['tag1']);
      store.set('b', 2, undefined, ['tag1']);
      store.clear();
      expect(store.invalidateTag('tag1')).toEqual([]);
    });

    it('serialize() / applySnapshot() round-trips tags', () => {
      store.set('a', 1, undefined, ['group']);
      store.set('b', 2, undefined, ['group', 'extra']);

      const serialized = store.serialize();
      expect(serialized.find(([k]) => k === 'a')?.[1].tags).toEqual(['group']);
      expect(serialized.find(([k]) => k === 'b')?.[1].tags).toEqual(['group', 'extra']);

      const store2 = new CacheStore({ maxEntries: 100 });
      store2.applySnapshot(serialized);
      expect(store2.get('a')).toBe(1);
      expect(store2.get('b')).toBe(2);

      // Tags should be functional after snapshot
      const deleted = store2.invalidateTag('group');
      expect(deleted).toHaveLength(2);
      expect(store2.get('a')).toBeUndefined();
      expect(store2.get('b')).toBeUndefined();
      store2.destroy();
    });

    it('LRU eviction cleans up tag index', () => {
      const small = new CacheStore({ maxEntries: 2 });

      small.set('a', 1, undefined, ['tag']);
      vi.advanceTimersByTime(10);
      small.set('b', 2, undefined, ['tag']);
      vi.advanceTimersByTime(10);

      // Evicts 'a' (oldest)
      small.set('c', 3);
      expect(small.get('a')).toBeUndefined();

      // Tag should only have 'b' now
      const deleted = small.invalidateTag('tag');
      expect(deleted).toEqual(['b']);
      small.destroy();
    });

    it('sweep cleans up tag index for expired entries', () => {
      store.set('expires', 1, Date.now() + 30_000, ['tag']);
      store.set('stays', 2, undefined, ['tag']);

      // Advance past TTL
      vi.advanceTimersByTime(31_000);
      // Advance to sweep interval (60s)
      vi.advanceTimersByTime(30_000);

      // Only 'stays' should remain in the tag
      const deleted = store.invalidateTag('tag');
      expect(deleted).toEqual(['stays']);
    });

    it('key with multiple tags is removed from all tag sets on delete', () => {
      store.set('key', 1, undefined, ['tag1', 'tag2', 'tag3']);
      store.delete('key');
      expect(store.invalidateTag('tag1')).toEqual([]);
      expect(store.invalidateTag('tag2')).toEqual([]);
      expect(store.invalidateTag('tag3')).toEqual([]);
    });
  });

  describe('destroy', () => {
    it('clears entries and stops timer', () => {
      store.set('key', 'value');
      store.destroy();
      expect(store.stats().size).toBe(0);
    });
  });
});
