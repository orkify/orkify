import type { NextISRCacheHandler } from './types.js';
import { cache } from '../cache/index.js';

const handler: NextISRCacheHandler = {
  async get(key: string): Promise<null | unknown> {
    return cache.get(key) ?? null;
  },

  async set(key: string, data: unknown, ctx: { tags: string[] }): Promise<void> {
    cache.set(key, data, { tags: ctx.tags });
  },

  async revalidateTag(tag: string | string[]): Promise<void> {
    const tags = Array.isArray(tag) ? tag : [tag];
    for (const t of tags) {
      cache.invalidateTag(t);
    }
  },

  resetRequestCache(): void {
    // No-op — shared cache, not per-request
  },
};

export default handler;
