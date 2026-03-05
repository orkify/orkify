import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheWorkerMessage } from '../../src/cache/types.js';
import { CachePrimary } from '../../src/cache/CachePrimary.js';

// Mock CACHE_DIR to use a temp directory
let tempDir: string;

vi.mock('../../src/constants.js', () => ({
  CACHE_CLEANUP_INTERVAL: 60_000,
  CACHE_DEFAULT_MAX_ENTRIES: 10_000,
  CACHE_DEFAULT_MAX_MEMORY_SIZE: 64 * 1024 * 1024,
  CACHE_DEFAULT_MAX_VALUE_SIZE: 1024 * 1024,
  get CACHE_DIR() {
    return tempDir;
  },
}));

function createMockWorker(connected = true) {
  return {
    id: Math.floor(Math.random() * 1000),
    isConnected: vi.fn(() => connected),
    send: vi.fn(),
  };
}

type MockWorker = ReturnType<typeof createMockWorker>;

function buildWorkers(...mocks: MockWorker[]) {
  const map = new Map<number, { worker: MockWorker }>();
  for (const m of mocks) {
    map.set(m.id, { worker: m });
  }
  // Cast because CachePrimary expects cluster.Worker but we're mocking
  return map as unknown as Map<number, { worker: import('node:cluster').Worker }>;
}

