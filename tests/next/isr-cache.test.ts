import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheClient } from '../../src/cache/CacheClient.js';

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

const { default: OrkifyCacheHandler } = await import('../../src/next/isr-cache.js');

describe('isr-cache handler', () => {
  let handler: InstanceType<typeof OrkifyCacheHandler>;

  beforeEach(() => {
    testClient = new CacheClient();
    handler = new OrkifyCacheHandler();
  });

  afterEach(() => {
    testClient.destroy();
  });

  describe('get()', () => {
    it('returns null for missing key', async () => {
      const result = await handler.get('missing');
      expect(result).toBeNull();
    });

    it('returns stored value', async () => {
      testClient.set('page', { html: '<h1>hello</h1>', status: 200 });

      const result = await handler.get('page');
      expect(result).toEqual({ html: '<h1>hello</h1>', status: 200 });
    });

    it('returns complex nested objects', async () => {
      const data = {
        pageData: { props: { items: [1, 2, 3] } },
        headers: { 'x-cache': 'HIT' },
        status: 200,
      };
      testClient.set('complex', data);

      const result = await handler.get('complex');
      expect(result).toEqual(data);
    });
  });

  describe('set()', () => {
    it('stores with tags', async () => {
      await handler.set('page', { html: '<p>content</p>' }, { tags: ['page-tag'] });

      expect(testClient.get('page')).toEqual({ html: '<p>content</p>' });

      // Verify tags work
      testClient.invalidateTag('page-tag');
      expect(testClient.get('page')).toBeUndefined();
    });

    it('stores with empty tags', async () => {
      await handler.set('no-tags', { data: 1 }, { tags: [] });

      expect(testClient.get('no-tags')).toEqual({ data: 1 });
    });

    it('stores with multiple tags', async () => {
      await handler.set('multi-tag', 'val', { tags: ['a', 'b', 'c'] });

      // Invalidating any one tag removes the entry
      testClient.invalidateTag('b');
      expect(testClient.get('multi-tag')).toBeUndefined();
    });
  });

  describe('revalidateTag()', () => {
    it('with string works', async () => {
      testClient.set('a', 1, { tags: ['group'] });
      testClient.set('b', 2, { tags: ['group'] });

      await handler.revalidateTag('group');

      expect(testClient.get('a')).toBeUndefined();
      expect(testClient.get('b')).toBeUndefined();
    });

    it('with string[] works', async () => {
      testClient.set('x', 10, { tags: ['alpha'] });
      testClient.set('y', 20, { tags: ['beta'] });
      testClient.set('z', 30);

      await handler.revalidateTag(['alpha', 'beta']);

      expect(testClient.get('x')).toBeUndefined();
      expect(testClient.get('y')).toBeUndefined();
      expect(testClient.get('z')).toBe(30);
    });

    it('only invalidates matching tags', async () => {
      testClient.set('keep', 'yes', { tags: ['safe'] });
      testClient.set('remove', 'no', { tags: ['unsafe'] });

      await handler.revalidateTag('unsafe');

      expect(testClient.get('keep')).toBe('yes');
      expect(testClient.get('remove')).toBeUndefined();
    });
  });

  describe('resetRequestCache()', () => {
    it('is a no-op that does not affect stored data', () => {
      testClient.set('before', 'value');
      handler.resetRequestCache();
      expect(testClient.get('before')).toBe('value');
    });
  });

  describe('integration', () => {
    it('set -> revalidateTag -> get returns null', async () => {
      await handler.set('page', { html: '<p>old</p>' }, { tags: ['page'] });
      expect(await handler.get('page')).toEqual({ html: '<p>old</p>' });

      await handler.revalidateTag('page');

      expect(await handler.get('page')).toBeNull();
    });

    it('set -> revalidateTag -> set -> get returns new data', async () => {
      await handler.set('page', { html: '<p>v1</p>' }, { tags: ['page'] });
      await handler.revalidateTag('page');
      await handler.set('page', { html: '<p>v2</p>' }, { tags: ['page'] });

      expect(await handler.get('page')).toEqual({ html: '<p>v2</p>' });
    });
  });
});
