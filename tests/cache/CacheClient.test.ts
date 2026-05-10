import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheClient } from '../../packages/cache/src/CacheClient.js';

describe('CacheClient', () => {
  let client: CacheClient;
  const originalEnv = process.env.ORKIFY_CLUSTER_MODE;
  const originalSend = process.send;

  beforeEach(() => {
    // Default to standalone mode
    process.env.ORKIFY_CLUSTER_MODE = undefined;
    process.send = undefined;
    client = new CacheClient();
  });

  afterEach(() => {
    client.destroy();
    process.env.ORKIFY_CLUSTER_MODE = originalEnv;
    process.send = originalSend;
  });

  describe('standalone mode', () => {
    it('get/set/has/delete work as a local cache', () => {
      client.set('key', 'value');
      expect(client.get('key')).toBe('value');
      expect(client.has('key')).toBe(true);

      client.delete('key');
      expect(client.get('key')).toBeUndefined();
      expect(client.has('key')).toBe(false);
    });

    it('clear removes all entries', () => {
      client.set('a', 1);
      client.set('b', 2);
      client.clear();
      expect(client.stats().size).toBe(0);
    });

    it('stats returns cache statistics', () => {
      client.set('key', 'value');
      client.get('key'); // hit
      client.get('missing'); // miss

      const stats = client.stats();
      expect(stats.size).toBe(1);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.5);
    });

    it('does not call process.send in standalone mode', () => {
      const sendSpy = vi.fn();
      process.send = sendSpy;
      // Create a new client in standalone mode (ORKIFY_CLUSTER_MODE not set)
      const standaloneClient = new CacheClient();

      standaloneClient.set('key', 'value');
      standaloneClient.delete('key');
      standaloneClient.clear();

      expect(sendSpy).not.toHaveBeenCalled();
      standaloneClient.destroy();
    });
  });

  describe('TTL', () => {
    it('respects TTL on set', () => {
      vi.useFakeTimers();
      const ttlClient = new CacheClient();

      ttlClient.set('key', 'value', { ttl: 1 });
      expect(ttlClient.get('key')).toBe('value');

      vi.advanceTimersByTime(1001);
      expect(ttlClient.get('key')).toBeUndefined();

      ttlClient.destroy();
      vi.useRealTimers();
    });

    it('throws on ttl <= 0', () => {
      expect(() => client.set('key', 'value', { ttl: 0 })).toThrow('ttl must be positive');
      expect(() => client.set('key', 'value', { ttl: -5 })).toThrow('ttl must be positive');
    });

    it('uses defaultTtl when no per-key ttl is specified', () => {
      vi.useFakeTimers();
      const ttlClient = new CacheClient({ defaultTtl: 2 });

      ttlClient.set('key', 'value');
      expect(ttlClient.get('key')).toBe('value');

      vi.advanceTimersByTime(2001);
      expect(ttlClient.get('key')).toBeUndefined();

      ttlClient.destroy();
      vi.useRealTimers();
    });

    it('per-key ttl overrides defaultTtl', () => {
      vi.useFakeTimers();
      const ttlClient = new CacheClient({ defaultTtl: 10 });

      ttlClient.set('key', 'value', { ttl: 1 });
      expect(ttlClient.get('key')).toBe('value');

      vi.advanceTimersByTime(1001);
      expect(ttlClient.get('key')).toBeUndefined();

      ttlClient.destroy();
      vi.useRealTimers();
    });

    it('entries live forever when no defaultTtl and no per-key ttl', () => {
      vi.useFakeTimers();
      const ttlClient = new CacheClient();

      ttlClient.set('key', 'value');
      vi.advanceTimersByTime(3_600_000);
      expect(ttlClient.get('key')).toBe('value');

      ttlClient.destroy();
      vi.useRealTimers();
    });
  });

  describe('validation', () => {
    it('throws on non-serializable value (circular reference)', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(() => client.set('key', circular)).toThrow();
    });

    it('throws on value exceeding max size', () => {
      const smallClient = new CacheClient({ maxValueSize: 10 });
      expect(() => smallClient.set('key', 'a'.repeat(100))).toThrow('exceeds max');
      smallClient.destroy();
    });

    it('accepts Map values without error', () => {
      expect(() => client.set('map', new Map([['a', 1]]))).not.toThrow();
      expect(client.get('map')).toBeInstanceOf(Map);
    });

    it('accepts Set values without error', () => {
      expect(() => client.set('set', new Set([1, 2, 3]))).not.toThrow();
      expect(client.get('set')).toBeInstanceOf(Set);
    });

    it('accepts Date values without error', () => {
      const date = new Date('2026-01-01');
      expect(() => client.set('date', date)).not.toThrow();
      expect(client.get('date')).toBeInstanceOf(Date);
    });

    it('rejects functions with descriptive error', () => {
      expect(() => client.set('fn', () => {})).toThrow();
    });
  });

  describe('tags', () => {
    it('set() with tags stores tags in entry', () => {
      client.set('key', 'value', { tags: ['group'] });
      expect(client.get('key')).toBe('value');
    });

    it('invalidateTag() deletes matching entries locally', () => {
      client.set('a', 1, { tags: ['group'] });
      client.set('b', 2, { tags: ['group'] });
      client.set('c', 3);
      client.invalidateTag('group');
      expect(client.get('a')).toBeUndefined();
      expect(client.get('b')).toBeUndefined();
      expect(client.get('c')).toBe(3);
    });
  });

  describe('cluster mode', () => {
    it('sends IPC messages on set/delete/clear', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      const sendSpy = vi.fn();
      process.send = sendSpy;

      const clusterClient = new CacheClient();

      clusterClient.set('key', 'value', { ttl: 60 });
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          __orkify: true,
          type: 'cache:set',
          key: 'key',
          value: 'value',
          ttl: 60,
        })
      );

      clusterClient.delete('key');
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          __orkify: true,
          type: 'cache:delete',
          key: 'key',
        })
      );

      clusterClient.clear();
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          __orkify: true,
          type: 'cache:clear',
        })
      );

      clusterClient.destroy();
    });

    it('handles incoming cache:set messages', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      process.send = vi.fn();

      const clusterClient = new CacheClient();

      // Simulate incoming message from primary
      const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
      handler({
        __orkify: true,
        type: 'cache:set',
        key: 'remote-key',
        value: 'remote-value',
        expiresAt: Date.now() + 60_000,
      });

      expect(clusterClient.get('remote-key')).toBe('remote-value');
      clusterClient.destroy();
    });

    it('handles incoming cache:delete messages', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      process.send = vi.fn();

      const clusterClient = new CacheClient();
      clusterClient.set('to-delete', 'value');

      const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
      handler({ __orkify: true, type: 'cache:delete', key: 'to-delete' });

      expect(clusterClient.has('to-delete')).toBe(false);
      clusterClient.destroy();
    });

    it('handles incoming cache:clear messages', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      process.send = vi.fn();

      const clusterClient = new CacheClient();
      clusterClient.set('a', 1);
      clusterClient.set('b', 2);

      const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
      handler({ __orkify: true, type: 'cache:clear' });

      expect(clusterClient.stats().size).toBe(0);
      clusterClient.destroy();
    });

    it('handles incoming cache:snapshot messages', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      process.send = vi.fn();

      const clusterClient = new CacheClient();

      const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
      handler({
        __orkify: true,
        type: 'cache:snapshot',
        entries: [
          ['snap-a', { value: 1 }],
          ['snap-b', { value: 2 }],
        ],
        tagTimestamps: [['tag-x', 5000]],
      });

      expect(clusterClient.get('snap-a')).toBe(1);
      expect(clusterClient.get('snap-b')).toBe(2);
      expect(clusterClient.getTagExpiration(['tag-x'])).toBe(5000);
      clusterClient.destroy();
    });

    it('ignores non-orkify messages', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      process.send = vi.fn();

      const clusterClient = new CacheClient();

      const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
      handler({ type: 'something-else', data: 'foo' });
      handler('not-an-object');
      handler(null);

      expect(clusterClient.stats().size).toBe(0);
      clusterClient.destroy();
    });

    it('removes message listener on destroy', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      process.send = vi.fn();

      const clusterClient = new CacheClient();
      const listenersBefore = process.listenerCount('message');

      clusterClient.destroy();

      expect(process.listenerCount('message')).toBe(listenersBefore - 1);
    });

    it('drains buffered messages on construction', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      process.send = vi.fn();

      const buffered = [
        {
          __orkify: true,
          type: 'cache:set',
          key: 'buf-a',
          value: 'one',
          expiresAt: Date.now() + 60_000,
        },
        { __orkify: true, type: 'cache:set', key: 'buf-b', value: 'two' },
      ];

      const clusterClient = new CacheClient(undefined, buffered);

      expect(clusterClient.get('buf-a')).toBe('one');
      expect(clusterClient.get('buf-b')).toBe('two');
      clusterClient.destroy();
    });

    it('does not throw when process.send fails in cluster mode', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      process.send = vi.fn(() => {
        throw new Error('IPC channel closed');
      });

      const clusterClient = new CacheClient();

      // All these should silently swallow the IPC error
      expect(() => clusterClient.set('key', 'value')).not.toThrow();
      expect(() => clusterClient.delete('key')).not.toThrow();
      expect(() => clusterClient.clear()).not.toThrow();
      expect(() => clusterClient.invalidateTag('tag')).not.toThrow();
      expect(() => clusterClient.updateTagTimestamp('tag', 123)).not.toThrow();

      // Local operations should still work
      clusterClient.set('local', 'works');
      expect(clusterClient.get('local')).toBe('works');

      clusterClient.destroy();
    });

    it('ignores buffered messages in standalone mode', () => {
      // standalone mode — bufferedMessages should be ignored
      const buffered = [{ __orkify: true, type: 'cache:set', key: 'x', value: 'y' }];

      const standaloneClient = new CacheClient(undefined, buffered);
      expect(standaloneClient.get('x')).toBeUndefined();
      standaloneClient.destroy();
    });

    it('invalidateTag() sends IPC message in cluster mode', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      const sendSpy = vi.fn();
      process.send = sendSpy;

      const clusterClient = new CacheClient();

      clusterClient.set('a', 1, { tags: ['group'] });
      sendSpy.mockClear();

      clusterClient.invalidateTag('group');
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          __orkify: true,
          type: 'cache:invalidate-tag',
          tag: 'group',
        })
      );
      clusterClient.destroy();
    });

    it('handles incoming cache:invalidate-tag messages with timestamp', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      process.send = vi.fn();

      const clusterClient = new CacheClient();
      clusterClient.set('a', 1, { tags: ['group'] });
      clusterClient.set('b', 2, { tags: ['group'] });

      const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
      handler({
        __orkify: true,
        type: 'cache:invalidate-tag',
        tag: 'group',
        tagTimestamp: 9999,
      });

      expect(clusterClient.get('a')).toBeUndefined();
      expect(clusterClient.get('b')).toBeUndefined();
      expect(clusterClient.getTagExpiration(['group'])).toBe(9999);
      clusterClient.destroy();
    });

    it('incoming cache:set with tags stores tags in entry', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      process.send = vi.fn();

      const clusterClient = new CacheClient();

      const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
      handler({
        __orkify: true,
        type: 'cache:set',
        key: 'tagged-key',
        value: 'val',
        tags: ['t1'],
        expiresAt: Date.now() + 60_000,
      });

      expect(clusterClient.get('tagged-key')).toBe('val');
      // Verify tags work by invalidating
      clusterClient.invalidateTag('t1');
      expect(clusterClient.get('tagged-key')).toBeUndefined();
      clusterClient.destroy();
    });

    it('includes tags in IPC set message', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      const sendSpy = vi.fn();
      process.send = sendSpy;

      const clusterClient = new CacheClient();
      clusterClient.set('key', 'value', { ttl: 60, tags: ['group'] });

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          __orkify: true,
          type: 'cache:set',
          key: 'key',
          value: 'value',
          ttl: 60,
          tags: ['group'],
        })
      );
      clusterClient.destroy();
    });

    it('updateTagTimestamp() sends IPC message in cluster mode', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      const sendSpy = vi.fn();
      process.send = sendSpy;

      const clusterClient = new CacheClient();
      clusterClient.updateTagTimestamp('tag-a', 7777);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          __orkify: true,
          type: 'cache:update-tag-timestamp',
          tag: 'tag-a',
          tagTimestamp: 7777,
        })
      );
      expect(clusterClient.getTagExpiration(['tag-a'])).toBe(7777);
      clusterClient.destroy();
    });

    it('handles incoming cache:update-tag-timestamp messages', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      process.send = vi.fn();

      const clusterClient = new CacheClient();

      const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
      handler({
        __orkify: true,
        type: 'cache:update-tag-timestamp',
        tag: 'remote-tag',
        tagTimestamp: 4242,
      });

      expect(clusterClient.getTagExpiration(['remote-tag'])).toBe(4242);
      clusterClient.destroy();
    });
  });

  describe('configure()', () => {
    it('throws when called directly on a CacheClient instance', () => {
      expect(() => client.configure({ maxEntries: 100 })).toThrow(
        'must be called via the cache singleton proxy'
      );
    });
  });

  describe('getAsync', () => {
    it('getAsync() returns value from memory', async () => {
      client.set('key', 'value');
      const result = await client.getAsync<string>('key');
      expect(result).toBe('value');
    });

    it('getAsync() returns undefined when not file-backed and not in memory', async () => {
      const result = await client.getAsync<string>('missing');
      expect(result).toBeUndefined();
    });
  });

  describe('file-backed constructor', () => {
    it('creates CacheFileStore when fileBacked is true', () => {
      const fbClient = new CacheClient({ fileBacked: true });
      fbClient.set('key', 'value');
      expect(fbClient.get('key')).toBe('value');
      fbClient.destroy();
    });

    it('registers IPC flush handler in standalone file-backed mode', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const sendSpy = vi.fn();
      process.send = sendSpy;

      const fbClient = new CacheClient({ fileBacked: true });
      fbClient.set('key', 'value');

      // Simulate IPC flush message from parent
      const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
      handler({ __orkify: true, type: 'cache:flush' });

      expect(sendSpy).toHaveBeenCalledWith({ __orkify: true, type: 'cache:flushed' });
      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
      fbClient.destroy();
    });

    it('IPC flush handler ignores non-flush messages', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      const fbClient = new CacheClient({ fileBacked: true });

      const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
      handler({ __orkify: true, type: 'cache:set' });
      handler({ type: 'unrelated' });
      handler(null);

      expect(exitSpy).not.toHaveBeenCalled();

      exitSpy.mockRestore();
      fbClient.destroy();
    });

    it('IPC flush handler tolerates send failure', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      process.send = () => {
        throw new Error('IPC channel closed');
      };

      const fbClient = new CacheClient({ fileBacked: true });

      const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
      expect(() => handler({ __orkify: true, type: 'cache:flush' })).not.toThrow();
      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
      fbClient.destroy();
    });

    it('sends cache:configure IPC in cluster mode when fileBacked', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      const sendSpy = vi.fn();
      process.send = sendSpy;

      const fbClusterClient = new CacheClient({ fileBacked: true, maxEntries: 50 });

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          __orkify: true,
          type: 'cache:configure',
          config: expect.objectContaining({ fileBacked: true, maxEntries: 50 }),
        })
      );

      fbClusterClient.destroy();
    });

    it('does not send cache:configure in standalone mode', () => {
      const sendSpy = vi.fn();
      process.send = sendSpy;

      const fbClient = new CacheClient({ fileBacked: true });
      // In standalone mode (ORKIFY_CLUSTER_MODE not 'true'), no IPC
      expect(sendSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'cache:configure' })
      );

      fbClient.destroy();
    });
  });

  describe('incr', () => {
    describe('standalone mode', () => {
      it('returns 1 on first call (default delta)', async () => {
        expect(await client.incr('counter')).toBe(1);
      });

      it('returns previous + delta on subsequent calls', async () => {
        await client.incr('counter');
        expect(await client.incr('counter')).toBe(2);
        expect(await client.incr('counter', 5)).toBe(7);
      });

      it('honors explicit delta on first call', async () => {
        expect(await client.incr('counter', 10)).toBe(10);
      });

      it('persists value visible via get', async () => {
        await client.incr('counter', 42);
        expect(client.get('counter')).toBe(42);
      });

      it('throws on ttlIfNew <= 0', async () => {
        await expect(client.incr('k', 1, { ttlIfNew: 0 })).rejects.toThrow(
          'ttlIfNew must be positive'
        );
        await expect(client.incr('k', 1, { ttlIfNew: -5 })).rejects.toThrow(
          'ttlIfNew must be positive'
        );
      });

      it('ttlIfNew applied on creation', async () => {
        vi.useFakeTimers();
        const ttlClient = new CacheClient();
        await ttlClient.incr('counter', 1, { ttlIfNew: 1 });
        expect(ttlClient.get('counter')).toBe(1);

        vi.advanceTimersByTime(1001);
        expect(ttlClient.get('counter')).toBeUndefined();

        ttlClient.destroy();
        vi.useRealTimers();
      });

      it('does not call process.send in standalone mode', async () => {
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const standaloneClient = new CacheClient();

        await standaloneClient.incr('counter', 1, { ttlIfNew: 60 });

        expect(sendSpy).not.toHaveBeenCalled();
        standaloneClient.destroy();
      });
    });

    describe('standalone mode — idempotency dedup', () => {
      it('same explicit idempotencyKey returns cached value (no re-incr)', async () => {
        const a = await client.incr('counter', 1, { idempotencyKey: 'idem-A' });
        expect(a).toBe(1);

        const b = await client.incr('counter', 1, { idempotencyKey: 'idem-A' });
        expect(b).toBe(1); // not 2 — dedup hit

        // Underlying store also untouched on the second call
        expect(client.get('counter')).toBe(1);
      });

      it('different explicit idempotencyKeys execute fresh', async () => {
        await client.incr('counter', 1, { idempotencyKey: 'idem-A' });
        const second = await client.incr('counter', 1, { idempotencyKey: 'idem-B' });
        expect(second).toBe(2);
      });

      it('cached error replays even after the underlying state is fixed', async () => {
        // Pre-populate non-numeric so first incr errors
        client.set('k', 'not-a-number');
        await expect(client.incr('k', 1, { idempotencyKey: 'idem-err' })).rejects.toThrow(
          /not a number/
        );

        // CHANGE the state so a fresh execution would now succeed
        client.set('k', 5);

        // Same idempotencyKey → still returns the CACHED error, not the new success
        await expect(client.incr('k', 1, { idempotencyKey: 'idem-err' })).rejects.toThrow(
          /not a number/
        );

        // Sanity: a different idempotencyKey runs fresh against the new state
        expect(await client.incr('k', 1, { idempotencyKey: 'idem-fresh' })).toBe(6);
      });

      it('auto-generated idempotencyKeys never collide (each call increments)', async () => {
        // No explicit key → auto-UUID per call → every call is unique → all increment
        for (let i = 1; i <= 5; i++) {
          expect(await client.incr('counter')).toBe(i);
        }
      });

      it('expired dedup entries are swept after TTL', async () => {
        vi.useFakeTimers();
        const c = new CacheClient();

        await c.incr('counter', 1, { idempotencyKey: 'idem-Y' });

        // Within TTL — dedup hit
        vi.advanceTimersByTime(30_000);
        expect(await c.incr('counter', 1, { idempotencyKey: 'idem-Y' })).toBe(1);

        // Past 60s TTL + sweep interval — dedup miss, fresh increment
        vi.advanceTimersByTime(120_001);
        expect(await c.incr('counter', 1, { idempotencyKey: 'idem-Y' })).toBe(2);

        c.destroy();
        vi.useRealTimers();
      });

      it('FIFO eviction at max dedup size', async () => {
        // Use a smaller-scale assertion: fill past max (1000), assert oldest evicted
        const c = new CacheClient();

        for (let i = 0; i < 1001; i++) {
          await c.incr(`k-${i}`, 1, { idempotencyKey: `idem-${i}` });
        }

        // idem-0 should have been evicted; retry now performs fresh increment (1 → 2)
        const reincr = await c.incr('k-0', 1, { idempotencyKey: 'idem-0' });
        expect(reincr).toBe(2);

        // idem-1000 (newest) should still be cached → returns 1
        const cached = await c.incr('k-1000', 1, { idempotencyKey: 'idem-1000' });
        expect(cached).toBe(1);

        c.destroy();
      });

      // destroy() behavior is covered directly by IncrDedupCache.test.ts.
    });

    describe('cluster mode', () => {
      it('sends cache:incr IPC with delta, ttlIfNew, originatorPid, and requestId', async () => {
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const clusterClient = new CacheClient();

        const promise = clusterClient.incr('counter', 5, { ttlIfNew: 60 });

        const sent = sendSpy.mock.calls
          .map((c) => c[0])
          .find((m: { type?: string }) => m?.type === 'cache:incr') as {
          idempotencyKey: string;
          originatorPid: number;
          requestId: number;
        };
        expect(sent).toMatchObject({
          __orkify: true,
          type: 'cache:incr',
          key: 'counter',
          delta: 5,
          ttlIfNew: 60,
          originatorPid: process.pid,
          idempotencyKey: expect.any(String),
        });
        expect(typeof sent.requestId).toBe('number');
        expect(sent.idempotencyKey.length).toBeGreaterThan(0);

        const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
        handler({
          __orkify: true,
          type: 'cache:incr-result',
          key: 'counter',
          value: 5,
          originatorPid: process.pid,
          requestId: sent.requestId,
          idempotencyKey: sent.idempotencyKey,
        });

        expect(await promise).toBe(5);
        clusterClient.destroy();
      });

      it('default delta is 1 in cluster mode', async () => {
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const clusterClient = new CacheClient();

        const promise = clusterClient.incr('counter');
        const sent = sendSpy.mock.calls
          .map((c) => c[0])
          .find((m: { type?: string }) => m?.type === 'cache:incr') as {
          delta: number;
          idempotencyKey: string;
          requestId: number;
        };
        expect(sent.delta).toBe(1);

        const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
        handler({
          __orkify: true,
          type: 'cache:incr-result',
          key: 'counter',
          value: 1,
          originatorPid: process.pid,
          requestId: sent.requestId,
          idempotencyKey: sent.idempotencyKey,
        });

        expect(await promise).toBe(1);
        clusterClient.destroy();
      });

      it('out-of-order results resolve the right promise', async () => {
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const clusterClient = new CacheClient();

        const p1 = clusterClient.incr('a');
        const p2 = clusterClient.incr('b');

        const sent = sendSpy.mock.calls
          .map((c) => c[0] as { type?: string; idempotencyKey: string; requestId: number })
          .filter((m) => m?.type === 'cache:incr');
        const id1 = sent[0].requestId;
        const id2 = sent[1].requestId;
        expect(id1).not.toBe(id2);

        const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
        // Reply to p2 first
        handler({
          __orkify: true,
          type: 'cache:incr-result',
          key: 'b',
          value: 7,
          originatorPid: process.pid,
          requestId: id2,
          idempotencyKey: sent[1].idempotencyKey,
        });
        expect(await p2).toBe(7);

        handler({
          __orkify: true,
          type: 'cache:incr-result',
          key: 'a',
          value: 3,
          originatorPid: process.pid,
          requestId: id1,
          idempotencyKey: sent[0].idempotencyKey,
        });
        expect(await p1).toBe(3);

        clusterClient.destroy();
      });

      it('broadcast from another worker (different originatorPid) applies value locally without resolving anything', () => {
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        process.send = vi.fn();
        const clusterClient = new CacheClient();

        const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
        // Simulate a broadcast originating from a different worker pid
        handler({
          __orkify: true,
          type: 'cache:incr-result',
          key: 'x',
          value: 99,
          originatorPid: process.pid + 12345, // some other worker
          requestId: 1, // could collide with our own counter, but pid mismatch protects us
          idempotencyKey: 'idem-other-worker',
        });

        // Value applies as a side effect (so this worker stays consistent)
        expect(clusterClient.get('x')).toBe(99);
        clusterClient.destroy();
      });

      it('rejects with timeout error if no result arrives', async () => {
        vi.useFakeTimers();
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        process.send = vi.fn();
        const clusterClient = new CacheClient();

        // Subscribe to the rejection BEFORE advancing time so the fake timer
        // doesn't fire onto an unhandled promise.
        const assertion = expect(
          clusterClient.incr('counter', 1, { timeoutMs: 100 })
        ).rejects.toThrow(/timed out/i);

        await vi.advanceTimersByTimeAsync(101);
        await assertion;

        clusterClient.destroy();
        vi.useRealTimers();
      });

      it('error result rejects the promise', async () => {
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const clusterClient = new CacheClient();

        const promise = clusterClient.incr('counter');
        const sent = sendSpy.mock.calls
          .map((c) => c[0])
          .find((m: { type?: string }) => m?.type === 'cache:incr') as {
          idempotencyKey: string;
          requestId: number;
        };

        const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
        handler({
          __orkify: true,
          type: 'cache:incr-result',
          key: 'counter',
          error: 'existing value at "counter" is not a number',
          originatorPid: process.pid,
          requestId: sent.requestId,
          idempotencyKey: sent.idempotencyKey,
        });

        await expect(promise).rejects.toThrow(/not a number/);
        clusterClient.destroy();
      });
    });

    describe('cluster mode — retry & idempotency', () => {
      it('first attempt succeeds → no retry, single IPC send', async () => {
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const clusterClient = new CacheClient();

        const promise = clusterClient.incr('counter');
        const sent = sendSpy.mock.calls
          .map((c) => c[0])
          .filter((m: { type?: string }) => m?.type === 'cache:incr');
        expect(sent).toHaveLength(1);

        const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
        handler({
          __orkify: true,
          type: 'cache:incr-result',
          key: 'counter',
          value: 1,
          originatorPid: process.pid,
          requestId: (sent[0] as { requestId: number }).requestId,
          idempotencyKey: (sent[0] as { idempotencyKey: string }).idempotencyKey,
        });

        expect(await promise).toBe(1);
        // Still only one send — no retry kicked in
        const sendsAfter = sendSpy.mock.calls.filter(
          (c) => (c[0] as { type?: string })?.type === 'cache:incr'
        );
        expect(sendsAfter).toHaveLength(1);
        clusterClient.destroy();
      });

      it('first attempt times out, second succeeds → returns success, same idempotencyKey across attempts', async () => {
        vi.useFakeTimers();
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const clusterClient = new CacheClient();

        // timeoutMs=300, maxAttempts=3 → 100ms per attempt
        const promise = clusterClient.incr('counter', 1, { timeoutMs: 300, maxAttempts: 3 });

        // Let attempt 1 time out (100ms)
        await vi.advanceTimersByTimeAsync(101);

        // Now attempt 2 has been sent — reply to it
        const sent = sendSpy.mock.calls
          .map((c) => c[0] as { type?: string; idempotencyKey: string; requestId: number })
          .filter((m) => m?.type === 'cache:incr');
        expect(sent).toHaveLength(2);
        // Same idempotencyKey across attempts
        expect(sent[0].idempotencyKey).toBe(sent[1].idempotencyKey);
        // Different requestIds (each attempt is a fresh send)
        expect(sent[0].requestId).not.toBe(sent[1].requestId);

        const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
        handler({
          __orkify: true,
          type: 'cache:incr-result',
          key: 'counter',
          value: 7, // pretend the primary actually had processed it
          originatorPid: process.pid,
          requestId: sent[1].requestId,
          idempotencyKey: sent[1].idempotencyKey,
        });

        await vi.advanceTimersByTimeAsync(0);
        expect(await promise).toBe(7);

        clusterClient.destroy();
        vi.useRealTimers();
      });

      it('all attempts time out → rejects with exhausted error', async () => {
        vi.useFakeTimers();
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        process.send = vi.fn();
        const clusterClient = new CacheClient();

        const assertion = expect(
          clusterClient.incr('counter', 1, { timeoutMs: 300, maxAttempts: 3 })
        ).rejects.toThrow(/exhausted 3 attempts/i);

        await vi.advanceTimersByTimeAsync(301);
        await assertion;

        clusterClient.destroy();
        vi.useRealTimers();
      });

      it('non-timeout error (e.g., from primary) does NOT retry', async () => {
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const clusterClient = new CacheClient();

        const promise = clusterClient.incr('counter');
        const sent = sendSpy.mock.calls
          .map((c) => c[0] as { type?: string; idempotencyKey: string; requestId: number })
          .filter((m) => m?.type === 'cache:incr');

        const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
        handler({
          __orkify: true,
          type: 'cache:incr-result',
          key: 'counter',
          error: 'existing value at "counter" is not a number',
          originatorPid: process.pid,
          requestId: sent[0].requestId,
          idempotencyKey: sent[0].idempotencyKey,
        });

        await expect(promise).rejects.toThrow(/not a number/);

        // Only one send — no retry on non-timeout error
        const sendsAfter = sendSpy.mock.calls.filter(
          (c) => (c[0] as { type?: string })?.type === 'cache:incr'
        );
        expect(sendsAfter).toHaveLength(1);
        clusterClient.destroy();
      });

      it('per-attempt timeout = totalBudget / maxAttempts', async () => {
        vi.useFakeTimers();
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const clusterClient = new CacheClient();

        const assertion = expect(
          clusterClient.incr('counter', 1, { timeoutMs: 600, maxAttempts: 2 })
        ).rejects.toThrow(/exhausted/i);

        // After 200ms, only the first attempt should have fired (each attempt = 300ms)
        await vi.advanceTimersByTimeAsync(200);
        let sends = sendSpy.mock.calls.filter(
          (c) => (c[0] as { type?: string })?.type === 'cache:incr'
        );
        expect(sends).toHaveLength(1);

        // After 350ms total, the first timed out (at 300ms) and the second is in flight
        await vi.advanceTimersByTimeAsync(150);
        sends = sendSpy.mock.calls.filter(
          (c) => (c[0] as { type?: string })?.type === 'cache:incr'
        );
        expect(sends).toHaveLength(2);

        // After full 600ms, both attempts have timed out → exhausted
        await vi.advanceTimersByTimeAsync(300);
        await assertion;

        clusterClient.destroy();
        vi.useRealTimers();
      });

      it('explicit idempotencyKey from options is honored across attempts', async () => {
        vi.useFakeTimers();
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const clusterClient = new CacheClient();

        const promise = clusterClient.incr('counter', 1, {
          timeoutMs: 200,
          maxAttempts: 2,
          idempotencyKey: 'caller-supplied-key',
        });

        // Let everything time out — we just want to inspect the sent messages
        const assertion = expect(promise).rejects.toThrow(/exhausted/i);
        await vi.advanceTimersByTimeAsync(201);
        await assertion;

        const sent = sendSpy.mock.calls
          .map((c) => c[0] as { type?: string; idempotencyKey?: string })
          .filter((m) => m?.type === 'cache:incr');
        expect(sent).toHaveLength(2);
        expect(sent[0].idempotencyKey).toBe('caller-supplied-key');
        expect(sent[1].idempotencyKey).toBe('caller-supplied-key');

        clusterClient.destroy();
        vi.useRealTimers();
      });

      it('auto-generated idempotencyKey is unique per call', async () => {
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const clusterClient = new CacheClient();

        // Fire two calls without resolving — capture their idempotencyKeys
        void clusterClient.incr('a').catch(() => {});
        void clusterClient.incr('b').catch(() => {});

        const sent = sendSpy.mock.calls
          .map((c) => c[0] as { type?: string; idempotencyKey?: string })
          .filter((m) => m?.type === 'cache:incr');
        expect(sent).toHaveLength(2);
        expect(sent[0].idempotencyKey).toBeTruthy();
        expect(sent[1].idempotencyKey).toBeTruthy();
        expect(sent[0].idempotencyKey).not.toBe(sent[1].idempotencyKey);

        clusterClient.destroy();
      });

      it('throws on maxAttempts <= 0', async () => {
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        process.send = vi.fn();
        const c = new CacheClient();

        await expect(c.incr('k', 1, { maxAttempts: 0 })).rejects.toThrow(
          /maxAttempts must be a positive integer/i
        );
        await expect(c.incr('k', 1, { maxAttempts: -1 })).rejects.toThrow(
          /maxAttempts must be a positive integer/i
        );

        c.destroy();
      });

      it('throws on non-integer maxAttempts', async () => {
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        process.send = vi.fn();
        const c = new CacheClient();

        await expect(c.incr('k', 1, { maxAttempts: 1.5 })).rejects.toThrow(
          /maxAttempts must be a positive integer/i
        );

        c.destroy();
      });

      it('throws on timeoutMs <= 0', async () => {
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        process.send = vi.fn();
        const c = new CacheClient();

        await expect(c.incr('k', 1, { timeoutMs: 0 })).rejects.toThrow(
          /timeoutMs must be positive/i
        );
        await expect(c.incr('k', 1, { timeoutMs: -100 })).rejects.toThrow(
          /timeoutMs must be positive/i
        );

        c.destroy();
      });

      it('maxAttempts: 1 works as a single-attempt no-retry call', async () => {
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const c = new CacheClient();

        const promise = c.incr('counter', 1, { maxAttempts: 1, timeoutMs: 200 });
        const sent = sendSpy.mock.calls
          .map((call) => call[0])
          .find((m: { type?: string }) => m?.type === 'cache:incr') as {
          idempotencyKey: string;
          requestId: number;
        };

        const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
        handler({
          __orkify: true,
          type: 'cache:incr-result',
          key: 'counter',
          value: 1,
          originatorPid: process.pid,
          requestId: sent.requestId,
          idempotencyKey: sent.idempotencyKey,
        });

        expect(await promise).toBe(1);
        c.destroy();
      });

      it('destroy() during retry sleep cleanly cancels (no stray sends after destroy)', async () => {
        vi.useFakeTimers();
        process.env.ORKIFY_CLUSTER_MODE = 'true';
        const sendSpy = vi.fn();
        process.send = sendSpy;
        const clusterClient = new CacheClient();

        const assertion = expect(
          clusterClient.incr('counter', 1, { timeoutMs: 600, maxAttempts: 3 })
        ).rejects.toThrow(); // either "client destroyed" or "exhausted"

        // Let one attempt fire and time out, then destroy mid-loop
        await vi.advanceTimersByTimeAsync(201);
        const sendsBeforeDestroy = sendSpy.mock.calls.filter(
          (c) => (c[0] as { type?: string })?.type === 'cache:incr'
        ).length;

        clusterClient.destroy();
        await assertion;

        // After destroy + final await, no NEW incr sends should have fired
        const sendsAfterDestroy = sendSpy.mock.calls.filter(
          (c) => (c[0] as { type?: string })?.type === 'cache:incr'
        ).length;
        expect(sendsAfterDestroy).toBe(sendsBeforeDestroy);

        vi.useRealTimers();
      });
    });
  });

  describe('tag timestamps', () => {
    it('getTagExpiration delegates to store', () => {
      client.invalidateTag('tag-a');
      expect(client.getTagExpiration(['tag-a'])).toBeGreaterThan(0);
    });

    it('getTagExpiration returns 0 for unknown tags', () => {
      expect(client.getTagExpiration(['unknown'])).toBe(0);
    });

    it('updateTagTimestamp records timestamp locally', () => {
      client.updateTagTimestamp('tag-a', 3000);
      expect(client.getTagExpiration(['tag-a'])).toBe(3000);
    });

    it('updateTagTimestamp defaults to Date.now()', () => {
      const before = Date.now();
      client.updateTagTimestamp('tag-a');
      const after = Date.now();
      const ts = client.getTagExpiration(['tag-a']);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });
});
