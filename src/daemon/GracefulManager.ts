import { EventEmitter } from 'node:events';
import type { ManagedProcess } from './ManagedProcess.js';

export class GracefulManager extends EventEmitter {
  private reloadInProgress = new Map<number, boolean>();

  async reload(container: ManagedProcess): Promise<void> {
    const processId = container.id;

    if (this.reloadInProgress.get(processId)) {
      throw new Error(`Reload already in progress for process ${container.config.name}`);
    }

    this.reloadInProgress.set(processId, true);

    this.emit('reload:start', {
      processName: container.config.name,
      processId: container.id,
    });

    try {
      await container.reload();

      this.emit('reload:complete', {
        processName: container.config.name,
        processId: container.id,
      });
    } finally {
      this.reloadInProgress.delete(processId);
    }
  }

  isReloading(processId: number): boolean {
    return this.reloadInProgress.get(processId) || false;
  }
}
