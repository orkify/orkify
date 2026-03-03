import type { CacheConfig, CacheEntry, CacheStats, SerializedCacheEntry } from './types.js';
import { CACHE_CLEANUP_INTERVAL, CACHE_DEFAULT_MAX_ENTRIES } from '../constants.js';

export class CacheStore {
  private entries = new Map<string, CacheEntry>();
  private hits = 0;
  private maxEntries: number;
  private misses = 0;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private tagIndex = new Map<string, Set<string>>(); // tag → keys

  constructor(config?: CacheConfig) {
    this.maxEntries = config?.maxEntries ?? CACHE_DEFAULT_MAX_ENTRIES;

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

  set(key: string, value: unknown, expiresAt?: number, tags?: string[]): void {
    const existing = this.entries.get(key);
    if (existing) {
      // Remove old tag associations before overwriting
      this.removeFromTagIndex(key, existing.tags);
    } else if (this.entries.size >= this.maxEntries) {
      this.evictLru();
    }
    this.entries.set(key, {
      value,
      expiresAt,
      lastAccessedAt: Date.now(),
      tags,
    });
    if (tags) {
      this.addToTagIndex(key, tags);
    }
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.removeFromTagIndex(key, entry.tags);
    this.entries.delete(key);
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.tagIndex.clear();
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
    };
  }

  /** Invalidate all entries with the given tag. Returns deleted keys. */
  invalidateTag(tag: string): string[] {
    const keys = this.tagIndex.get(tag);
    if (!keys || keys.size === 0) return [];

    const deleted: string[] = [];
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry) {
        // Remove this key from all its other tag sets
        this.removeFromTagIndex(key, entry.tags, tag);
        this.entries.delete(key);
        deleted.push(key);
      }
    }
    // Remove the tag itself from the index
    this.tagIndex.delete(tag);
    return deleted;
  }

  /** Apply a set from IPC — no broadcast triggered */
  applySet(key: string, value: unknown, expiresAt?: number, tags?: string[]): void {
    this.set(key, value, expiresAt, tags);
  }

  /** Apply a delete from IPC — no broadcast triggered */
  applyDelete(key: string): void {
    this.delete(key);
  }

  /** Apply a full snapshot from primary — replaces all entries */
  applySnapshot(entries: Array<[string, SerializedCacheEntry]>): void {
    this.entries.clear();
    this.tagIndex.clear();
    const now = Date.now();
    for (const [key, serialized] of entries) {
      // Skip expired entries
      if (serialized.expiresAt !== undefined && serialized.expiresAt < now) continue;
      const tags = serialized.tags;
      this.entries.set(key, {
        value: serialized.value,
        expiresAt: serialized.expiresAt,
        lastAccessedAt: now,
        tags,
      });
      if (tags) {
        this.addToTagIndex(key, tags);
      }
    }
  }

  /** Export for snapshots and persistence */
  serialize(): Array<[string, SerializedCacheEntry]> {
    const now = Date.now();
    const result: Array<[string, SerializedCacheEntry]> = [];
    for (const [key, entry] of this.entries) {
      // Skip expired entries
      if (entry.expiresAt !== undefined && entry.expiresAt < now) continue;
      const serialized: SerializedCacheEntry = { value: entry.value, expiresAt: entry.expiresAt };
      if (entry.tags && entry.tags.length > 0) {
        serialized.tags = entry.tags;
      }
      result.push([key, serialized]);
    }
    return result;
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.entries.clear();
    this.tagIndex.clear();
  }

  /** Remove all expired entries */
  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt < now) {
        this.removeEntry(key, entry);
      }
    }
  }

  /** Evict the entry with the oldest lastAccessedAt */
  private evictLru(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      const entry = this.entries.get(oldestKey);
      if (entry) {
        this.removeFromTagIndex(oldestKey, entry.tags);
      }
      this.entries.delete(oldestKey);
    }
  }

  /** Remove a key from the entries map and clean up its tag index entries */
  private removeEntry(key: string, entry: CacheEntry): void {
    this.removeFromTagIndex(key, entry.tags);
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
