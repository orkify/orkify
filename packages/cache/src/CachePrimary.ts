import type { Worker } from 'node:cluster';
import type { CacheConfig, CacheWorkerMessage, ICacheStore } from './types.js';
import { CacheFileStore } from './CacheFileStore.js';
import { CachePersistence } from './CachePersistence.js';
import { CacheStore } from './CacheStore.js';

interface WorkerState {
  worker: Worker;
}

export class CachePrimary {
  private fileBacked: boolean;
  private persistence: CachePersistence;
  private processName: string;
  private store: ICacheStore;

  constructor(processName: string, config?: CacheConfig) {
    this.processName = processName;
    this.fileBacked = config?.fileBacked === true;
    this.store = this.fileBacked ? new CacheFileStore(processName, config) : new CacheStore(config);
    this.persistence = new CachePersistence(processName);
  }

  handleMessage(
    _worker: Worker,
    msg: CacheWorkerMessage,
    allWorkers: Map<number, WorkerState>
  ): void {
    switch (msg.type) {
      case 'cache:set': {
        const expiresAt = msg.ttl ? Date.now() + msg.ttl * 1000 : undefined;
        this.store.set(msg.key, msg.value, expiresAt, msg.tags);
        // Broadcast to ALL workers (including sender) for consistency
        for (const [, state] of allWorkers) {
          if (state.worker.isConnected()) {
            state.worker.send({
              __orkify: true,
              type: 'cache:set',
              key: msg.key,
              value: msg.value,
              expiresAt,
              tags: msg.tags,
            });
          }
        }
        break;
      }
      case 'cache:delete': {
        this.store.delete(msg.key);
        for (const [, state] of allWorkers) {
          if (state.worker.isConnected()) {
            state.worker.send({
              __orkify: true,
              type: 'cache:delete',
              key: msg.key,
            });
          }
        }
        break;
      }
      case 'cache:clear': {
        this.store.clear();
        for (const [, state] of allWorkers) {
          if (state.worker.isConnected()) {
            state.worker.send({ __orkify: true, type: 'cache:clear' });
          }
        }
        break;
      }
      case 'cache:invalidate-tag': {
        this.store.invalidateTag(msg.tag);
        const tagTimestamp = this.store.getTagExpiration([msg.tag]);
        for (const [, state] of allWorkers) {
          if (state.worker.isConnected()) {
            state.worker.send({
              __orkify: true,
              type: 'cache:invalidate-tag',
              tag: msg.tag,
              tagTimestamp,
            });
          }
        }
        break;
      }
      case 'cache:update-tag-timestamp': {
        this.store.applyTagTimestamp(msg.tag, msg.tagTimestamp);
        for (const [, state] of allWorkers) {
          if (state.worker.isConnected()) {
            state.worker.send({
              __orkify: true,
              type: 'cache:update-tag-timestamp',
              tag: msg.tag,
              tagTimestamp: msg.tagTimestamp,
            });
          }
        }
        break;
      }
      case 'cache:configure': {
        this.applyConfig(msg.config);
        break;
      }
    }
  }

  /**
   * Upgrade from CacheStore to CacheFileStore when a worker reports fileBacked config.
   * Migrates existing in-memory entries and loads the disk index from any previous session.
   */
  private applyConfig(config: CacheConfig): void {
    if (!config.fileBacked || this.fileBacked) return;

    const snapshot = this.store.serialize();
    const newStore = new CacheFileStore(this.processName, config);
    this.store.destroy();
    this.store = newStore;

    // Migrate existing in-memory entries (from CachePersistence restore or earlier sets)
    for (const [key, entry] of snapshot.entries) {
      this.store.set(key, entry.value, entry.expiresAt, entry.tags);
    }
    for (const [tag, ts] of snapshot.tagTimestamps) {
      this.store.applyTagTimestamp(tag, ts);
    }
    this.fileBacked = true;

    // Load disk index from previous file-backed sessions (async, entries promoted lazily)
    void (this.store as CacheFileStore).loadIndex();
  }

  sendSnapshot(worker: Worker): void {
    const snapshot = this.store.serialize();
    if (snapshot.entries.length === 0 && snapshot.tagTimestamps.length === 0) return;
    worker.send({
      __orkify: true,
      type: 'cache:snapshot',
      entries: snapshot.entries,
      tagTimestamps: snapshot.tagTimestamps,
    });
  }

  async persist(): Promise<void> {
    if (this.fileBacked) {
      await (this.store as CacheFileStore).flush();
      // Clear CachePersistence so stale snapshot data isn't loaded on next restart
      await this.persistence.clear();
    } else {
      const snapshot = this.store.serialize();
      await this.persistence.save(snapshot);
    }
  }

  async restore(): Promise<void> {
    if (this.fileBacked) {
      await (this.store as CacheFileStore).loadIndex();
    } else {
      const snapshot = await this.persistence.load();
      if (snapshot.entries.length > 0 || snapshot.tagTimestamps.length > 0) {
        this.store.applySnapshot(snapshot);
      }
    }
  }

  destroy(): void {
    this.store.destroy();
  }

  async shutdown(): Promise<void> {
    await this.persist();
    this.store.destroy();
  }
}
