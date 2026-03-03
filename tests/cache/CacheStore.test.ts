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

  describe('destroy', () => {
    it('clears entries and stops timer', () => {
      store.set('key', 'value');
      store.destroy();
      expect(store.stats().size).toBe(0);
    });
  });
});
