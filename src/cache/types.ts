export interface CacheConfig {
  defaultTtl?: number; // seconds, undefined = no expiry
  maxEntries?: number;
  maxValueSize?: number; // bytes
}

export interface CacheSetOptions {
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
  value: unknown;
}

export interface SerializedCacheEntry {
  expiresAt?: number;
  value: unknown;
}

// IPC messages: Worker → Primary
export interface CacheSetMessage {
  __orkify: true;
  key: string;
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

export type CacheWorkerMessage = CacheClearMessage | CacheDeleteMessage | CacheSetMessage;

// IPC messages: Primary → Workers
export interface CacheBroadcastSetMessage {
  __orkify: true;
  expiresAt?: number;
  key: string;
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

export interface CacheSnapshotMessage {
  __orkify: true;
  entries: Array<[string, SerializedCacheEntry]>;
  type: 'cache:snapshot';
}
