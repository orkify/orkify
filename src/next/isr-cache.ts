import { cache } from '../cache/index.js';

/**
 * ISR / route cache handler for Next.js (`cacheHandler` config).
 * Next.js instantiates this with `new`, so it must be a class.
 *
 * Next.js expects `get()` to return `{ value, lastModified }` (the
 * `CacheHandlerValue` interface), so we wrap/unwrap around the raw
 * `IncrementalCacheValue` when storing in orkify/cache.
 *
 * During `next build`, this handler is a no-op — data stored in-memory
 * would be lost when the build process exits, causing invariant errors
 * at runtime when Next.js expects cached pages that no longer exist.
 * Pre-rendered pages are still served from disk (`.next/server/app/`).
 *
 * Headers objects (used by APP_ROUTE responses) don't survive V8
 * structured clone (IPC in cluster mode). We convert them to plain
 * objects on set so they work with both IPC and bracket-notation
 * access in Next.js internals.
 *
 * Cache tags are extracted from the `x-next-cache-tags` header (set by
 * Next.js for APP_PAGE/APP_ROUTE) and registered in orkify's tag index
 * so `revalidateTag()` → `cache.invalidateTag()` can find entries.
 */
const IS_BUILD = process.env.NEXT_PHASE === 'phase-production-build';
const NEXT_CACHE_TAGS_HEADER = 'x-next-cache-tags';

interface StoredEntry {
  lastModified: number;
  value: null | Record<string, unknown>;
}

/** Convert Headers to a plain object. Non-Headers pass through. */
function headersToPlainObject(headers: unknown): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    return Object.fromEntries([...(headers as Headers).entries()]);
  }
  if (Array.isArray(headers)) {
    // entries array from a previous version — normalize to plain object
    return Object.fromEntries(headers);
  }
  return headers as Record<string, string>;
}

/** Extract cache tags from the x-next-cache-tags header value. */
function extractTags(headers: Record<string, string> | undefined): string[] | undefined {
  const tagHeader = headers?.[NEXT_CACHE_TAGS_HEADER];
  if (typeof tagHeader === 'string' && tagHeader.length > 0) {
    return tagHeader.split(',');
  }
  return undefined;
}

export default class OrkifyCacheHandler {
  async get(key: string): Promise<null | unknown> {
    if (IS_BUILD) return null;

    const stored = await cache.getAsync<StoredEntry>(key);
    if (!stored) return null;

    return stored;
  }

  async set(key: string, data: unknown, ctx?: { tags?: string[] }): Promise<void> {
    if (IS_BUILD) return;

    let value = data as null | Record<string, unknown>;

    // Normalize Headers objects to plain objects for IPC and bracket-notation access
    if (value && 'headers' in value) {
      const plainHeaders = headersToPlainObject(value.headers);
      if (plainHeaders !== value.headers) {
        value = { ...value, headers: plainHeaders };
      }
    }

    // Gather tags: merge explicit ctx.tags with x-next-cache-tags header (deduplicated)
    const headerTags = value ? extractTags(value.headers as Record<string, string>) : undefined;
    const mergedTags =
      ctx?.tags && headerTags
        ? [...new Set([...ctx.tags, ...headerTags])]
        : (ctx?.tags ?? headerTags);
    const tags = mergedTags && mergedTags.length > 0 ? mergedTags : undefined;

    const entry: StoredEntry = { value, lastModified: Date.now() };
    cache.set(key, entry, tags ? { tags } : undefined);
  }

  async revalidateTag(tag: string | string[]): Promise<void> {
    const tags = Array.isArray(tag) ? tag : [tag];
    for (const t of tags) {
      cache.invalidateTag(t);
    }
  }

  resetRequestCache(): void {
    // No-op — shared cache, not per-request
  }
}