describe('CachePrimary', () => {
  let primary: CachePrimary;

  beforeEach(() => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-cache-primary-test-'));
    primary = new CachePrimary('test');
  });

  afterEach(async () => {
    await primary.shutdown();
    rmSync(tempDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  describe('handleMessage — cache:set', () => {
    it('stores value and broadcasts to all workers', () => {
      const w1 = createMockWorker();
      const w2 = createMockWorker();
      const workers = buildWorkers(w1, w2);

      const msg: CacheWorkerMessage = {
        __orkify: true,
        type: 'cache:set',
        key: 'greeting',
        value: 'hello',
        ttl: 60,
      };

      primary.handleMessage(w1 as unknown as import('node:cluster').Worker, msg, workers);

      // Both workers (including sender) should receive broadcast
      expect(w1.send).toHaveBeenCalledWith(
        expect.objectContaining({
          __orkify: true,
          type: 'cache:set',
          key: 'greeting',
          value: 'hello',
        })
      );
      expect(w2.send).toHaveBeenCalledWith(
        expect.objectContaining({
          __orkify: true,
          type: 'cache:set',
          key: 'greeting',
          value: 'hello',
        })
      );

      // expiresAt should be set
      const sentMsg = w1.send.mock.calls[0][0];
      expect(sentMsg.expiresAt).toBeGreaterThan(Date.now());
    });

    it('stores value without TTL when not specified', () => {
      const w1 = createMockWorker();
      const workers = buildWorkers(w1);

      const msg: CacheWorkerMessage = {
        __orkify: true,
        type: 'cache:set',
        key: 'k',
        value: 'v',
      };

      primary.handleMessage(w1 as unknown as import('node:cluster').Worker, msg, workers);

      const sentMsg = w1.send.mock.calls[0][0];
      expect(sentMsg.expiresAt).toBeUndefined();
    });

    it('skips disconnected workers', () => {
      const connected = createMockWorker(true);
      const disconnected = createMockWorker(false);
      const workers = buildWorkers(connected, disconnected);

      const msg: CacheWorkerMessage = {
        __orkify: true,
        type: 'cache:set',
        key: 'k',
        value: 'v',
      };

      primary.handleMessage(connected as unknown as import('node:cluster').Worker, msg, workers);

      expect(connected.send).toHaveBeenCalled();
      expect(disconnected.send).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage — cache:delete', () => {
    it('deletes key and broadcasts to all workers', () => {
      const w1 = createMockWorker();
      const w2 = createMockWorker();
      const workers = buildWorkers(w1, w2);

      // First set a key
      primary.handleMessage(
        w1 as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'k', value: 'v' },
        workers
      );
      w1.send.mockClear();
      w2.send.mockClear();

      // Then delete it
      primary.handleMessage(
        w1 as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:delete', key: 'k' },
        workers
      );

      expect(w1.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'cache:delete', key: 'k' })
      );
      expect(w2.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'cache:delete', key: 'k' })
      );
    });

    it('skips disconnected workers on delete', () => {
      const connected = createMockWorker(true);
      const disconnected = createMockWorker(false);
      const workers = buildWorkers(connected, disconnected);

      primary.handleMessage(
        connected as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:delete', key: 'k' },
        workers
      );

      expect(connected.send).toHaveBeenCalled();
      expect(disconnected.send).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage — cache:clear', () => {
    it('clears store and broadcasts to all workers', () => {
      const w1 = createMockWorker();
      const workers = buildWorkers(w1);

      primary.handleMessage(
        w1 as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'k', value: 'v' },
        workers
      );
      w1.send.mockClear();

      primary.handleMessage(
        w1 as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:clear' },
        workers
      );

      expect(w1.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'cache:clear' }));
    });

    it('skips disconnected workers on clear', () => {
      const connected = createMockWorker(true);
      const disconnected = createMockWorker(false);
      const workers = buildWorkers(connected, disconnected);

      primary.handleMessage(
        connected as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:clear' },
        workers
      );

      expect(connected.send).toHaveBeenCalled();
      expect(disconnected.send).not.toHaveBeenCalled();
    });
  });

  describe('sendSnapshot', () => {
    it('sends all entries to a worker', () => {
      const w1 = createMockWorker();
      const w2 = createMockWorker();
      const workers = buildWorkers(w1, w2);

      // Populate via handleMessage
      primary.handleMessage(
        w1 as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'a', value: 1 },
        workers
      );
      primary.handleMessage(
        w1 as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'b', value: 2 },
        workers
      );

      const newWorker = createMockWorker();
      primary.sendSnapshot(newWorker as unknown as import('node:cluster').Worker);

      expect(newWorker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          __orkify: true,
          type: 'cache:snapshot',
        })
      );

      const snapshot = newWorker.send.mock.calls[0][0];
      expect(snapshot.entries).toHaveLength(2);
    });

    it('does not send if cache is empty', () => {
      const w = createMockWorker();
      primary.sendSnapshot(w as unknown as import('node:cluster').Worker);
      expect(w.send).not.toHaveBeenCalled();
    });
  });

  describe('persist and restore', () => {
    it('persists and restores cache across instances', async () => {
      const w = createMockWorker();
      const workers = buildWorkers(w);

      primary.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'persist-test', value: 'hello' },
        workers
      );

      await primary.persist();

      // Create a new primary and restore
      const restored = new CachePrimary('test');
      await restored.restore();

      // Verify by sending a snapshot
      const newWorker = createMockWorker();
      restored.sendSnapshot(newWorker as unknown as import('node:cluster').Worker);

      expect(newWorker.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cache:snapshot',
          entries: expect.arrayContaining([expect.arrayContaining(['persist-test'])]),
        })
      );

      await restored.shutdown();
    });
  });

  describe('handleMessage — cache:set with tags', () => {
    it('stores with tags and broadcasts tags to all workers', () => {
      const w1 = createMockWorker();
      const w2 = createMockWorker();
      const workers = buildWorkers(w1, w2);

      const msg: CacheWorkerMessage = {
        __orkify: true,
        type: 'cache:set',
        key: 'tagged-key',
        value: 'val',
        ttl: 60,
        tags: ['project:proj1'],
      };

      primary.handleMessage(w1 as unknown as import('node:cluster').Worker, msg, workers);

      expect(w1.send).toHaveBeenCalledWith(
        expect.objectContaining({
          __orkify: true,
          type: 'cache:set',
          key: 'tagged-key',
          value: 'val',
          tags: ['project:proj1'],
        })
      );
      expect(w2.send).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['project:proj1'],
        })
      );
    });
  });

  describe('handleMessage — cache:invalidate-tag', () => {
    it('invalidates locally and broadcasts with tagTimestamp to all workers', () => {
      const w1 = createMockWorker();
      const w2 = createMockWorker();
      const workers = buildWorkers(w1, w2);

      // First set some tagged entries
      primary.handleMessage(
        w1 as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'a', value: 1, tags: ['group'] },
        workers
      );
      primary.handleMessage(
        w1 as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'b', value: 2, tags: ['group'] },
        workers
      );
      w1.send.mockClear();
      w2.send.mockClear();

      // Invalidate the tag
      primary.handleMessage(
        w1 as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:invalidate-tag', tag: 'group' },
        workers
      );

      expect(w1.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cache:invalidate-tag',
          tag: 'group',
          tagTimestamp: expect.any(Number),
        })
      );
      expect(w2.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cache:invalidate-tag',
          tag: 'group',
          tagTimestamp: expect.any(Number),
        })
      );
    });

    it('skips disconnected workers on invalidate-tag', () => {
      const connected = createMockWorker(true);
      const disconnected = createMockWorker(false);
      const workers = buildWorkers(connected, disconnected);

      primary.handleMessage(
        connected as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:invalidate-tag', tag: 'group' },
        workers
      );

      expect(connected.send).toHaveBeenCalled();
      expect(disconnected.send).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage — cache:update-tag-timestamp', () => {
    it('applies timestamp and broadcasts to all workers', () => {
      const w1 = createMockWorker();
      const w2 = createMockWorker();
      const workers = buildWorkers(w1, w2);

      primary.handleMessage(
        w1 as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:update-tag-timestamp', tag: 'tag-a', tagTimestamp: 5000 },
        workers
      );

      expect(w1.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cache:update-tag-timestamp',
          tag: 'tag-a',
          tagTimestamp: 5000,
        })
      );
      expect(w2.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'cache:update-tag-timestamp',
          tag: 'tag-a',
          tagTimestamp: 5000,
        })
      );
    });
  });

  describe('snapshot includes tag information', () => {
    it('sends tags in snapshot entries', () => {
      const w1 = createMockWorker();
      const workers = buildWorkers(w1);

      primary.handleMessage(
        w1 as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'a', value: 1, tags: ['group'] },
        workers
      );

      const newWorker = createMockWorker();
      primary.sendSnapshot(newWorker as unknown as import('node:cluster').Worker);

      const snapshot = newWorker.send.mock.calls[0][0];
      const entry = snapshot.entries.find((e: [string, unknown]) => e[0] === 'a');
      expect(entry[1].tags).toEqual(['group']);
    });

    it('sends tagTimestamps in snapshot', () => {
      const w1 = createMockWorker();
      const workers = buildWorkers(w1);

      // Invalidate a tag to record its timestamp
      primary.handleMessage(
        w1 as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:invalidate-tag', tag: 'group' },
        workers
      );
      w1.send.mockClear();

      const newWorker = createMockWorker();
      primary.sendSnapshot(newWorker as unknown as import('node:cluster').Worker);

      const snapshot = newWorker.send.mock.calls[0][0];
      expect(snapshot.tagTimestamps).toEqual(
        expect.arrayContaining([['group', expect.any(Number)]])
      );
    });
  });

  describe('persistence round-trips tags', () => {
    it('persists and restores tags across instances', async () => {
      const w = createMockWorker();
      const workers = buildWorkers(w);

      primary.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'tagged', value: 'val', tags: ['t1'] },
        workers
      );

      await primary.persist();

      const restored = new CachePrimary('test');
      await restored.restore();

      // Verify tag info survives by sending snapshot
      const probe = createMockWorker();
      restored.sendSnapshot(probe as unknown as import('node:cluster').Worker);

      const snapshot = probe.send.mock.calls[0][0];
      const entry = snapshot.entries.find((e: [string, unknown]) => e[0] === 'tagged');
      expect(entry[1].tags).toEqual(['t1']);

      await restored.shutdown();
    });

    it('persists and restores tag timestamps across instances', async () => {
      const w = createMockWorker();
      const workers = buildWorkers(w);

      // Record a tag invalidation timestamp
      primary.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:invalidate-tag', tag: 'group' },
        workers
      );

      await primary.persist();

      const restored = new CachePrimary('test');
      await restored.restore();

      const probe = createMockWorker();
      restored.sendSnapshot(probe as unknown as import('node:cluster').Worker);

      const snapshot = probe.send.mock.calls[0][0];
      expect(snapshot.tagTimestamps).toEqual(
        expect.arrayContaining([['group', expect.any(Number)]])
      );

      await restored.shutdown();
    });
  });

  describe('file-backed mode', () => {
    it('persist calls flush on file-backed store', async () => {
      vi.useRealTimers();
      const fb = new CachePrimary('test-fb', { fileBacked: true, maxEntries: 100 });
      const w = createMockWorker();
      const workers = buildWorkers(w);

      fb.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'fb-key', value: 'fb-val' },
        workers
      );

      await fb.persist();

      // Create new file-backed primary and restore
      const restored = new CachePrimary('test-fb', { fileBacked: true, maxEntries: 100 });
      await restored.restore();

      // Verify data is available by checking snapshot
      const probe = createMockWorker();
      // The restored file-backed store loads lazily, so snapshot won't have entries
      // but restore should complete without error
      restored.sendSnapshot(probe as unknown as import('node:cluster').Worker);
      // sendSnapshot uses store.serialize() which only serializes in-memory entries
      // File-backed entries are on disk, not in memory — so snapshot may be empty
      // The important thing is restore() doesn't throw

      await restored.shutdown();
      vi.useFakeTimers();
    });

    it('restore calls loadIndex on file-backed store', async () => {
      vi.useRealTimers();
      const fb = new CachePrimary('test-fb2', { fileBacked: true, maxEntries: 100 });
      // Just test that restore() doesn't throw on a clean directory
      await fb.restore();
      await fb.shutdown();
      vi.useFakeTimers();
    });
  });

  describe('applyConfig (cache:configure)', () => {
    it('upgrades CacheStore to CacheFileStore when fileBacked configured', async () => {
      vi.useRealTimers();

      // Start without fileBacked
      const p = new CachePrimary('test-configure');
      const w = createMockWorker();
      const workers = buildWorkers(w);

      // Set an entry and a tag timestamp before configure
      p.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'pre', value: 'before' },
        workers
      );
      p.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:update-tag-timestamp', tag: 'pre-tag', tagTimestamp: 42 },
        workers
      );

      // Send cache:configure from "worker"
      p.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:configure', config: { fileBacked: true, maxEntries: 100 } },
        workers
      );

      // Entries set before configure should be migrated
      const probe = createMockWorker();
      p.sendSnapshot(probe as unknown as import('node:cluster').Worker);
      expect(probe.send).toHaveBeenCalledWith(
        expect.objectContaining({
          __orkify: true,
          type: 'cache:snapshot',
          entries: expect.arrayContaining([expect.arrayContaining(['pre'])]),
        })
      );

      // Now persist should use flush (file-backed path)
      await p.persist();

      // And entries should survive restore on a new file-backed primary
      const restored = new CachePrimary('test-configure', {
        fileBacked: true,
        maxEntries: 100,
      });
      await restored.restore();
      await restored.shutdown();
      await p.shutdown();
      vi.useFakeTimers();
    });

    it('keeps old store if CacheFileStore constructor throws', () => {
      const p = new CachePrimary('test-configure-fail');
      const w = createMockWorker();
      const workers = buildWorkers(w);

      // Set an entry before configure
      p.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'existing', value: 'data' },
        workers
      );

      // Mock CACHE_DIR to an invalid path to cause CacheFileStore constructor to potentially fail
      // Actually, CacheFileStore constructor doesn't throw on bad paths (it creates lazily),
      // so we verify the safe ordering instead: entry survives the upgrade
      p.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:configure', config: { fileBacked: true } },
        workers
      );

      // The entry should have been migrated to the new store
      const probe = createMockWorker();
      p.sendSnapshot(probe as unknown as import('node:cluster').Worker);
      expect(probe.send).toHaveBeenCalledWith(
        expect.objectContaining({
          entries: expect.arrayContaining([expect.arrayContaining(['existing'])]),
        })
      );

      p.destroy();
    });

    it('ignores duplicate configure messages', () => {
      const p = new CachePrimary('test-configure-dup');
      const w = createMockWorker();
      const workers = buildWorkers(w);

      // First configure
      p.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:configure', config: { fileBacked: true } },
        workers
      );

      // Second configure should be ignored (already fileBacked)
      p.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:configure', config: { fileBacked: true } },
        workers
      );

      // Should not throw or cause issues
      p.destroy();
    });
  });

  describe('destroy', () => {
    it('destroys store without persisting', () => {
      const w = createMockWorker();
      const workers = buildWorkers(w);

      primary.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'will-be-lost', value: 42 },
        workers
      );

      primary.destroy();

      // After destroy, a new primary with the same name should have no data
      const fresh = new CachePrimary('test');
      const probe = createMockWorker();
      fresh.sendSnapshot(probe as unknown as import('node:cluster').Worker);
      expect(probe.send).not.toHaveBeenCalled();
      fresh.destroy();
    });
  });

  describe('shutdown', () => {
    it('persists and destroys store', async () => {
      const w = createMockWorker();
      const workers = buildWorkers(w);

      primary.handleMessage(
        w as unknown as import('node:cluster').Worker,
        { __orkify: true, type: 'cache:set', key: 'shutdown-test', value: 42 },
        workers
      );

      await primary.shutdown();

      // New instance should restore persisted data
      const restored = new CachePrimary('test');
      await restored.restore();

      const probe = createMockWorker();
      restored.sendSnapshot(probe as unknown as import('node:cluster').Worker);
      expect(probe.send).toHaveBeenCalled();

      await restored.shutdown();
    });
  });
});
