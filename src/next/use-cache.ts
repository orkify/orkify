import type { NextCacheEntry, NextCacheHandler, StoredCacheEntry } from './types.js';
import { cache } from '../cache/index.js';
import { bufferToStream, streamToBuffer } from './stream.js';

const REVALIDATING_PREFIX = '__revalidating:';
const REVALIDATING_TTL = 30; // seconds

const handler: NextCacheHandler = {
  async get(cacheKey: string, softTags: string[]): Promise<NextCacheEntry | undefined> {
    const stored = cache.get<StoredCacheEntry>(cacheKey);
    if (!stored) return undefined;

    const now = Date.now();

    // Hard expiration — not coalesced (entry is genuinely expired)
    if (stored.expire > 0 && now > stored.timestamp + stored.expire * 1000) {
      cache.delete(cacheKey);
      return undefined;
    }

    // Revalidation window — coalesce concurrent revalidations
    if (stored.revalidate > 0 && now > stored.timestamp + stored.revalidate * 1000) {
      if (cache.has(REVALIDATING_PREFIX + cacheKey)) {
        // Another worker is already revalidating — serve stale content
        return {
          value: bufferToStream(stored.buffer),
          tags: stored.tags,
          stale: stored.stale,
          timestamp: stored.timestamp,
          expire: stored.expire,
          revalidate: stored.revalidate,
        };
      }
      // Claim the revalidation lock
      cache.set(REVALIDATING_PREFIX + cacheKey, true, { ttl: REVALIDATING_TTL });
      return undefined;
    }

    // Soft tag invalidation — not coalesced (explicit invalidation should always miss)
    if (softTags.length > 0 && cache.getTagExpiration(softTags) > stored.timestamp) {
      return undefined;
    }

    return {
      value: bufferToStream(stored.buffer),
      tags: stored.tags,
      stale: stored.stale,
      timestamp: stored.timestamp,
      expire: stored.expire,
      revalidate: stored.revalidate,
    };
  },

  async set(cacheKey: string, pendingEntry: Promise<NextCacheEntry>): Promise<void> {
    const entry = await pendingEntry;
    const buffer = await streamToBuffer(entry.value);

    const stored: StoredCacheEntry = {
      buffer,
      tags: entry.tags,
      stale: entry.stale,
      timestamp: entry.timestamp,
      expire: entry.expire,
      revalidate: entry.revalidate,
    };

    cache.set(cacheKey, stored, {
      tags: entry.tags,
      ttl: entry.expire > 0 ? entry.expire : undefined,
    });

    // Clear the revalidation lock now that fresh content is stored
    cache.delete(REVALIDATING_PREFIX + cacheKey);
  },

  async refreshTags(): Promise<void> {
    // No-op — IPC keeps workers in sync
  },

  async getExpiration(tags: string[]): Promise<number> {
    return cache.getTagExpiration(tags);
  },

  async updateTags(tags: string[], durations?: { expire?: number }): Promise<void> {
    for (const tag of tags) {
      if (durations?.expire !== undefined) {
        cache.updateTagTimestamp(tag, Date.now() + durations.expire * 1000);
      } else {
        cache.invalidateTag(tag);
      }
    }
  },
};

export default handler;
