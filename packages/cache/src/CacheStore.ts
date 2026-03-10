import type {
  CacheConfig,
  CacheEntry,
  CacheSnapshot,
  CacheStats,
  EvictReason,
  ICacheStore,
  SerializedCacheEntry,
} from './types.js';
import {
  CACHE_CLEANUP_INTERVAL,
  CACHE_DEFAULT_MAX_ENTRIES,
  CACHE_DEFAULT_MAX_MEMORY_SIZE,
} from './constants.js';
import { serialize, serializedByteLength } from './serialize.js';

export type OnEvictCallback = (key: string, entry: CacheEntry, reason: EvictReason) => void;

export class CacheStore implements ICacheStore {
  private entries = new Map<string, CacheEntry>();
  private hits = 0;
  private maxEntries: number;
  private maxMemorySize: number;
  private misses = 0;
  private onEvict: OnEvictCallback | undefined;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private tagIndex = new Map<string, Set<string>>(); // tag → keys
  private tagTimestamps = new Map<string, number>(); // tag → epoch ms of last invalidation
  totalBytes = 0;

  constructor(config?: CacheConfig, onEvict?: OnEvictCallback) {
    this.maxEntries = config?.maxEntries ?? CACHE_DEFAULT_MAX_ENTRIES;
    this.maxMemorySize = config?.maxMemorySize ?? CACHE_DEFAULT_MAX_MEMORY_SIZE;
    this.onEvict = onEvict;

    this.sweepTimer = setInterval(() => this.sweep(), CACHE_CLEANUP_INTERVAL);
    this.sweepTimer.unref();
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt !== undefined && entry.expiresAt < Date.now()) {
      this.removeEntry(key, entry);
      this.misses++;
      return undefined;
    }
    entry.lastAccessedAt = Date.now();
    this.hits++;
    return entry.value as T;
  }

  set(
    key: string,
    value: unknown,
    expiresAt?: number,
    tags?: string[],
    precomputedByteSize?: number
  ): void {
    const byteSize = precomputedByteSize ?? serializedByteLength(serialize(value));
    const existing = this.entries.get(key);
    if (existing) {
      // Remove old tag associations and byte count before overwriting
      this.removeFromTagIndex(key, existing.tags);
      this.totalBytes -= existing.byteSize;
    }

    // Evict until we're under both limits (entry count for new keys, byte limit always)
    while (this.overLimit(existing ? 0 : 1, byteSize)) {
      if (!this.evictLru()) break; // nothing left to evict
    }

    this.entries.set(key, {
      byteSize,
      value,
      expiresAt,
      lastAccessedAt: Date.now(),
      tags,
    });
    this.totalBytes += byteSize;
    if (tags) {
      this.addToTagIndex(key, tags);
    }
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.removeFromTagIndex(key, entry.tags);
    this.totalBytes -= entry.byteSize;
    this.entries.delete(key);
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.tagIndex.clear();
    this.tagTimestamps.clear();
    this.totalBytes = 0;
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== undefined && entry.expiresAt < Date.now()) {
      this.removeEntry(key, entry);
      return false;
    }
    return true;
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
      totalBytes: this.totalBytes,
    };
  }

  /** Invalidate all entries with the given tag. Returns deleted keys. */
  invalidateTag(tag: string): string[] {
    this.tagTimestamps.set(tag, Date.now());

    const keys = this.tagIndex.get(tag);
    if (!keys || keys.size === 0) return [];

    const deleted: string[] = [];
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry) {
        // Remove this key from all its other tag sets
        this.removeFromTagIndex(key, entry.tags, tag);
        this.totalBytes -= entry.byteSize;
        this.entries.delete(key);
        deleted.push(key);
      }
    }
    // Remove the tag itself from the index
    this.tagIndex.delete(tag);
    return deleted;
  }

  /** Returns the most recent invalidation timestamp across the given tags (0 if none). */
  getTagExpiration(tags: string[]): number {
    let max = 0;
    for (const tag of tags) {
      const ts = this.tagTimestamps.get(tag);
      if (ts !== undefined && ts > max) {
        max = ts;
      }
    }
    return max;
  }

  /** Set a tag invalidation timestamp without deleting entries (for IPC replay). */
  applyTagTimestamp(tag: string, timestamp: number): void {
    this.tagTimestamps.set(tag, timestamp);
  }

  async getAsync<T>(key: string): Promise<T | undefined> {
    return this.get<T>(key);
  }

  /** Apply a set from IPC — no broadcast triggered */
  applySet(key: string, value: unknown, expiresAt?: number, tags?: string[]): void {
    this.set(key, value, expiresAt, tags);
  }

  /** Apply a delete from IPC — no broadcast triggered */
  applyDelete(key: string): void {
    this.delete(key);
  }

  /** Apply a full snapshot from primary — replaces all entries and tag timestamps */
  applySnapshot(snapshot: CacheSnapshot): void {
    this.entries.clear();
    this.tagIndex.clear();
    this.tagTimestamps.clear();
    this.totalBytes = 0;
    const now = Date.now();
    for (const [key, serialized] of snapshot.entries) {
      // Skip expired entries
      if (serialized.expiresAt !== undefined && serialized.expiresAt < now) continue;
      const tags = serialized.tags;
      const byteSize = serializedByteLength(serialize(serialized.value));
      this.entries.set(key, {
        byteSize,
        value: serialized.value,
        expiresAt: serialized.expiresAt,
        lastAccessedAt: now,
        tags,
      });
      this.totalBytes += byteSize;
      if (tags) {
        this.addToTagIndex(key, tags);
      }
    }
    for (const [tag, ts] of snapshot.tagTimestamps) {
      this.tagTimestamps.set(tag, ts);
    }
  }

  /** Export for snapshots and persistence */
  serialize(): CacheSnapshot {
    const now = Date.now();
    const entries: Array<[string, SerializedCacheEntry]> = [];
    for (const [key, entry] of this.entries) {
      // Skip expired entries
      if (entry.expiresAt !== undefined && entry.expiresAt < now) continue;
      const serialized: SerializedCacheEntry = { value: entry.value, expiresAt: entry.expiresAt };
      if (entry.tags && entry.tags.length > 0) {
        serialized.tags = entry.tags;
      }
      entries.push([key, serialized]);
    }
    return { entries, tagTimestamps: [...this.tagTimestamps] };
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.entries.clear();
    this.tagIndex.clear();
    this.tagTimestamps.clear();
    this.totalBytes = 0;
  }

  /** Remove all expired entries */
  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt < now) {
        this.onEvict?.(key, entry, 'expired');
        this.removeEntry(key, entry);
      }
    }
  }

  /** Check if adding pendingEntries + pendingBytes would exceed limits */
  private overLimit(pendingEntries: number, pendingBytes: number): boolean {
    if (this.entries.size + pendingEntries > this.maxEntries) return true;
    if (this.totalBytes + pendingBytes > this.maxMemorySize) return true;
    return false;
  }

  /** Evict the entry with the oldest lastAccessedAt. Returns false if nothing to evict. */
  private evictLru(): boolean {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey === undefined) return false;
    const entry = this.entries.get(oldestKey);
    if (entry) {
      this.onEvict?.(oldestKey, entry, 'lru');
      this.removeFromTagIndex(oldestKey, entry.tags);
      this.totalBytes -= entry.byteSize;
    }
    this.entries.delete(oldestKey);
    return true;
  }

  /** Remove a key from the entries map and clean up its tag index entries */
  private removeEntry(key: string, entry: CacheEntry): void {
    this.removeFromTagIndex(key, entry.tags);
    this.totalBytes -= entry.byteSize;
    this.entries.delete(key);
  }

  /** Add a key to the tag index for each of its tags */
  private addToTagIndex(key: string, tags: string[]): void {
    for (const tag of tags) {
      let keys = this.tagIndex.get(tag);
      if (!keys) {
        keys = new Set();
        this.tagIndex.set(tag, keys);
      }
      keys.add(key);
    }
  }

  /** Remove a key from the tag index. Optionally skip a specific tag (already being deleted). */
  private removeFromTagIndex(key: string, tags?: string[], skipTag?: string): void {
    if (!tags) return;
    for (const tag of tags) {
      if (tag === skipTag) continue;
      const keys = this.tagIndex.get(tag);
      if (keys) {
        keys.delete(key);
        if (keys.size === 0) {
          this.tagIndex.delete(tag);
        }
      }
    }
  }
}
