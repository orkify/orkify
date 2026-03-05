export interface CacheConfig {
  defaultTtl?: number; // seconds, undefined = no expiry
  fileBacked?: boolean; // file-backed cold layer (default: true)
  maxEntries?: number;
  maxMemorySize?: number; // bytes — triggers byte-based LRU when set
  maxValueSize?: number; // bytes
}

export interface CacheSetOptions {
  tags?: string[];
  ttl?: number; // seconds
}

export interface CacheStats {
  diskSize?: number;
  hitRate: number;
  hits: number;
  misses: number;
  size: number;
  totalBytes: number;
}

export interface CacheEntry {
  byteSize: number;
  expiresAt?: number; // epoch ms
  lastAccessedAt: number;
  tags?: string[];
  value: unknown;
}

export interface SerializedCacheEntry {
  expiresAt?: number;
  tags?: string[];
  value: unknown;
}

export interface CacheSnapshot {
  entries: Array<[string, SerializedCacheEntry]>;
  tagTimestamps: Array<[string, number]>;
}

export type EvictReason = 'expired' | 'lru';

export interface ICacheStore {
  applyDelete(key: string): void;
  applySet(key: string, value: unknown, expiresAt?: number, tags?: string[]): void;
  applySnapshot(snapshot: CacheSnapshot): void;
  applyTagTimestamp(tag: string, timestamp: number): void;
  clear(): void;
  delete(key: string): boolean;
  destroy(): void;
  get<T>(key: string): T | undefined;
  getAsync<T>(key: string): Promise<T | undefined>;
  getTagExpiration(tags: string[]): number;
  has(key: string): boolean;
  invalidateTag(tag: string): string[];
  serialize(): CacheSnapshot;
  set(
    key: string,
    value: unknown,
    expiresAt?: number,
    tags?: string[],
    precomputedByteSize?: number
  ): void;
  stats(): CacheStats;
}

// IPC messages: Worker → Primary
export interface CacheSetMessage {
  __orkify: true;
  key: string;
  tags?: string[];
  ttl?: number;
  type: 'cache:set';
  value: unknown;
}

export interface CacheDeleteMessage {
  __orkify: true;
  key: string;
  type: 'cache:delete';
}

export interface CacheClearMessage {
  __orkify: true;
  type: 'cache:clear';
}

export interface CacheInvalidateTagMessage {
  __orkify: true;
  tag: string;
  type: 'cache:invalidate-tag';
}

export interface CacheUpdateTagTimestampMessage {
  __orkify: true;
  tag: string;
  tagTimestamp: number;
  type: 'cache:update-tag-timestamp';
}

export interface CacheConfigureMessage {
  __orkify: true;
  config: CacheConfig;
  type: 'cache:configure';
}

export type CacheWorkerMessage =
  | CacheClearMessage
  | CacheConfigureMessage
  | CacheDeleteMessage
  | CacheInvalidateTagMessage
  | CacheSetMessage
  | CacheUpdateTagTimestampMessage;

// IPC messages: Primary → Workers
export interface CacheBroadcastSetMessage {
  __orkify: true;
  expiresAt?: number;
  key: string;
  tags?: string[];
  type: 'cache:set';
  value: unknown;
}

export interface CacheBroadcastDeleteMessage {
  __orkify: true;
  key: string;
  type: 'cache:delete';
}

export interface CacheBroadcastClearMessage {
  __orkify: true;
  type: 'cache:clear';
}

export interface CacheBroadcastInvalidateTagMessage {
  __orkify: true;
  tag: string;
  tagTimestamp: number;
  type: 'cache:invalidate-tag';
}

export interface CacheBroadcastUpdateTagTimestampMessage {
  __orkify: true;
  tag: string;
  tagTimestamp: number;
  type: 'cache:update-tag-timestamp';
}

export interface CacheSnapshotMessage {
  __orkify: true;
  entries: Array<[string, SerializedCacheEntry]>;
  tagTimestamps: Array<[string, number]>;
  type: 'cache:snapshot';
}
