import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CacheConfig, CacheEntry, CacheSnapshot, CacheStats, ICacheStore } from './types.js';
import { CACHE_CLEANUP_INTERVAL } from './constants.js';
import { CacheStore } from './CacheStore.js';
import { deserialize, serialize, type Serialized, serializedByteLength } from './serialize.js';

/** Metadata stored in the disk index (no values — those are in individual files) */
interface DiskMeta {
  expiresAt?: number;
  file: string; // sha256.json
  tags?: string[];
  timestamp: number; // epoch ms when entry was written to disk
}

/** On-disk entry file format */
interface DiskEntry {
  expiresAt?: number;
  key: string;
  tags?: string[];
  timestamp: number; // epoch ms when entry was written to disk
  value: Serialized;
}

/** On-disk index format */
interface DiskIndex {
  entries: Record<string, DiskMeta>;
  tagTimestamps: Array<[string, number]>;
}

export class CacheFileStore implements ICacheStore {
  private cacheDir: string;
  private diskIndex = new Map<string, DiskMeta>();
  private diskSweepTimer: ReturnType<typeof setInterval> | undefined;
  private diskTagIndex = new Map<string, Set<string>>(); // tag → disk keys
  private entriesDir: string;
  private indexPath: string;
  private indexDirty = false;
  private loadIndexPromise: Promise<void> | undefined;
  private persistPromise: Promise<void> | undefined;
  private readOnly: boolean;
  private store: CacheStore;
  private tagTimestamps = new Map<string, number>(); // disk-only tag timestamps

  constructor(processName: string, config?: CacheConfig, options?: { readOnly?: boolean }) {
    this.readOnly = options?.readOnly ?? false;
    this.cacheDir = join(
      process.env.HOME ?? process.env.USERPROFILE ?? '.',
      '.orkify',
      'cache',
      processName
    );
    this.entriesDir = join(this.cacheDir, 'entries');
    this.indexPath = join(this.cacheDir, 'index.json');

    this.store = new CacheStore(
      config,
      this.readOnly
        ? undefined
        : (key, entry, reason) => {
            if (reason === 'lru') {
              // Spill evicted entry to disk (fire-and-forget)
              void this.writeToDisk(key, entry);
            } else if (reason === 'expired') {
              // Clean expired entry from disk
              void this.deleteFromDisk(key);
            }
          }
    );

    if (!this.readOnly) {
      // Periodic disk sweep for expired entries
      this.diskSweepTimer = setInterval(() => void this.sweepDisk(), CACHE_CLEANUP_INTERVAL);
      this.diskSweepTimer.unref();

      // Load disk index from any previous session (entries promoted lazily via getAsync).
      // Store the promise so getAsync can await it before checking the index.
      this.loadIndexPromise = this.loadIndex();
    }
  }

  // --- ICacheStore public API ---

  get<T>(key: string): T | undefined {
    return this.store.get<T>(key);
  }

  async getAsync<T>(key: string): Promise<T | undefined> {
    // Hot path: sync memory lookup
    const memValue = this.store.get<T>(key);
    if (memValue !== undefined) return memValue;

    // Ensure disk index is loaded from any previous session before checking it
    if (this.loadIndexPromise) {
      await this.loadIndexPromise;
      this.loadIndexPromise = undefined;
    }

    // Cold path: check disk index (populated in full mode, empty in readOnly mode)
    const meta = this.diskIndex.get(key);

    // In full mode, if not in index it's a true miss.
    // In readOnly mode, diskIndex is empty — always try file directly.
    if (!meta && !this.readOnly) return undefined;

    // Compute file path: from index if available, otherwise derive from key hash
    const fileName = meta?.file ?? createHash('sha256').update(key).digest('hex') + '.json';
    const filePath = join(this.entriesDir, fileName);

    try {
      const content = await readFile(filePath, 'utf-8');
      const disk: DiskEntry = JSON.parse(content);

      // Check TTL expiration
      if (disk.expiresAt !== undefined && disk.expiresAt < Date.now()) {
        if (!this.readOnly) void this.deleteFromDisk(key);
        return undefined;
      }

      // Check tag timestamps — if any tag was invalidated after the entry was written, it's stale
      if (disk.tags && disk.tags.length > 0) {
        const tagExp = this.getTagExpiration(disk.tags);
        if (tagExp > disk.timestamp) {
          if (!this.readOnly) void this.deleteFromDisk(key);
          return undefined;
        }
      }

      // Deserialize the value
      const value = deserialize(disk.value) as T;

      // Promote to memory (may evict other entries to disk via callback in full mode;
      // in readOnly mode evictions just drop since there's no onEvict)
      this.store.set(key, value, disk.expiresAt, disk.tags);

      // In full mode, remove from disk index (it's now in memory)
      if (meta && !this.readOnly) {
        this.removeDiskMeta(key);
      }

      return value;
    } catch {
      // File read/parse failed — remove stale index entry in full mode
      if (meta && !this.readOnly) {
        this.removeDiskMeta(key);
      }
      return undefined;
    }
  }

