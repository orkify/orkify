import type { CacheConfig, CacheEntry, CacheStats, SerializedCacheEntry } from './types.js';
import { CACHE_CLEANUP_INTERVAL, CACHE_DEFAULT_MAX_ENTRIES } from '../constants.js';

export class CacheStore {
  private entries = new Map<string, CacheEntry>();
  private hits = 0;
  private maxEntries: number;
  private misses = 0;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

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
      this.entries.delete(key);
      this.misses++;
      return undefined;
    }
    entry.lastAccessedAt = Date.now();
    this.hits++;
    return entry.value as T;
  }

  set(key: string, value: unknown, expiresAt?: number): void {
    const existing = this.entries.get(key);
    if (!existing && this.entries.size >= this.maxEntries) {
      this.evictLru();
    }
    this.entries.set(key, {
      value,
      expiresAt,
      lastAccessedAt: Date.now(),
    });
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== undefined && entry.expiresAt < Date.now()) {
      this.entries.delete(key);
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

  /** Apply a set from IPC — no broadcast triggered */
  applySet(key: string, value: unknown, expiresAt?: number): void {
    this.set(key, value, expiresAt);
  }

  /** Apply a delete from IPC — no broadcast triggered */
  applyDelete(key: string): void {
    this.entries.delete(key);
  }

  /** Apply a full snapshot from primary — replaces all entries */
  applySnapshot(entries: Array<[string, SerializedCacheEntry]>): void {
    this.entries.clear();
    const now = Date.now();
    for (const [key, serialized] of entries) {
      // Skip expired entries
      if (serialized.expiresAt !== undefined && serialized.expiresAt < now) continue;
      this.entries.set(key, {
        value: serialized.value,
        expiresAt: serialized.expiresAt,
        lastAccessedAt: now,
      });
    }
  }

  /** Export for snapshots and persistence */
  serialize(): Array<[string, SerializedCacheEntry]> {
    const now = Date.now();
    const result: Array<[string, SerializedCacheEntry]> = [];
    for (const [key, entry] of this.entries) {
      // Skip expired entries
      if (entry.expiresAt !== undefined && entry.expiresAt < now) continue;
      result.push([key, { value: entry.value, expiresAt: entry.expiresAt }]);
    }
    return result;
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.entries.clear();
  }

  /** Remove all expired entries */
  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt < now) {
        this.entries.delete(key);
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
      this.entries.delete(oldestKey);
    }
  }
}
