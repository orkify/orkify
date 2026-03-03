import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheClient } from '../../src/cache/CacheClient.js';

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
      });

      expect(clusterClient.get('snap-a')).toBe(1);
      expect(clusterClient.get('snap-b')).toBe(2);
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

    it('handles incoming cache:invalidate-tag messages', () => {
      process.env.ORKIFY_CLUSTER_MODE = 'true';
      process.send = vi.fn();

      const clusterClient = new CacheClient();
      clusterClient.set('a', 1, { tags: ['group'] });
      clusterClient.set('b', 2, { tags: ['group'] });

      const handler = process.listeners('message').at(-1) as (msg: unknown) => void;
      handler({ __orkify: true, type: 'cache:invalidate-tag', tag: 'group' });

      expect(clusterClient.get('a')).toBeUndefined();
      expect(clusterClient.get('b')).toBeUndefined();
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
  });
});