  set(
    key: string,
    value: unknown,
    expiresAt?: number,
    tags?: string[],
    precomputedByteSize?: number
  ): void {
    // Remove from disk if it exists there (we're overwriting)
    if (this.diskIndex.has(key)) {
      void this.deleteFromDisk(key);
    }
    this.store.set(key, value, expiresAt, tags, precomputedByteSize);
  }

  delete(key: string): boolean {
    const memDeleted = this.store.delete(key);
    const diskHad = this.diskIndex.has(key);
    if (diskHad) {
      void this.deleteFromDisk(key);
    }
    return memDeleted || diskHad;
  }

  clear(): void {
    this.store.clear();
    // Clear all disk entries
    const diskKeys = [...this.diskIndex.keys()];
    for (const key of diskKeys) {
      void this.deleteFromDisk(key);
    }
    this.diskIndex.clear();
    this.diskTagIndex.clear();
    this.tagTimestamps.clear();
    this.indexDirty = true;
    void this.persistIndex();
  }

  has(key: string): boolean {
    if (this.store.has(key)) return true;
    const meta = this.diskIndex.get(key);
    if (!meta) return false;
    if (meta.expiresAt !== undefined && meta.expiresAt < Date.now()) {
      if (!this.readOnly) void this.deleteFromDisk(key);
      return false;
    }
    return true;
  }

  stats(): CacheStats {
    const base = this.store.stats();
    return { ...base, diskSize: this.diskIndex.size };
  }

  invalidateTag(tag: string): string[] {
    // Invalidate in memory
    const deleted = this.store.invalidateTag(tag);

    // Record tag timestamp for disk entries
    this.tagTimestamps.set(tag, Date.now());

    // Delete disk entries with this tag
    const diskKeys = this.diskTagIndex.get(tag);
    if (diskKeys && diskKeys.size > 0) {
      for (const key of [...diskKeys]) {
        void this.deleteFromDisk(key);
      }
    }

    return deleted;
  }

  getTagExpiration(tags: string[]): number {
    // Check both in-memory store and disk-level tag timestamps
    const memExp = this.store.getTagExpiration(tags);
    let diskExp = 0;
    for (const tag of tags) {
      const ts = this.tagTimestamps.get(tag);
      if (ts !== undefined && ts > diskExp) {
        diskExp = ts;
      }
    }
    return Math.max(memExp, diskExp);
  }

  applyTagTimestamp(tag: string, timestamp: number): void {
    this.store.applyTagTimestamp(tag, timestamp);
    this.tagTimestamps.set(tag, timestamp);
  }

  applySet(key: string, value: unknown, expiresAt?: number, tags?: string[]): void {
    if (this.diskIndex.has(key)) {
      void this.deleteFromDisk(key);
    }
    this.store.applySet(key, value, expiresAt, tags);
  }

  applyDelete(key: string): void {
    this.store.applyDelete(key);
    if (this.diskIndex.has(key)) {
      void this.deleteFromDisk(key);
    }
  }

