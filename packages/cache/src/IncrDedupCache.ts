import { CACHE_CLEANUP_INTERVAL } from './constants.js';

export type IncrDedupEntry =
  | { error?: never; expiresAt?: number; tags?: string[]; timestamp: number; value: number }
  | { error: string; expiresAt?: never; tags?: never; timestamp: number; value?: never };

/** Inputs accepted by `record` — same union without the timestamp (added internally). */
export type IncrDedupRecord =
  | { error?: never; expiresAt?: number; tags?: string[]; value: number }
  | { error: string; expiresAt?: never; tags?: never; value?: never };

const DEFAULT_MAX_SIZE = 1000;
const DEFAULT_TTL_MS = 60_000;

/**
 * Bounded TTL cache used to dedup cache.incr calls by idempotency key.
 *
 * Same shape used by both CachePrimary (cluster mode, deduping IPC retries)
 * and CacheClient standalone mode (deduping caller-driven retries).
 *
 * - Map iteration order = chronological (`record` deletes-then-inserts so even
 *   overwrites move the entry to the end). Sweep relies on this to break early
 *   at the first non-expired entry.
 * - FIFO eviction at maxSize.
 * - Periodic sweep removes entries older than ttlMs.
 */
export class IncrDedupCache {
  private entries = new Map<string, IncrDedupEntry>();
  private maxSize: number;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private ttlMs: number;

  constructor(options?: { maxSize?: number; sweepIntervalMs?: number; ttlMs?: number }) {
    this.maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;

    const interval = options?.sweepIntervalMs ?? CACHE_CLEANUP_INTERVAL;
    this.sweepTimer = setInterval(() => this.sweep(), interval);
    this.sweepTimer.unref?.();
  }

  /** Number of entries currently held. Useful for tests and metrics; does not lazy-expire. */
  get size(): number {
    return this.entries.size;
  }

  get(idempotencyKey: string): IncrDedupEntry | undefined {
    const entry = this.entries.get(idempotencyKey);
    if (!entry) return undefined;
    if (entry.timestamp < Date.now() - this.ttlMs) {
      // Lazy expiry on read — sweep handles bulk cleanup
      this.entries.delete(idempotencyKey);
      return undefined;
    }
    return entry;
  }

  record(idempotencyKey: string, entry: IncrDedupRecord): void {
    // Delete first so an overwrite moves the entry to the end of insertion
    // order — preserves the chronological invariant that sweep relies on.
    if (this.entries.has(idempotencyKey)) {
      this.entries.delete(idempotencyKey);
    }
    if (this.entries.size >= this.maxSize) {
      // FIFO eviction — Map iteration is insertion order, oldest first
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(idempotencyKey, { ...entry, timestamp: Date.now() } as IncrDedupEntry);
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.entries.clear();
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.timestamp < cutoff) {
        this.entries.delete(key);
      } else {
        // Insertion order = chronological — anything after this is newer
        break;
      }
    }
  }
}
