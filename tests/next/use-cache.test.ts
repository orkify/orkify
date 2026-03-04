import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextCacheEntry, StoredCacheEntry } from '../../src/next/types.js';
import { CacheClient } from '../../src/cache/CacheClient.js';
import { bufferToStream, streamToBuffer } from '../../src/next/stream.js';

// We test the handler logic by importing it and using a real CacheClient
// (standalone mode). The handler module uses the cache singleton, so we
// mock the module to inject a test-scoped CacheClient.

let testClient: CacheClient;

vi.mock('../../src/cache/index.js', () => {
  const proxy = new Proxy(
    {},
    {
      get(_target, prop) {
        const value = Reflect.get(testClient, prop);
        if (typeof value === 'function') {
          return value.bind(testClient);
        }
        return value;
      },
    }
  );
  return { cache: proxy };
});

// Import after mock setup
const { default: handler } = await import('../../src/next/use-cache.js');

function makeEntry(overrides: Partial<NextCacheEntry> = {}): NextCacheEntry {
  return {
    value: bufferToStream(Buffer.from('test-data')),
    tags: ['tag-a'],
    stale: 60,
    timestamp: Date.now(),
    expire: 300,
    revalidate: 60,
    ...overrides,
  };
}

describe('use-cache handler', () => {
  beforeEach(() => {
    testClient = new CacheClient();
  });

  afterEach(() => {
    testClient.destroy();
  });

  describe('get()', () => {
    it('returns undefined for missing key', async () => {
      const result = await handler.get('missing', []);
      expect(result).toBeUndefined();
    });

    it('reconstructs CacheEntry with ReadableStream from stored Buffer', async () => {
      const data = Buffer.from('cached-payload');
      const stored: StoredCacheEntry = {
        buffer: data,
        tags: ['t1'],
        stale: 30,
        timestamp: Date.now(),
        expire: 600,
        revalidate: 120,
      };
      testClient.set('key1', stored);

      const result = await handler.get('key1', []);
      expect(result).toBeDefined();
      if (!result) return;

      expect(result.tags).toEqual(['t1']);
      expect(result.stale).toBe(30);
      expect(result.expire).toBe(600);
      expect(result.revalidate).toBe(120);

      const buf = await streamToBuffer(result.value);
      expect(buf.equals(data)).toBe(true);
    });

    it('returns undefined when hard-expired and deletes the entry', async () => {
      const stored: StoredCacheEntry = {
        buffer: Buffer.from('old'),
        tags: [],
        stale: 0,
        timestamp: Date.now() - 400_000, // 400s ago
        expire: 300, // expired 100s ago
        revalidate: 0,
      };
      testClient.set('expired', stored);

      const result = await handler.get('expired', []);
      expect(result).toBeUndefined();
      // Hard expire deletes the entry from the cache
      expect(testClient.has('expired')).toBe(false);
    });

    it('returns undefined when past revalidate window but keeps the entry', async () => {
      const stored: StoredCacheEntry = {
        buffer: Buffer.from('stale'),
        tags: [],
        stale: 0,
        timestamp: Date.now() - 70_000, // 70s ago
        expire: 300,
        revalidate: 60, // revalidate after 60s
      };
      testClient.set('revalidate-me', stored);

      const result = await handler.get('revalidate-me', []);
      expect(result).toBeUndefined();
      // Unlike hard-expire, revalidate does NOT delete — entry stays for
      // background revalidation to replace it
      expect(testClient.has('revalidate-me')).toBe(true);
    });

    it('returns entry when within revalidate window', async () => {
      const stored: StoredCacheEntry = {
        buffer: Buffer.from('fresh'),
        tags: [],
        stale: 0,
        timestamp: Date.now() - 30_000, // 30s ago
        expire: 300,
        revalidate: 60, // revalidate after 60s — still within window
      };
      testClient.set('fresh-revalidate', stored);

      const result = await handler.get('fresh-revalidate', []);
      expect(result).toBeDefined();
    });

    it('returns undefined when softTag invalidated after entry timestamp', async () => {
      const entryTs = Date.now() - 5000;
      const stored: StoredCacheEntry = {
        buffer: Buffer.from('tagged'),
        tags: ['page'],
        stale: 0,
        timestamp: entryTs,
        expire: 300,
        revalidate: 0,
      };
      testClient.set('soft-tagged', stored);

      // Invalidate the soft tag after the entry was created
      testClient.updateTagTimestamp('soft-tag', entryTs + 1000);

      const result = await handler.get('soft-tagged', ['soft-tag']);
      expect(result).toBeUndefined();
      // Soft-tag invalidation does NOT delete — the entry may still be
      // valid for gets without that soft tag
      expect(testClient.has('soft-tagged')).toBe(true);
    });

    it('returns entry when softTags are empty', async () => {
      const stored: StoredCacheEntry = {
        buffer: Buffer.from('ok'),
        tags: [],
        stale: 0,
        timestamp: Date.now(),
        expire: 300,
        revalidate: 0,
      };
      testClient.set('no-soft', stored);

      const result = await handler.get('no-soft', []);
      expect(result).toBeDefined();
    });

    it('returns entry when softTags are older than entry', async () => {
      const stored: StoredCacheEntry = {
        buffer: Buffer.from('fresh'),
        tags: [],
        stale: 0,
        timestamp: Date.now(),
        expire: 300,
        revalidate: 0,
      };
      testClient.set('fresh-entry', stored);

      // Tag was invalidated before the entry was created
      testClient.updateTagTimestamp('old-tag', stored.timestamp - 1000);

      const result = await handler.get('fresh-entry', ['old-tag']);
      expect(result).toBeDefined();
    });

    it('skips expire check when expire is 0 (indefinite)', async () => {
      const stored: StoredCacheEntry = {
        buffer: Buffer.from('forever'),
        tags: [],
        stale: 0,
        timestamp: Date.now() - 999_999_000, // very old
        expire: 0, // no hard expiration
        revalidate: 0,
      };
      testClient.set('no-expire', stored);

      const result = await handler.get('no-expire', []);
      expect(result).toBeDefined();
    });
  });

  describe('set()', () => {
    it('awaits pendingEntry before storing', async () => {
      let resolve!: (entry: NextCacheEntry) => void;
      const pending = new Promise<NextCacheEntry>((r) => {
        resolve = r;
      });

      const setPromise = handler.set('pending-key', pending);

      // Not stored yet
      expect(testClient.has('pending-key')).toBe(false);

      resolve(makeEntry());
      await setPromise;

      expect(testClient.has('pending-key')).toBe(true);
    });

    it('consumes stream to Buffer and preserves all fields', async () => {
      const data = Buffer.from('stream-content');
      const ts = Date.now() - 5000; // specific timestamp in the past
      const entry = makeEntry({
        value: bufferToStream(data),
        tags: ['a', 'b'],
        stale: 42,
        timestamp: ts,
        expire: 999,
        revalidate: 77,
      });
      await handler.set('stream-key', Promise.resolve(entry));

      const stored = testClient.get<StoredCacheEntry>('stream-key');
      expect(stored).toBeDefined();
      if (!stored) return;

      expect(Buffer.isBuffer(stored.buffer)).toBe(true);
      expect(stored.buffer.equals(data)).toBe(true);
      expect(stored.tags).toEqual(['a', 'b']);
      expect(stored.stale).toBe(42);
      expect(stored.timestamp).toBe(ts); // preserves original, not Date.now()
      expect(stored.expire).toBe(999);
      expect(stored.revalidate).toBe(77);
    });

    it('uses expire as TTL', async () => {
      vi.useFakeTimers();
      const localClient = new CacheClient();
      const prev = testClient;
      testClient = localClient;

      const entry = makeEntry({ expire: 2 });
      await handler.set('ttl-key', Promise.resolve(entry));

      expect(localClient.has('ttl-key')).toBe(true);

      vi.advanceTimersByTime(2001);

      expect(localClient.has('ttl-key')).toBe(false);

      testClient = prev;
      localClient.destroy();
      vi.useRealTimers();
    });

    it('handles expire=0 (no TTL)', async () => {
      const entry = makeEntry({ expire: 0 });
      await handler.set('no-ttl', Promise.resolve(entry));

      const stored = testClient.get<StoredCacheEntry>('no-ttl');
      expect(stored).toBeDefined();
      if (!stored) return;

      expect(stored.expire).toBe(0);
    });
  });

  describe('refreshTags()', () => {
    it('resolves without error', async () => {
      await expect(handler.refreshTags()).resolves.toBeUndefined();
    });
  });

  describe('getExpiration()', () => {
    it('delegates to cache.getTagExpiration', async () => {
      testClient.invalidateTag('exp-tag');
      const ts = testClient.getTagExpiration(['exp-tag']);

      const result = await handler.getExpiration(['exp-tag']);
      expect(result).toBe(ts);
    });

    it('returns 0 for unknown tags', async () => {
      const result = await handler.getExpiration(['never-invalidated']);
      expect(result).toBe(0);
    });
  });

  describe('updateTags()', () => {
    it('without durations calls invalidateTag', async () => {
      testClient.set('a', 'val', { tags: ['group'] });
      await handler.updateTags(['group']);

      expect(testClient.has('a')).toBe(false);
      expect(testClient.getTagExpiration(['group'])).toBeGreaterThan(0);
    });

    it('without durations invalidates multiple tags', async () => {
      testClient.set('x', 1, { tags: ['alpha'] });
      testClient.set('y', 2, { tags: ['beta'] });
      testClient.set('z', 3); // no tags

      await handler.updateTags(['alpha', 'beta']);

      expect(testClient.has('x')).toBe(false);
      expect(testClient.has('y')).toBe(false);
      expect(testClient.has('z')).toBe(true);
    });

    it('with durations.expire sets future timestamp', async () => {
      const before = Date.now();
      await handler.updateTags(['future-tag'], { expire: 120 });
      const after = Date.now();

      const ts = testClient.getTagExpiration(['future-tag']);
      expect(ts).toBeGreaterThanOrEqual(before + 120 * 1000);
      expect(ts).toBeLessThanOrEqual(after + 120 * 1000);
    });

    it('with durations.expire does not delete entries', async () => {
      testClient.set('keep-me', 'val', { tags: ['soft'] });

      await handler.updateTags(['soft'], { expire: 60 });

      // updateTagTimestamp sets a future expiry but does not delete entries
      // (unlike invalidateTag which deletes immediately)
      expect(testClient.has('keep-me')).toBe(true);
    });
  });

  describe('revalidation coalescing', () => {
    it('returns stale content when revalidation lock exists', async () => {
      const stored: StoredCacheEntry = {
        buffer: Buffer.from('stale-data'),
        tags: [],
        stale: 0,
        timestamp: Date.now() - 70_000, // 70s ago
        expire: 300,
        revalidate: 60, // revalidate after 60s
      };
      testClient.set('coal-key', stored);

      // First get() should return undefined and set the lock
      const first = await handler.get('coal-key', []);
      expect(first).toBeUndefined();

      // Second get() should return stale content (lock exists)
      const second = await handler.get('coal-key', []);
      expect(second).toBeDefined();
      if (!second) return;
      const buf = await streamToBuffer(second.value);
      expect(buf.equals(Buffer.from('stale-data'))).toBe(true);
      expect(second.tags).toEqual([]);
      expect(second.expire).toBe(300);
      expect(second.revalidate).toBe(60);
    });

    it('returns undefined when no revalidation lock exists (triggers revalidation)', async () => {
      const stored: StoredCacheEntry = {
        buffer: Buffer.from('stale'),
        tags: [],
        stale: 0,
        timestamp: Date.now() - 70_000,
        expire: 300,
        revalidate: 60,
      };
      testClient.set('no-lock', stored);

      // No lock set — should return undefined
      const result = await handler.get('no-lock', []);
      expect(result).toBeUndefined();
    });

    it('clears revalidation lock after set()', async () => {
      const stored: StoredCacheEntry = {
        buffer: Buffer.from('old'),
        tags: [],
        stale: 0,
        timestamp: Date.now() - 70_000,
        expire: 300,
        revalidate: 60,
      };
      testClient.set('clear-lock', stored);

      // Trigger revalidation (sets the lock)
      await handler.get('clear-lock', []);
      expect(testClient.has('__revalidating:clear-lock')).toBe(true);

      // set() should clear the lock
      const freshEntry = makeEntry({ timestamp: Date.now() });
      await handler.set('clear-lock', Promise.resolve(freshEntry));
      expect(testClient.has('__revalidating:clear-lock')).toBe(false);
    });

    it('revalidation lock auto-expires after TTL', async () => {
      vi.useFakeTimers();
      const localClient = new CacheClient();
      const prev = testClient;
      testClient = localClient;

      const stored: StoredCacheEntry = {
        buffer: Buffer.from('stale'),
        tags: [],
        stale: 0,
        timestamp: Date.now() - 70_000,
        expire: 300,
        revalidate: 60,
      };
      localClient.set('ttl-lock', stored);

      // Trigger revalidation (sets lock with 30s TTL)
      await handler.get('ttl-lock', []);
      expect(localClient.has('__revalidating:ttl-lock')).toBe(true);

      // Advance past lock TTL (30s)
      vi.advanceTimersByTime(31_000);

      expect(localClient.has('__revalidating:ttl-lock')).toBe(false);

      testClient = prev;
      localClient.destroy();
      vi.useRealTimers();
    });

    it('soft tag invalidation is NOT coalesced (returns undefined even if lock exists)', async () => {
      const entryTs = Date.now() - 5000;
      const stored: StoredCacheEntry = {
        buffer: Buffer.from('tagged'),
        tags: ['page'],
        stale: 0,
        timestamp: entryTs,
        expire: 300,
        revalidate: 0, // no revalidation window
      };
      testClient.set('soft-coal', stored);

      // Set a revalidation lock (shouldn't matter for soft tag invalidation)
      testClient.set('__revalidating:soft-coal', true, { ttl: 30 });

      // Invalidate the soft tag
      testClient.updateTagTimestamp('soft-tag-coal', entryTs + 1000);

      // Should return undefined — soft tag invalidation is not coalesced
      const result = await handler.get('soft-coal', ['soft-tag-coal']);
      expect(result).toBeUndefined();
    });

    it('hard expiration is NOT coalesced (deletes and returns undefined)', async () => {
      const stored: StoredCacheEntry = {
        buffer: Buffer.from('expired'),
        tags: [],
        stale: 0,
        timestamp: Date.now() - 400_000,
        expire: 300, // expired 100s ago
        revalidate: 60,
      };
      testClient.set('hard-coal', stored);

      // Set a revalidation lock (shouldn't matter for hard expiration)
      testClient.set('__revalidating:hard-coal', true, { ttl: 30 });

      const result = await handler.get('hard-coal', []);
      expect(result).toBeUndefined();
      expect(testClient.has('hard-coal')).toBe(false);
    });
  });

  describe('integration', () => {
    it('set -> get round-trip preserves data', async () => {
      const data = Buffer.from('round-trip-data');
      const entry = makeEntry({
        value: bufferToStream(data),
        tags: ['rt'],
        stale: 10,
        timestamp: Date.now(),
        expire: 600,
        revalidate: 120,
      });

      await handler.set('rt-key', Promise.resolve(entry));
      const result = await handler.get('rt-key', []);

      expect(result).toBeDefined();
      if (!result) return;

      expect(result.tags).toEqual(['rt']);
      expect(result.stale).toBe(10);
      expect(result.expire).toBe(600);
      expect(result.revalidate).toBe(120);

      const buf = await streamToBuffer(result.value);
      expect(buf.equals(data)).toBe(true);
    });

    it('set -> invalidate tag -> get returns undefined', async () => {
      const entry = makeEntry({
        value: bufferToStream(Buffer.from('tagged-data')),
        tags: ['inv-tag'],
        timestamp: Date.now(),
      });

      await handler.set('inv-key', Promise.resolve(entry));
      expect(testClient.has('inv-key')).toBe(true);

      await handler.updateTags(['inv-tag']);

      // The entry was deleted by invalidateTag
      expect(testClient.has('inv-key')).toBe(false);
    });

    it('set -> updateTags with expire -> get returns undefined (soft tag stale)', async () => {
      const ts = Date.now();
      const entry = makeEntry({
        value: bufferToStream(Buffer.from('soft-expire')),
        tags: ['page'],
        timestamp: ts,
      });

      await handler.set('se-key', Promise.resolve(entry));

      // Set the tag expiry to the future — entry's timestamp is older
      await handler.updateTags(['page'], { expire: 60 });

      // get() with 'page' as a soft tag should see it's invalidated
      const result = await handler.get('se-key', ['page']);
      expect(result).toBeUndefined();

      // But the entry itself still exists (not deleted)
      expect(testClient.has('se-key')).toBe(true);
    });

    it('multiple gets return independent streams', async () => {
      const data = Buffer.from('multi-read');
      const entry = makeEntry({
        value: bufferToStream(data),
        timestamp: Date.now(),
        expire: 600,
        revalidate: 0,
      });

      await handler.set('multi', Promise.resolve(entry));

      // Each get() should return a fresh, consumable stream
      const r1 = await handler.get('multi', []);
      const r2 = await handler.get('multi', []);

      expect(r1).toBeDefined();
      expect(r2).toBeDefined();
      if (!r1 || !r2) return;

      const b1 = await streamToBuffer(r1.value);
      const b2 = await streamToBuffer(r2.value);
      expect(b1.equals(data)).toBe(true);
      expect(b2.equals(data)).toBe(true);
    });
  });
});