  applySnapshot(snapshot: CacheSnapshot): void {
    this.store.applySnapshot(snapshot);
    // Snapshot replaces everything — clear disk too
    for (const key of [...this.diskIndex.keys()]) {
      void this.deleteFromDisk(key);
    }
    this.diskIndex.clear();
    this.diskTagIndex.clear();
    // Merge tag timestamps from snapshot
    this.tagTimestamps.clear();
    for (const [tag, ts] of snapshot.tagTimestamps) {
      this.tagTimestamps.set(tag, ts);
    }
    this.indexDirty = true;
    void this.persistIndex();
  }

  serialize(): CacheSnapshot {
    return this.store.serialize();
  }

  destroy(): void {
    if (this.diskSweepTimer) {
      clearInterval(this.diskSweepTimer);
      this.diskSweepTimer = undefined;
    }
    this.store.destroy();
    this.diskIndex.clear();
    this.diskTagIndex.clear();
    this.tagTimestamps.clear();
  }

  // --- File-backed specific methods ---

  /** Flush all in-memory entries to disk (called on graceful shutdown). No-op in readOnly mode. */
  async flush(): Promise<void> {
    if (this.readOnly) return;
    const snapshot = this.store.serialize();
    for (const [key, entry] of snapshot.entries) {
      const byteSize = serializedByteLength(serialize(entry.value));
      await this.writeToDisk(key, {
        byteSize,
        value: entry.value,
        expiresAt: entry.expiresAt,
        lastAccessedAt: Date.now(),
        tags: entry.tags,
      });
    }
    // Force a final index write — fire-and-forget calls from writeToDisk may have
    // already persisted a partial index and cleared the dirty flag
    this.indexDirty = true;
    await this.persistIndex();
  }

  /** Synchronous flush for use in process 'exit' handlers where async I/O is unavailable. */
  flushSync(): void {
    if (this.readOnly) return;
    const snapshot = this.store.serialize();
    if (snapshot.entries.length === 0) return;

    mkdirSync(this.entriesDir, { recursive: true });

    for (const [key, entry] of snapshot.entries) {
      const fileName = createHash('sha256').update(key).digest('hex') + '.json';
      const filePath = join(this.entriesDir, fileName);
      const now = Date.now();
      const disk: DiskEntry = {
        key,
        value: serialize(entry.value),
        expiresAt: entry.expiresAt,
        tags: entry.tags,
        timestamp: now,
      };
      writeFileSync(filePath, JSON.stringify(disk), 'utf-8');

      const meta: DiskMeta = { file: fileName, expiresAt: entry.expiresAt, timestamp: now };
      if (entry.tags && entry.tags.length > 0) meta.tags = entry.tags;
      this.diskIndex.set(key, meta);
      if (entry.tags) {
        for (const tag of entry.tags) {
          let keys = this.diskTagIndex.get(tag);
          if (!keys) {
            keys = new Set();
            this.diskTagIndex.set(tag, keys);
          }
          keys.add(key);
        }
      }
    }

    mkdirSync(this.cacheDir, { recursive: true });
    const data: DiskIndex = {
      entries: Object.fromEntries(this.diskIndex),
      tagTimestamps: [...this.tagTimestamps],
    };
    writeFileSync(this.indexPath, JSON.stringify(data), 'utf-8');
  }

  /** Load disk index on startup (values are loaded lazily on access). No-op in readOnly mode. */
  async loadIndex(): Promise<void> {
    if (this.readOnly) return;
    if (!existsSync(this.indexPath)) return;

    try {
      const content = await readFile(this.indexPath, 'utf-8');
      const data: DiskIndex = JSON.parse(content);

      this.diskIndex.clear();
      this.diskTagIndex.clear();

      const now = Date.now();
      for (const [key, meta] of Object.entries(data.entries)) {
        // Skip expired entries
        if (meta.expiresAt !== undefined && meta.expiresAt < now) continue;
        // Ensure timestamp exists (older indexes may lack it)
        if (!meta.timestamp) meta.timestamp = now;
        this.diskIndex.set(key, meta);
        if (meta.tags) {
          for (const tag of meta.tags) {
            let keys = this.diskTagIndex.get(tag);
            if (!keys) {
              keys = new Set();
              this.diskTagIndex.set(tag, keys);
            }
            keys.add(key);
          }
        }
      }

      // Restore tag timestamps
      if (data.tagTimestamps) {
        for (const [tag, ts] of data.tagTimestamps) {
          this.tagTimestamps.set(tag, ts);
          this.store.applyTagTimestamp(tag, ts);
        }
      }
    } catch {
      // Corrupted index — start fresh
      this.diskIndex.clear();
      this.diskTagIndex.clear();
    }
  }

