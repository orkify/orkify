import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SerializedCacheEntry } from './types.js';
import { CACHE_DIR } from '../constants.js';

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

    // Atomic write: temp file → rename
    const tmpPath = this.filePath + '.tmp';
    await writeFile(tmpPath, JSON.stringify(entries), 'utf-8');
    await rename(tmpPath, this.filePath);
  }

  async load(): Promise<Array<[string, SerializedCacheEntry]>> {
    if (!existsSync(this.filePath)) {
      return [];
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const entries: Array<[string, SerializedCacheEntry]> = JSON.parse(content);

      // Filter out expired entries
      const now = Date.now();
      return entries.filter(([, entry]) => entry.expiresAt === undefined || entry.expiresAt > now);
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
