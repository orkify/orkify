import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextCacheEntry } from '../../src/next/types.js';
import { CacheClient } from '../../src/cache/CacheClient.js';
import { bufferToStream } from '../../src/next/stream.js';

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

const { default: IsrHandler } = await import('../../src/next/isr-cache.js');
const { default: useCacheHandler } = await import('../../src/next/use-cache.js');

function makeUseCacheEntry(overrides: Partial<NextCacheEntry> = {}): NextCacheEntry {
  return {
    value: bufferToStream(Buffer.from('test-data')),
    tags: ['shared-tag'],
    stale: 60,
    timestamp: Date.now(),
    expire: 0,
    revalidate: 0,
    ...overrides,
  };
}

describe('cross-handler tag invalidation', () => {
  let isrHandler: InstanceType<typeof IsrHandler>;

  beforeEach(() => {
    testClient = new CacheClient();
    isrHandler = new IsrHandler();
  });

  afterEach(() => {
    testClient.destroy();
  });

  it('ISR revalidateTag invalidates use-cache entries with the same tag', async () => {
    const entry = makeUseCacheEntry({ tags: ['cross-tag'] });
    await useCacheHandler.set('uc-key', Promise.resolve(entry));

    // Verify it exists
    const before = await useCacheHandler.get('uc-key', []);
    expect(before).toBeDefined();

    // Invalidate via ISR handler
    await isrHandler.revalidateTag('cross-tag');

    // use-cache entry should be gone (invalidateTag deletes from the store)
    expect(testClient.has('uc-key')).toBe(false);
  });

  it('use-cache updateTags invalidates ISR entries with the same tag', async () => {
    await isrHandler.set(
      'isr-key',
      { kind: 'APP_PAGE', html: '<p>isr</p>' },
      { tags: ['cross-tag-2'] }
    );

    const before = await isrHandler.get('isr-key');
    expect(before).not.toBeNull();

    // Invalidate via use-cache handler (updateTags without duration = invalidateTag)
    await useCacheHandler.updateTags(['cross-tag-2']);

    expect(testClient.has('isr-key')).toBe(false);
  });

  it('both handlers share the same tag timestamps', async () => {
    // Store an entry via use-cache with a tag
    const entry = makeUseCacheEntry({ tags: ['shared'], timestamp: Date.now() });
    await useCacheHandler.set('uc-shared', Promise.resolve(entry));

    // Store an entry via ISR with the same tag
    await isrHandler.set('isr-shared', { html: '<p>hi</p>' }, { tags: ['shared'] });

    // Invalidate via ISR — should delete both entries
    await isrHandler.revalidateTag('shared');

    expect(testClient.has('uc-shared')).toBe(false);
    expect(testClient.has('isr-shared')).toBe(false);
  });
});