  // --- Private helpers ---

  private async writeToDisk(key: string, entry: CacheEntry): Promise<void> {
    try {
      await mkdir(this.entriesDir, { recursive: true });

      const fileName = createHash('sha256').update(key).digest('hex') + '.json';
      const filePath = join(this.entriesDir, fileName);

      const now = Date.now();
      const disk: DiskEntry = {
        key,
        value: serialize(entry.value),
        expiresAt: entry.expiresAt,
        tags: entry.tags,
        timestamp: now,
      };

      // Atomic write
      const tmpPath = filePath + '.tmp';
      await writeFile(tmpPath, JSON.stringify(disk), 'utf-8');
      await rename(tmpPath, filePath);

      // Update disk index
      const meta: DiskMeta = { file: fileName, expiresAt: entry.expiresAt, timestamp: now };
      if (entry.tags && entry.tags.length > 0) {
        meta.tags = entry.tags;
      }
      this.diskIndex.set(key, meta);

      // Update disk tag index
      if (entry.tags) {
        for (const tag of entry.tags) {
          let keys = this.diskTagIndex.get(tag);
          if (!keys) {
            keys = new Set();
            this.diskTagIndex.set(tag, keys);
          }
          keys.add(key);
        }
      }

      this.indexDirty = true;
      void this.persistIndex();
    } catch {
      // Disk write failed — entry stays in-memory only
    }
  }

  private async deleteFromDisk(key: string): Promise<void> {
    const meta = this.diskIndex.get(key);
    if (!meta) return;

    this.removeDiskMeta(key);

    try {
      const filePath = join(this.entriesDir, meta.file);
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
    } catch {
      // File already gone or inaccessible — ok
    }

    this.indexDirty = true;
    void this.persistIndex();
  }

  private removeDiskMeta(key: string): void {
    const meta = this.diskIndex.get(key);
    if (!meta) return;

    // Remove from disk tag index
    if (meta.tags) {
      for (const tag of meta.tags) {
        const keys = this.diskTagIndex.get(tag);
        if (keys) {
          keys.delete(key);
          if (keys.size === 0) {
            this.diskTagIndex.delete(tag);
          }
        }
      }
    }

    this.diskIndex.delete(key);
    this.indexDirty = true;
  }

  private async sweepDisk(): Promise<void> {
    const now = Date.now();
    for (const [key, meta] of [...this.diskIndex]) {
      if (meta.expiresAt !== undefined && meta.expiresAt < now) {
        await this.deleteFromDisk(key);
      }
    }
  }

  private async persistIndex(): Promise<void> {
    if (this.readOnly || !this.indexDirty) return;
    this.indexDirty = false;

    const doWrite = async (): Promise<void> => {
      try {
        await mkdir(this.cacheDir, { recursive: true });

        const data: DiskIndex = {
          entries: Object.fromEntries(this.diskIndex),
          tagTimestamps: [...this.tagTimestamps],
        };

        const tmpPath = this.indexPath + '.tmp';
        await writeFile(tmpPath, JSON.stringify(data), 'utf-8');
        await rename(tmpPath, this.indexPath);
      } catch {
        // Index write failed — will retry on next change
        this.indexDirty = true;
      }
    };

    // Chain onto any in-flight write so they don't overlap
    this.persistPromise = (this.persistPromise ?? Promise.resolve()).then(doWrite);
    await this.persistPromise;

    // If new changes arrived during the write, persist again
    if (this.indexDirty) {
      void this.persistIndex();
    }
  }
}
