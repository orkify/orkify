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
