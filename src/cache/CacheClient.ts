import type {
  CacheBroadcastClearMessage,
  CacheBroadcastDeleteMessage,
  CacheBroadcastInvalidateTagMessage,
  CacheBroadcastSetMessage,
  CacheConfig,
  CacheSetOptions,
  CacheSnapshotMessage,
  CacheStats,
} from './types.js';
import { CACHE_DEFAULT_MAX_VALUE_SIZE } from '../constants.js';
import { CacheStore } from './CacheStore.js';
import { serialize, serializedByteLength } from './serialize.js';

type CacheInboundMessage =
  | CacheBroadcastClearMessage
  | CacheBroadcastDeleteMessage
  | CacheBroadcastInvalidateTagMessage
  | CacheBroadcastSetMessage
  | CacheSnapshotMessage;

export class CacheClient {
  private clusterMode: boolean;
  private defaultTtl: number | undefined;
  private maxValueSize: number;
  private messageHandler: ((msg: unknown) => void) | undefined;
  private store: CacheStore;

  constructor(config?: CacheConfig, bufferedMessages?: unknown[]) {
    this.store = new CacheStore(config);
    this.defaultTtl = config?.defaultTtl;
    this.maxValueSize = config?.maxValueSize ?? CACHE_DEFAULT_MAX_VALUE_SIZE;
    this.clusterMode =
      process.env.ORKIFY_CLUSTER_MODE === 'true' && typeof process.send === 'function';

    if (this.clusterMode) {
      this.messageHandler = (msg: unknown) => this.handleMessage(msg);
      process.on('message', this.messageHandler);

      // Drain any IPC messages that arrived before this client was created
      if (bufferedMessages) {
        for (const msg of bufferedMessages) {
          this.handleMessage(msg);
        }
      }
    }
  }

  get<T>(key: string): T | undefined {
    return this.store.get<T>(key);
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
    this.store.set(key, value, expiresAt, tags);

    if (this.clusterMode && process.send) {
      process.send({ __orkify: true, type: 'cache:set', key, value, ttl, tags });
    }
  }

  delete(key: string): void {
    this.store.delete(key);

    if (this.clusterMode && process.send) {
      process.send({ __orkify: true, type: 'cache:delete', key });
    }
  }

  clear(): void {
    this.store.clear();

    if (this.clusterMode && process.send) {
      process.send({ __orkify: true, type: 'cache:clear' });
    }
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  stats(): CacheStats {
    return this.store.stats();
  }

  invalidateTag(tag: string): void {
    this.store.invalidateTag(tag);

    if (this.clusterMode && process.send) {
      process.send({ __orkify: true, type: 'cache:invalidate-tag', tag });
    }
  }

  destroy(): void {
    if (this.messageHandler) {
      process.removeListener('message', this.messageHandler);
      this.messageHandler = undefined;
    }
    this.store.destroy();
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
        break;
      case 'cache:snapshot':
        this.store.applySnapshot(message.entries);
        break;
    }
  }
}
