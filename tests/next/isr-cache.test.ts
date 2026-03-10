import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheClient } from '../../packages/cache/src/CacheClient.js';

let testClient: CacheClient;

vi.mock('@orkify/cache', () => {
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

const { default: OrkifyCacheHandler } = await import('../../packages/next/src/isr-cache.js');

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

    it('returns CacheHandlerValue envelope', async () => {
      await handler.set(
        'page',
        { kind: 'APP_PAGE', html: '<h1>hello</h1>', status: 200 },
        { tags: [] }
      );

      const result = (await handler.get('page')) as Record<string, unknown>;
      expect(result).toHaveProperty('value');
      expect(result).toHaveProperty('lastModified');
      expect(typeof result.lastModified).toBe('number');
      expect(result.value).toEqual({ kind: 'APP_PAGE', html: '<h1>hello</h1>', status: 200 });
    });

    it('returns complex nested objects inside value', async () => {
      const data = {
        kind: 'APP_PAGE',
        pageData: { props: { items: [1, 2, 3] } },
        status: 200,
      };
      await handler.set('complex', data, { tags: [] });

      const result = (await handler.get('complex')) as { value: unknown; lastModified: number };
      expect(result.value).toEqual(data);
    });
  });

  describe('set()', () => {
    it('stores with explicit tags from ctx', async () => {
      await handler.set('page', { html: '<p>content</p>' }, { tags: ['page-tag'] });

      const stored = testClient.get<{ value: unknown }>('page');
      expect(stored?.value).toEqual({ html: '<p>content</p>' });

      // Verify tags work
      testClient.invalidateTag('page-tag');
      expect(testClient.get('page')).toBeUndefined();
    });

    it('extracts tags from x-next-cache-tags header', async () => {
      const data = {
        kind: 'APP_PAGE',
        html: '<p>posts</p>',
        headers: { 'x-next-cache-tags': 'posts,_N_T_/posts' },
      };
      await handler.set('/posts', data);

      // Invalidating by tag should remove the entry
      testClient.invalidateTag('posts');
      expect(testClient.get('/posts')).toBeUndefined();
    });

    it('stores with lastModified timestamp', async () => {
      const before = Date.now();
      await handler.set('timed', { data: 1 }, { tags: [] });
      const after = Date.now();

      const stored = testClient.get<{ value: unknown; lastModified: number }>('timed');
      expect(stored?.lastModified).toBeGreaterThanOrEqual(before);
      expect(stored?.lastModified).toBeLessThanOrEqual(after);
    });

    it('stores with empty tags', async () => {
      await handler.set('no-tags', { data: 1 }, { tags: [] });

      const stored = testClient.get<{ value: unknown }>('no-tags');
      expect(stored?.value).toEqual({ data: 1 });
    });

    it('stores with multiple tags', async () => {
      await handler.set('multi-tag', { val: true }, { tags: ['a', 'b', 'c'] });

      // Invalidating any one tag removes the entry
      testClient.invalidateTag('b');
      expect(testClient.get('multi-tag')).toBeUndefined();
    });

    it('merges ctx.tags with x-next-cache-tags header', async () => {
      const data = {
        kind: 'APP_PAGE',
        html: '<p>merged</p>',
        headers: { 'x-next-cache-tags': 'header-tag,_N_T_/layout' },
      };
      await handler.set('/merged', data, { tags: ['ctx-tag'] });

      // Invalidating by header-only tag should remove the entry
      testClient.invalidateTag('header-tag');
      expect(testClient.get('/merged')).toBeUndefined();
    });

    it('deduplicates overlapping ctx.tags and header tags', async () => {
      const data = {
        kind: 'APP_PAGE',
        html: '<p>dedup</p>',
        headers: { 'x-next-cache-tags': 'shared,header-only' },
      };
      await handler.set('/dedup', data, { tags: ['shared', 'ctx-only'] });

      expect(testClient.get('/dedup')).not.toBeUndefined();

      // ctx-only tag works
      testClient.invalidateTag('ctx-only');
      expect(testClient.get('/dedup')).toBeUndefined();
    });
  });

  describe('revalidateTag()', () => {
    it('with string works', async () => {
      await handler.set('a', { v: 1 }, { tags: ['group'] });
      await handler.set('b', { v: 2 }, { tags: ['group'] });

      await handler.revalidateTag('group');

      expect(await handler.get('a')).toBeNull();
      expect(await handler.get('b')).toBeNull();
    });

    it('with string[] works', async () => {
      await handler.set('x', { v: 10 }, { tags: ['alpha'] });
      await handler.set('y', { v: 20 }, { tags: ['beta'] });
      testClient.set('z', 30);

      await handler.revalidateTag(['alpha', 'beta']);

      expect(await handler.get('x')).toBeNull();
      expect(await handler.get('y')).toBeNull();
      expect(testClient.get('z')).toBe(30);
    });

    it('only invalidates matching tags', async () => {
      await handler.set('keep', { v: 'yes' }, { tags: ['safe'] });
      await handler.set('remove', { v: 'no' }, { tags: ['unsafe'] });

      await handler.revalidateTag('unsafe');

      expect(await handler.get('keep')).not.toBeNull();
      expect(await handler.get('remove')).toBeNull();
    });

    it('invalidates entries tagged via x-next-cache-tags header', async () => {
      const data = {
        kind: 'APP_PAGE',
        html: '<p>posts</p>',
        headers: { 'x-next-cache-tags': 'posts,_N_T_/posts/layout' },
      };
      await handler.set('/posts', data);

      expect(await handler.get('/posts')).not.toBeNull();

      await handler.revalidateTag('posts');

      expect(await handler.get('/posts')).toBeNull();
    });
  });

  describe('resetRequestCache()', () => {
    it('is a no-op that does not affect stored data', async () => {
      await handler.set('before', { v: 'value' }, { tags: [] });
      handler.resetRequestCache();
      expect(await handler.get('before')).not.toBeNull();
    });
  });

  describe('Headers serialization', () => {
    it('converts Headers to plain object on set', async () => {
      const data = {
        kind: 'APP_ROUTE',
        status: 200,
        body: Buffer.from('{"ok":true}'),
        headers: new Headers({ 'content-type': 'application/json', 'x-custom': 'value' }),
      };

      await handler.set('route', data, { tags: [] });

      // Stored value.headers should be a plain object, not Headers
      const raw = testClient.get<{ value: Record<string, unknown> }>('route');
      expect(raw?.value?.headers).not.toBeInstanceOf(Headers);
      expect(raw?.value?.headers).toEqual({
        'content-type': 'application/json',
        'x-custom': 'value',
      });
    });

    it('keeps plain object headers as-is', async () => {
      const data = {
        kind: 'APP_ROUTE',
        headers: { 'content-type': 'application/json' },
      };

      await handler.set('plain', data, { tags: [] });
      const result = (await handler.get('plain')) as { value: Record<string, unknown> };

      expect(result.value.headers).toEqual({ 'content-type': 'application/json' });
    });

    it('handles data without headers field', async () => {
      const data = { kind: 'APP_PAGE', status: 200, body: 'html' };

      await handler.set('no-headers', data, { tags: [] });
      const result = (await handler.get('no-headers')) as { value: unknown };

      expect(result.value).toEqual(data);
    });

    it('supports bracket-notation access on stored headers', async () => {
      const data = {
        kind: 'APP_PAGE',
        headers: new Headers({ 'x-next-cache-tags': 'posts,page' }),
      };

      await handler.set('page', data, { tags: [] });
      const result = (await handler.get('page')) as { value: Record<string, unknown> };

      // Next.js accesses headers with bracket notation
      const headers = result.value.headers as Record<string, string>;
      expect(headers['x-next-cache-tags']).toBe('posts,page');
    });
  });

  describe('integration', () => {
    it('set -> revalidateTag -> get returns null', async () => {
      await handler.set('page', { html: '<p>old</p>' }, { tags: ['page'] });
      const first = (await handler.get('page')) as { value: unknown };
      expect(first.value).toEqual({ html: '<p>old</p>' });

      await handler.revalidateTag('page');

      expect(await handler.get('page')).toBeNull();
    });

    it('set -> revalidateTag -> set -> get returns new data', async () => {
      await handler.set('page', { html: '<p>v1</p>' }, { tags: ['page'] });
      await handler.revalidateTag('page');
      await handler.set('page', { html: '<p>v2</p>' }, { tags: ['page'] });

      const result = (await handler.get('page')) as { value: unknown };
      expect(result.value).toEqual({ html: '<p>v2</p>' });
    });
  });
});
