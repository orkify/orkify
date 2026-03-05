import type {
  CacheBroadcastClearMessage,
  CacheBroadcastDeleteMessage,
  CacheBroadcastInvalidateTagMessage,
  CacheBroadcastSetMessage,
  CacheBroadcastUpdateTagTimestampMessage,
  CacheConfig,
  CacheSetOptions,
  CacheSnapshotMessage,
  CacheStats,
  ICacheStore,
} from './types.js';
import { CACHE_DEFAULT_MAX_VALUE_SIZE } from '../constants.js';
import { CacheFileStore } from './CacheFileStore.js';
import { CacheStore } from './CacheStore.js';
import { serialize, serializedByteLength } from './serialize.js';

type CacheInboundMessage =
  | CacheBroadcastClearMessage
  | CacheBroadcastDeleteMessage
  | CacheBroadcastInvalidateTagMessage
  | CacheBroadcastSetMessage
  | CacheBroadcastUpdateTagTimestampMessage
  | CacheSnapshotMessage;

export class CacheClient {
  private clusterMode: boolean;
  private defaultTtl: number | undefined;
  private maxValueSize: number;
  private messageHandler: ((msg: unknown) => void) | undefined;
  private store: ICacheStore;

  constructor(config?: CacheConfig, bufferedMessages?: unknown[]) {
    this.defaultTtl = config?.defaultTtl;
    this.maxValueSize = config?.maxValueSize ?? CACHE_DEFAULT_MAX_VALUE_SIZE;
    this.clusterMode =
      process.env.ORKIFY_CLUSTER_MODE === 'true' && typeof process.send === 'function';

    // File-backed: CacheFileStore for disk cold layer.
    // In cluster mode workers are readOnly (reads from disk, writes go through IPC to primary).
    // In standalone/fork mode the store has full read/write access.
    const fileBacked = config?.fileBacked === true;
    this.store = fileBacked
      ? new CacheFileStore(
          process.env.ORKIFY_PROCESS_NAME ?? 'default',
          config,
          this.clusterMode ? { readOnly: true } : undefined
        )
      : new CacheStore(config);

    // In fork/standalone mode, flush file-backed cache on process exit so all
    // entries (not just evicted ones) survive restarts. Uses synchronous I/O
    // since the 'exit' event doesn't support async operations.
    if (!this.clusterMode && fileBacked) {
      const fileStore = this.store as CacheFileStore;
      process.on('exit', () => fileStore.flushSync());
    }

    if (this.clusterMode) {
      this.messageHandler = (msg: unknown) => this.handleMessage(msg);
      process.on('message', this.messageHandler);

      // Drain any IPC messages that arrived before this client was created
      if (bufferedMessages) {
        for (const msg of bufferedMessages) {
          this.handleMessage(msg);
        }
      }

      // Notify the cluster primary about file-backed config so it can upgrade its store
      if (process.send && fileBacked) {
        this.trySend({
          __orkify: true,
          type: 'cache:configure',
          config: { ...config, fileBacked: true },
        });
      }
    }
  }

  /** Configure cache options. Must be called before any other method. Intercepted by the proxy in `cache/index.ts`. */
  configure(_config: CacheConfig): void {
    throw new Error('orkify/cache: configure() must be called via the cache singleton proxy');
  }

  get<T>(key: string): T | undefined {
    return this.store.get<T>(key);
  }

  async getAsync<T>(key: string): Promise<T | undefined> {
    return this.store.getAsync<T>(key);
  }

  set(key: string, value: unknown, opts?: CacheSetOptions): void {
    if (opts?.ttl !== undefined && opts.ttl <= 0) {
      throw new Error(`cache.set(): ttl must be positive, got ${opts.ttl}`);
    }

    // Validate serializability and size
    const serialized = serialize(value);
    const byteLength = serializedByteLength(serialized);
    if (byteLength > this.maxValueSize) {
      throw new Error(
        `cache.set(): value for key "${key}" is ${byteLength} bytes, exceeds max ${this.maxValueSize} bytes`
      );
    }

    const ttl = opts?.ttl ?? this.defaultTtl;
    const expiresAt = ttl ? Date.now() + ttl * 1000 : undefined;
    const tags = opts?.tags;
    this.store.set(key, value, expiresAt, tags, byteLength);

    if (this.clusterMode) {
      this.trySend({ __orkify: true, type: 'cache:set', key, value, ttl, tags });
    }
  }

  delete(key: string): void {
    this.store.delete(key);

    if (this.clusterMode) {
      this.trySend({ __orkify: true, type: 'cache:delete', key });
    }
  }

  clear(): void {
    this.store.clear();

    if (this.clusterMode) {
      this.trySend({ __orkify: true, type: 'cache:clear' });
    }
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  stats(): CacheStats {
    return this.store.stats();
  }

  getTagExpiration(tags: string[]): number {
    return this.store.getTagExpiration(tags);
  }

  invalidateTag(tag: string): void {
    this.store.invalidateTag(tag);

    if (this.clusterMode) {
      this.trySend({ __orkify: true, type: 'cache:invalidate-tag', tag });
    }
  }

  updateTagTimestamp(tag: string, timestamp?: number): void {
    const ts = timestamp ?? Date.now();
    this.store.applyTagTimestamp(tag, ts);

    if (this.clusterMode) {
      this.trySend({ __orkify: true, type: 'cache:update-tag-timestamp', tag, tagTimestamp: ts });
    }
  }

  destroy(): void {
    if (this.messageHandler) {
      process.removeListener('message', this.messageHandler);
      this.messageHandler = undefined;
    }
    this.store.destroy();
  }

  /** Send an IPC message to the cluster primary, silently ignoring failures (e.g. closed channel). */
  private trySend(msg: Record<string, unknown>): void {
    try {
      process.send?.(msg);
    } catch {
      // IPC channel closed — primary died or worker is shutting down
    }
  }

  private handleMessage(msg: unknown): void {
    const m = msg as { __orkify?: boolean; type?: string };
    if (!m?.__orkify || !m.type?.startsWith('cache:')) return;

    const message = msg as CacheInboundMessage;
    switch (message.type) {
      case 'cache:set':
        this.store.applySet(message.key, message.value, message.expiresAt, message.tags);
        break;
      case 'cache:delete':
        this.store.applyDelete(message.key);
        break;
      case 'cache:clear':
        this.store.clear();
        break;
      case 'cache:invalidate-tag':
        this.store.invalidateTag(message.tag);
        this.store.applyTagTimestamp(message.tag, message.tagTimestamp);
        break;
      case 'cache:update-tag-timestamp':
        this.store.applyTagTimestamp(message.tag, message.tagTimestamp);
        break;
      case 'cache:snapshot':
        this.store.applySnapshot({
          entries: message.entries,
          tagTimestamps: message.tagTimestamps,
        });
        break;
    }
  }
}
