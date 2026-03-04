/**
 * Next.js cache handler interfaces, mirrored here so orkify doesn't
 * depend on `next` as a package dependency.
 */

/** What Next.js passes to / expects from the 'use cache' handler. */
export interface NextCacheEntry {
  expire: number; // seconds, hard max lifetime
  revalidate: number; // seconds, revalidation interval
  stale: number; // seconds
  tags: string[];
  timestamp: number; // ms, when created
  value: ReadableStream<Uint8Array>;
}

/** 'use cache' handler — 5 methods. */
export interface NextCacheHandler {
  get(cacheKey: string, softTags: string[]): Promise<NextCacheEntry | undefined>;
  getExpiration(tags: string[]): Promise<number>;
  refreshTags(): Promise<void>;
  set(cacheKey: string, pendingEntry: Promise<NextCacheEntry>): Promise<void>;
  updateTags(tags: string[], durations?: { expire?: number }): Promise<void>;
}

/** What we actually store in orkify/cache (Buffer instead of stream). */
export interface StoredCacheEntry {
  buffer: Buffer;
  expire: number;
  revalidate: number;
  stale: number;
  tags: string[];
  timestamp: number;
}

/** ISR / route cache handler — 4 methods. */
export interface NextISRCacheHandler {
  get(key: string): Promise<null | unknown>;
  resetRequestCache(): void;
  revalidateTag(tag: string | string[]): Promise<void>;
  set(key: string, data: unknown, ctx: { tags: string[] }): Promise<void>;
}
