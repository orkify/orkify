export interface CacheConfig {
  defaultTtl?: number; // seconds, undefined = no expiry
  maxEntries?: number;
  maxValueSize?: number; // bytes
}

export interface CacheSetOptions {
  tags?: string[];
  ttl?: number; // seconds
}

export interface CacheStats {
  hitRate: number;
  hits: number;
  misses: number;
  size: number;
}

export interface CacheEntry {
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

export type CacheWorkerMessage =
  | CacheClearMessage
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
