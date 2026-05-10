import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IncrDedupCache } from '../../packages/cache/src/IncrDedupCache.js';

describe('IncrDedupCache', () => {
  let cache: IncrDedupCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new IncrDedupCache();
  });

  afterEach(() => {
    cache.destroy();
    vi.useRealTimers();
  });

  describe('get/record', () => {
    it('returns undefined for unknown key', () => {
      expect(cache.get('missing')).toBeUndefined();
    });

    it('record + get round-trips a success entry', () => {
      cache.record('k', { value: 42, expiresAt: 1000, tags: ['t'] });
      const entry = cache.get('k');
      expect(entry).toBeDefined();
      expect(entry?.value).toBe(42);
      expect(entry?.expiresAt).toBe(1000);
      expect(entry?.tags).toEqual(['t']);
      expect(entry?.error).toBeUndefined();
    });

    it('record + get round-trips an error entry', () => {
      cache.record('k', { error: 'boom' });
      const entry = cache.get('k');
      expect(entry?.error).toBe('boom');
      expect(entry?.value).toBeUndefined();
    });

    it('record sets timestamp to Date.now()', () => {
      const before = Date.now();
      cache.record('k', { value: 1 });
      const after = Date.now();
      const entry = cache.get('k');
      expect(entry?.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry?.timestamp).toBeLessThanOrEqual(after);
    });

    it('record overwrites an existing entry (same key)', () => {
      cache.record('k', { value: 1 });
      cache.record('k', { value: 99 });
      expect(cache.get('k')?.value).toBe(99);
    });
  });

  describe('TTL expiry', () => {
    it('returns the entry within the TTL window', () => {
      cache.record('k', { value: 1 });
      vi.advanceTimersByTime(30_000);
      expect(cache.get('k')?.value).toBe(1);
    });

    it('returns undefined and lazily evicts after TTL', () => {
      cache.record('k', { value: 1 });
      vi.advanceTimersByTime(60_001);
      expect(cache.get('k')).toBeUndefined();
    });

    it('sweep removes expired entries on interval', () => {
      cache.record('a', { value: 1 });
      vi.advanceTimersByTime(60_001);
      // Advance past the sweep interval (60s by CACHE_CLEANUP_INTERVAL)
      vi.advanceTimersByTime(60_000);
      // Even without an explicit get, the entry should be gone
      expect(cache.get('a')).toBeUndefined();
    });

    it('sweep stops at first non-expired entry (insertion order)', () => {
      // Older entry that will expire
      cache.record('old', { value: 1 });
      vi.advanceTimersByTime(40_000);
      // Newer entry that should survive
      cache.record('new', { value: 2 });

      // Advance past the older entry's TTL only (40 + 21 = 61s for old, 21s for new)
      vi.advanceTimersByTime(60_000);

      expect(cache.get('old')).toBeUndefined();
      expect(cache.get('new')?.value).toBe(2);
    });
  });

  describe('FIFO eviction at maxSize', () => {
    it('evicts the oldest entry when at capacity', () => {
      const small = new IncrDedupCache({ maxSize: 3 });

      small.record('a', { value: 1 });
      small.record('b', { value: 2 });
      small.record('c', { value: 3 });
      small.record('d', { value: 4 }); // forces eviction of 'a'

      expect(small.get('a')).toBeUndefined();
      expect(small.get('b')?.value).toBe(2);
      expect(small.get('c')?.value).toBe(3);
      expect(small.get('d')?.value).toBe(4);

      small.destroy();
    });

    it('eviction order is strictly FIFO regardless of read access', () => {
      const small = new IncrDedupCache({ maxSize: 2 });

      small.record('a', { value: 1 });
      small.record('b', { value: 2 });
      // Read 'a' — should NOT change eviction order (unlike LRU)
      small.get('a');
      small.record('c', { value: 3 }); // evicts 'a' (oldest), not 'b'

      expect(small.get('a')).toBeUndefined();
      expect(small.get('b')?.value).toBe(2);
      expect(small.get('c')?.value).toBe(3);

      small.destroy();
    });

    it('overwriting a key (below capacity) moves it to the end of FIFO order', () => {
      // Critical: overwrite must happen BELOW capacity so the eviction loop
      // doesn't fire. Otherwise the eviction's delete-oldest happens to evict
      // the same key we're re-inserting, masking a missing delete-then-insert.
      const small = new IncrDedupCache({ maxSize: 5 });

      small.record('a', { value: 1 });
      small.record('b', { value: 2 });
      small.record('c', { value: 3 });
      // Overwrite 'a' below capacity — must move 'a' to the end so 'b' becomes oldest
      small.record('a', { value: 99 });

      // Fill to capacity, then push past — oldest should be 'b' (not 'a')
      small.record('d', { value: 4 });
      small.record('e', { value: 5 });
      small.record('f', { value: 6 }); // size now 6 → evict oldest

      expect(small.get('b')).toBeUndefined(); // would be defined (=2) if 'a' hadn't moved
      expect(small.get('a')?.value).toBe(99);
      expect(small.get('c')?.value).toBe(3);
      expect(small.get('d')?.value).toBe(4);
      expect(small.get('e')?.value).toBe(5);
      expect(small.get('f')?.value).toBe(6);

      small.destroy();
    });

    it('sweep does NOT strand a stale entry positioned after an overwritten key', () => {
      // The bug being tested: without delete-then-insert, an overwrite keeps
      // the original insertion position but with a fresh timestamp. Sweep
      // iterates in insertion order and breaks at the first non-expired entry,
      // so any older-but-now-stale entries between the original and the
      // overwrite get stranded forever (until lazy expiry on read removes them).
      //
      // We use sweepIntervalMs to control sweep timing AND set ttlMs longer
      // than the test setup window so background sweeps during setup don't
      // remove entries before we're ready to assert.
      const c = new IncrDedupCache({ ttlMs: 5000, sweepIntervalMs: 100 });

      c.record('k', { value: 1 }); // t=0,    ts=0
      vi.advanceTimersByTime(500);
      c.record('stale', { value: 1 }); // t=500,  ts=500
      vi.advanceTimersByTime(2000);
      c.record('k', { value: 99 }); // t=2500, OVERWRITE
      // Without fix: Map = [k@p0 ts=2500, stale@p1 ts=500]   (k stays at original pos)
      // With fix:    Map = [stale@p0 ts=500, k@p1 ts=2500]   (k moved to end)

      expect(c.size).toBe(2);

      // Advance until 'stale' is expired (ts=500 + ttl=5000 → expires at 5500)
      // but 'k' is still fresh (ts=2500 + 5000 → expires at 7500).
      vi.advanceTimersByTime(3200); // t=5700

      // Sweeps have been firing every 100ms. The first sweep where 'stale'
      // is expired (cutoff > 500) is at t=5600. By t=5700 at least one such
      // sweep has run. Per the bug, without the fix it visits 'k' first
      // (fresh) and breaks before reaching 'stale'.
      //
      // With the fix: 'stale' has been deleted → size = 1.
      // Without the fix: 'stale' is stranded → size = 2.
      expect(c.size).toBe(1);

      c.destroy();
    });
  });

  describe('custom options', () => {
    it('honors custom ttlMs', () => {
      const short = new IncrDedupCache({ ttlMs: 1000 });
      short.record('k', { value: 1 });

      vi.advanceTimersByTime(500);
      expect(short.get('k')?.value).toBe(1);

      vi.advanceTimersByTime(501);
      expect(short.get('k')).toBeUndefined();

      short.destroy();
    });

    it('honors custom maxSize', () => {
      const tiny = new IncrDedupCache({ maxSize: 1 });

      tiny.record('a', { value: 1 });
      tiny.record('b', { value: 2 });

      expect(tiny.get('a')).toBeUndefined();
      expect(tiny.get('b')?.value).toBe(2);

      tiny.destroy();
    });
  });

  describe('destroy', () => {
    it('clears all entries', () => {
      cache.record('a', { value: 1 });
      cache.record('b', { value: 2 });
      cache.destroy();
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
    });

    it('stops the sweep timer (no work after destroy)', () => {
      const c = new IncrDedupCache();
      c.record('k', { value: 1 });
      c.destroy();

      // Advance well past sweep interval — destroy should have stopped the timer.
      // If it hadn't, the (still-extant) entries map would have been swept against
      // a stale timer reference. We just verify no crash + map stays empty.
      vi.advanceTimersByTime(120_000);
      expect(c.get('k')).toBeUndefined();
    });

    it('is safe to call multiple times', () => {
      cache.destroy();
      expect(() => cache.destroy()).not.toThrow();
    });
  });
});
