import type { Worker } from 'node:cluster';
import type { CacheConfig, CacheWorkerMessage } from './types.js';
import { CachePersistence } from './CachePersistence.js';
import { CacheStore } from './CacheStore.js';

interface WorkerState {
  worker: Worker;
}

export class CachePrimary {
  private persistence: CachePersistence;
  private store: CacheStore;

  constructor(processName: string, config?: CacheConfig) {
    this.store = new CacheStore(config);
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
        for (const [, state] of allWorkers) {
          if (state.worker.isConnected()) {
            state.worker.send({
              __orkify: true,
              type: 'cache:invalidate-tag',
              tag: msg.tag,
            });
          }
        }
        break;
      }
    }
  }

  sendSnapshot(worker: Worker): void {
    const entries = this.store.serialize();
    if (entries.length === 0) return;
    worker.send({ __orkify: true, type: 'cache:snapshot', entries });
  }

  async persist(): Promise<void> {
    const entries = this.store.serialize();
    await this.persistence.save(entries);
  }

  async restore(): Promise<void> {
    const entries = await this.persistence.load();
    if (entries.length > 0) {
      this.store.applySnapshot(entries);
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
