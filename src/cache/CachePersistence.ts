import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CacheSnapshot, SerializedCacheEntry } from './types.js';
import { CACHE_DIR } from '../constants.js';
import { deserialize, serialize, type Serialized } from './serialize.js';

/** On-disk format — values are encoded as { data, encoding } */
interface DiskEntry {
  expiresAt?: number;
  tags?: string[];
  value: Serialized;
}

interface DiskSnapshot {
  entries: Array<[string, DiskEntry]>;
  tagTimestamps: Array<[string, number]>;
}

export class CachePersistence {
  private filePath: string;

  constructor(processName: string) {
    this.filePath = join(CACHE_DIR, `${processName}.json`);
  }

  async save(snapshot: CacheSnapshot): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const diskEntries: Array<[string, DiskEntry]> = snapshot.entries.map(([key, entry]) => {
      const disk: DiskEntry = {
        value: serialize(entry.value),
        expiresAt: entry.expiresAt,
      };
      if (entry.tags && entry.tags.length > 0) {
        disk.tags = entry.tags;
      }
      return [key, disk];
    });

    const diskData: DiskSnapshot = { entries: diskEntries, tagTimestamps: snapshot.tagTimestamps };

    // Atomic write: temp file → rename
    const tmpPath = this.filePath + '.tmp';
    await writeFile(tmpPath, JSON.stringify(diskData), 'utf-8');
    await rename(tmpPath, this.filePath);
  }

  async load(): Promise<CacheSnapshot> {
    if (!existsSync(this.filePath)) {
      return { entries: [], tagTimestamps: [] };
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const raw: DiskSnapshot = JSON.parse(content);
      const diskEntries = raw.entries;
      const tagTimestamps = raw.tagTimestamps;

      const now = Date.now();
      const entries: Array<[string, SerializedCacheEntry]> = diskEntries
        .filter(([, entry]) => entry.expiresAt === undefined || entry.expiresAt > now)
        .map(([key, entry]) => {
          const result: SerializedCacheEntry = {
            value: deserialize(entry.value),
            expiresAt: entry.expiresAt,
          };
          if (entry.tags) {
            result.tags = entry.tags;
          }
          return [key, result] as [string, SerializedCacheEntry];
        });

      return { entries, tagTimestamps };
    } catch (err) {
      console.warn(`[orkify:cache] Failed to load cache from ${this.filePath}:`, err);
      return { entries: [], tagTimestamps: [] };
    }
  }

  async clear(): Promise<void> {
    if (existsSync(this.filePath)) {
      await unlink(this.filePath);
    }
  }
}
