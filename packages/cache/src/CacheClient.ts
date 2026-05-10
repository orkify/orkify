import { randomUUID } from 'node:crypto';
import type {
  CacheBroadcastClearMessage,
  CacheBroadcastDeleteMessage,
  CacheBroadcastIncrResultMessage,
  CacheBroadcastInvalidateTagMessage,
  CacheBroadcastSetMessage,
  CacheBroadcastUpdateTagTimestampMessage,
  CacheConfig,
  CacheSetOptions,
  CacheSnapshotMessage,
  CacheStats,
  ICacheStore,
} from './types.js';
import { CACHE_DEFAULT_MAX_VALUE_SIZE } from './constants.js';
import { CacheFileStore } from './CacheFileStore.js';
import { CacheStore } from './CacheStore.js';
import { IncrDedupCache } from './IncrDedupCache.js';
import { serialize, serializedByteLength } from './serialize.js';

const DEFAULT_INCR_TIMEOUT_MS = 5000;
const DEFAULT_INCR_MAX_ATTEMPTS = 3;

export interface CacheIncrOptions {
  /** Override the auto-generated idempotency key (e.g., to dedup retries from an HTTP request). */
  idempotencyKey?: string;
  /** Max retry attempts on timeout (default 3). Each attempt gets timeoutMs/maxAttempts. */
  maxAttempts?: number;
  /** Total time budget across all attempts (default 5000 ms). */
  timeoutMs?: number;
  /** TTL in seconds applied only when the key is created. Subsequent incrs do not extend it. */
  ttlIfNew?: number;
}

export class IncrTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncrTimeoutError';
  }
}

interface PendingIncr {
  reject: (err: Error) => void;
  resolve: (value: number) => void;
  timer: ReturnType<typeof setTimeout>;
}

type CacheInboundMessage =
  | CacheBroadcastClearMessage
  | CacheBroadcastDeleteMessage
  | CacheBroadcastIncrResultMessage
  | CacheBroadcastInvalidateTagMessage
  | CacheBroadcastSetMessage
  | CacheBroadcastUpdateTagTimestampMessage
  | CacheSnapshotMessage;

export class CacheClient {
  private clusterMode: boolean;
  private defaultTtl: number | undefined;
  private incrDedup = new IncrDedupCache();
  private maxValueSize: number;
  private messageHandler: ((msg: unknown) => void) | undefined;
  private nextRequestId = 0;
  private pendingIncrs = new Map<number, PendingIncr>();
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

      // IPC flush for graceful shutdown (works cross-platform including Windows
      // where SIGTERM doesn't trigger exit handlers)
      process.on('message', (msg: unknown) => {
        const m = msg as { __orkify?: boolean; type?: string };
        if (m?.__orkify && m.type === 'cache:flush') {
          fileStore.flushSync();
          try {
            process.send?.({ __orkify: true, type: 'cache:flushed' });
          } catch {
            // parent may have disconnected
          }
          process.exit(0);
        }
      });

      // Fallback: also flush on exit event (works on Unix via SIGTERM → exit)
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

  async incr(key: string, delta: number = 1, options?: CacheIncrOptions): Promise<number> {
    if (options?.ttlIfNew !== undefined && options.ttlIfNew <= 0) {
      throw new Error(`cache.incr: ttlIfNew must be positive, got ${options.ttlIfNew}`);
    }
    if (options?.timeoutMs !== undefined && options.timeoutMs <= 0) {
      throw new Error(`cache.incr: timeoutMs must be positive, got ${options.timeoutMs}`);
    }
    if (
      options?.maxAttempts !== undefined &&
      (!Number.isInteger(options.maxAttempts) || options.maxAttempts <= 0)
    ) {
      throw new Error(
        `cache.incr: maxAttempts must be a positive integer, got ${options.maxAttempts}`
      );
    }

    const idempotencyKey = options?.idempotencyKey ?? randomUUID();

    if (!this.clusterMode) {
      // Dedup in standalone too — same idempotencyKey returns the same result
      // (success or error) for the dedup TTL window. Auto-generated UUIDs never
      // collide so this only fires for caller-supplied keys.
      const cached = this.incrDedup.get(idempotencyKey);
      if (cached) {
        if (cached.error !== undefined) throw new Error(cached.error);
        return cached.value;
      }
      try {
        const expiresAtIfNew = options?.ttlIfNew ? Date.now() + options.ttlIfNew * 1000 : undefined;
        const value = this.store.incr(key, delta, expiresAtIfNew);
        this.incrDedup.record(idempotencyKey, { value });
        return value;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.incrDedup.record(idempotencyKey, { error: errorMsg });
        throw err;
      }
    }

    const totalBudget = options?.timeoutMs ?? DEFAULT_INCR_TIMEOUT_MS;
    const maxAttempts = options?.maxAttempts ?? DEFAULT_INCR_MAX_ATTEMPTS;
    const perAttemptMs = Math.max(1, Math.floor(totalBudget / maxAttempts));

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.sendIncrAttempt(
          key,
          delta,
          options?.ttlIfNew,
          idempotencyKey,
          perAttemptMs
        );
      } catch (err) {
        if (!(err instanceof IncrTimeoutError)) throw err;
        lastError = err;
      }
    }
    throw new Error(
      `cache.incr: exhausted ${maxAttempts} attempts (${totalBudget}ms total): ${lastError?.message ?? 'no response from primary'}`
    );
  }

  private sendIncrAttempt(
    key: string,
    delta: number,
    ttlIfNew: number | undefined,
    idempotencyKey: string,
    timeoutMs: number
  ): Promise<number> {
    const requestId = ++this.nextRequestId;
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingIncrs.delete(requestId);
        reject(
          new IncrTimeoutError(
            `cache.incr: timed out waiting for primary response after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
      timer.unref?.();

      this.pendingIncrs.set(requestId, { resolve, reject, timer });

      this.trySend({
        __orkify: true,
        type: 'cache:incr',
        key,
        delta,
        ttlIfNew,
        idempotencyKey,
        originatorPid: process.pid,
        requestId,
      });
    });
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
    // Reject any in-flight incrs so callers don't hang
    for (const pending of this.pendingIncrs.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('cache.incr: client destroyed before primary responded'));
    }
    this.pendingIncrs.clear();
    this.incrDedup.destroy();
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
      case 'cache:incr-result': {
        // Apply value locally so this worker stays in sync with the primary
        // (broadcast goes to all workers, including non-originators).
        if (message.value !== undefined) {
          this.store.applySet(message.key, message.value, message.expiresAt, message.tags);
        }
        // Resolve/reject the originating worker's pending promise. Match on
        // (pid, requestId) — workers each have their own counter, so a bare
        // requestId is not unique across the cluster.
        if (message.originatorPid === process.pid) {
          const pending = this.pendingIncrs.get(message.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingIncrs.delete(message.requestId);
            if (message.error) {
              pending.reject(new Error(message.error));
            } else if (message.value !== undefined) {
              pending.resolve(message.value);
            }
          }
        }
        break;
      }
    }
  }
}
