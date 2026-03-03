import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SerializedCacheEntry } from './types.js';
import { CACHE_DIR } from '../constants.js';
import { deserialize, serialize, type Serialized } from './serialize.js';

/** On-disk format — values are encoded as { data, encoding } */
interface DiskEntry {
  expiresAt?: number;
  tags?: string[];
  value: Serialized;
}

export class CachePersistence {
  private filePath: string;

  constructor(processName: string) {
    this.filePath = join(CACHE_DIR, `${processName}.json`);
  }

  async save(entries: Array<[string, SerializedCacheEntry]>): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const diskEntries: Array<[string, DiskEntry]> = entries.map(([key, entry]) => {
      const disk: DiskEntry = {
        value: serialize(entry.value),
        expiresAt: entry.expiresAt,
      };
      if (entry.tags && entry.tags.length > 0) {
        disk.tags = entry.tags;
      }
      return [key, disk];
    });

    // Atomic write: temp file → rename
    const tmpPath = this.filePath + '.tmp';
    await writeFile(tmpPath, JSON.stringify(diskEntries), 'utf-8');
    await rename(tmpPath, this.filePath);
  }

  async load(): Promise<Array<[string, SerializedCacheEntry]>> {
    if (!existsSync(this.filePath)) {
      return [];
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const raw: Array<[string, DiskEntry]> = JSON.parse(content);

      const now = Date.now();
      return raw
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
    } catch (err) {
      console.warn(`[orkify:cache] Failed to load cache from ${this.filePath}:`, err);
      return [];
    }
  }

  async clear(): Promise<void> {
    if (existsSync(this.filePath)) {
      await unlink(this.filePath);
    }
  }
}
