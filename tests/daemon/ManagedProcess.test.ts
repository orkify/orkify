import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProcessConfig } from '../../src/types/index.js';
import { ExecMode, ProcessStatus } from '../../src/constants.js';
import { ManagedProcess } from '../../src/daemon/ManagedProcess.js';

describe('ManagedProcess', () => {
  let tempDir: string;
  let scriptPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-test-'));
    scriptPath = join(tempDir, 'app.js');

    // Create a simple test script that stays running
    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.end('ok');
      });
      server.listen(0, () => {
        if (process.send) process.send('ready');
      });
      process.on('SIGTERM', () => {
        server.close(() => process.exit(0));
      });
    `
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const createConfig = (overrides?: Partial<ProcessConfig>): ProcessConfig => ({
    name: 'test-process',
    script: scriptPath,
    cwd: tempDir,
    workerCount: 1,
    execMode: ExecMode.FORK,
    watch: false,
    env: {},
    nodeArgs: [],
    args: [],
    killTimeout: 5000,
    maxRestarts: 3,
    minUptime: 1000,
    restartDelay: 100,
    sticky: false,
    logMaxSize: 100 * 1024 * 1024,
    logMaxFiles: 90,
    logMaxAge: 90 * 24 * 60 * 60 * 1000,
    ...overrides,
  });

  describe('getInfo status', () => {
    it('returns stopped status after process is stopped', async () => {
      const container = new ManagedProcess(0, createConfig());

      await container.start();

      // Wait for process to be running
      await new Promise((resolve) => setTimeout(resolve, 500));

      const runningInfo = container.getInfo();
      expect(runningInfo.status).toBe(ProcessStatus.ONLINE);

      await container.stop();

      const stoppedInfo = container.getInfo();
      expect(stoppedInfo.status).toBe(ProcessStatus.STOPPED);
    });

    it('does not get stuck in stopping status', async () => {
      const container = new ManagedProcess(0, createConfig());

      await container.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      await container.stop();

      // Check multiple times to ensure it stays stopped
      for (let i = 0; i < 3; i++) {
        const info = container.getInfo();
        expect(info.status).toBe(ProcessStatus.STOPPED);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    });
  });

  describe('start and stop', () => {
    it('starts a fork mode process', async () => {
      const container = new ManagedProcess(0, createConfig());

      await container.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(container.isRunning()).toBe(true);
      expect(container.getWorkerCount()).toBe(1);

      await container.stop();
    });

    it('stops a running process', async () => {
      const container = new ManagedProcess(0, createConfig());

      await container.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      await container.stop();

      expect(container.isRunning()).toBe(false);
      expect(container.getWorkerCount()).toBe(0);
    });
  });

  describe('fork mode crash and restart counters', () => {
    it('increments crashes and restarts on crash', async () => {
      const crashScript = join(tempDir, 'crash.js');
      writeFileSync(crashScript, `setTimeout(() => process.exit(1), 200);`);

      const container = new ManagedProcess(
        0,
        createConfig({
          script: crashScript,
          maxRestarts: 3,
          minUptime: 100,
          restartDelay: 100,
        })
      );

      await container.start();

      // Wait enough time for crash + restart cycle(s)
      await new Promise((resolve) => setTimeout(resolve, 800));

      const info = container.getInfo();
      expect(info.workers[0].crashes).toBeGreaterThanOrEqual(1);
      expect(info.workers[0].restarts).toBeGreaterThanOrEqual(1);

      await container.stop();
    }, 10000);

    it('does NOT increment crashes on graceful stop', async () => {
      const container = new ManagedProcess(0, createConfig());

      await container.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      await container.stop();

      const info = container.getInfo();
      expect(info.workers[0].crashes).toBe(0);
      expect(info.workers[0].restarts).toBe(0);
    });

    it('restart() resets counters to 0', async () => {
      const crashScript = join(tempDir, 'crash-then-ok.js');
      writeFileSync(crashScript, `setTimeout(() => process.exit(1), 200);`);

      const container = new ManagedProcess(
        0,
        createConfig({
          script: crashScript,
          maxRestarts: 3,
          minUptime: 100,
          restartDelay: 100,
        })
      );

      await container.start();

      // Let it crash and accumulate crashes/restarts
      await new Promise((resolve) => setTimeout(resolve, 800));

      const infoBefore = container.getInfo();
      expect(infoBefore.workers[0].crashes).toBeGreaterThanOrEqual(1);

      // Now restart with the healthy script (resets counters)
      container.config.script = scriptPath;
      await container.restart();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const infoAfter = container.getInfo();
      expect(infoAfter.workers[0].crashes).toBe(0);
      expect(infoAfter.workers[0].restarts).toBe(0);

      await container.stop();
    }, 10000);

    it('emits worker:maxRestarts when limit exceeded', async () => {
      const crashScript = join(tempDir, 'crash-fast.js');
      writeFileSync(crashScript, `setTimeout(() => process.exit(1), 200);`);

      const container = new ManagedProcess(
        0,
        createConfig({
          script: crashScript,
          maxRestarts: 2,
          minUptime: 100,
          restartDelay: 100,
        })
      );

      const maxRestartsPromise = new Promise<number>((resolve) => {
        container.on('worker:maxRestarts', (workerId: number) => {
          resolve(workerId);
        });
      });

      await container.start();

      // Wait for max restarts to be exceeded
      // initial + 2 restarts, each ~200ms run + 100ms delay = ~900ms
      const workerId = await maxRestartsPromise;
      expect(workerId).toBe(0);

      const info = container.getInfo();
      expect(info.status).toBe(ProcessStatus.STOPPED);
      // crashes = initial crash + 2 restart crashes = 3
      expect(info.workers[0].crashes).toBeGreaterThanOrEqual(3);

      await container.stop();
    }, 10000);
  });

  describe('cluster mode reload crash suppression', () => {
    it('does not count worker exits as crashes during reload', () => {
      const container = new ManagedProcess(
        0,
        createConfig({ workerCount: 2, execMode: ExecMode.CLUSTER })
      );

      // Create a mock cluster primary to attach IPC handlers to.
      // We don't need a real ClusterWrapper — just an EventEmitter that
      // the message handler can listen on.
      const mockPrimary = Object.assign(new EventEmitter(), {
        connected: true,
        pid: 9999,
        stdout: null,
        stderr: null,
        send: () => true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = container as any;
      internal.clusterPrimary = mockPrimary;
      internal.setupClusterHandlers(mockPrimary);

      // Simulate two workers coming online
      mockPrimary.emit('message', { type: 'worker:online', workerId: 0, pid: 1234 });
      mockPrimary.emit('message', { type: 'worker:online', workerId: 1, pid: 5678 });

      // Without isReloading: worker exit should count as a crash
      mockPrimary.emit('message', {
        type: 'worker:exit',
        workerId: 1,
        pid: 5678,
        code: 1,
        signal: null,
      });
      expect(internal.slotCrashes.get(1)).toBe(1);

      // Re-add worker 1
      mockPrimary.emit('message', { type: 'worker:online', workerId: 1, pid: 5679 });

      // With isReloading: worker exit should NOT count as a crash
      internal.isReloading = true;
      mockPrimary.emit('message', {
        type: 'worker:exit',
        workerId: 0,
        pid: 1234,
        code: 0,
        signal: null,
      });
      expect(internal.slotCrashes.get(0) ?? 0).toBe(0);

      // Prevent the primary exit handler from trying to restart
      internal.isShuttingDown = true;
    });

    it('counts worker exits as crashes after reload completes', () => {
      const container = new ManagedProcess(
        0,
        createConfig({ workerCount: 2, execMode: ExecMode.CLUSTER })
      );

      const mockPrimary = Object.assign(new EventEmitter(), {
        connected: true,
        pid: 9999,
        stdout: null,
        stderr: null,
        send: () => true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = container as any;
      internal.clusterPrimary = mockPrimary;
      internal.setupClusterHandlers(mockPrimary);

      // Worker comes online
      mockPrimary.emit('message', { type: 'worker:online', workerId: 0, pid: 1234 });

      // Start reload
      internal.isReloading = true;

      // Worker exit during reload — no crash
      mockPrimary.emit('message', {
        type: 'worker:exit',
        workerId: 0,
        pid: 1234,
        code: 0,
        signal: null,
      });
      expect(internal.slotCrashes.get(0) ?? 0).toBe(0);

      // Reload completes — isReloading cleared
      internal.isReloading = false;

      // New worker comes online after reload
      mockPrimary.emit('message', { type: 'worker:online', workerId: 0, pid: 5678 });

      // Worker exit after reload — should count as crash
      mockPrimary.emit('message', {
        type: 'worker:exit',
        workerId: 0,
        pid: 5678,
        code: 1,
        signal: null,
      });
      expect(internal.slotCrashes.get(0)).toBe(1);

      internal.isShuttingDown = true;
    });
  });

  describe('cluster mode metrics-based status recovery', () => {
    function createClusterContainer() {
      const container = new ManagedProcess(
        0,
        createConfig({ workerCount: 2, execMode: ExecMode.CLUSTER })
      );

      const mockPrimary = Object.assign(new EventEmitter(), {
        connected: true,
        pid: 9999,
        stdout: null,
        stderr: null,
        send: () => true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = container as any;
      internal.clusterPrimary = mockPrimary;
      internal.setupClusterHandlers(mockPrimary);

      return { container, mockPrimary, internal };
    }

    it('recovers ERRORED worker to ONLINE on metrics', () => {
      const { container, mockPrimary, internal } = createClusterContainer();

      // Worker comes online → LAUNCHING
      mockPrimary.emit('message', { type: 'worker:online', workerId: 0, pid: 1234 });

      const workerState = internal.clusterWorkers.get(0);
      expect(workerState.status).toBe(ProcessStatus.LAUNCHING);

      // Simulate launch timeout firing (set ERRORED directly)
      workerState.status = ProcessStatus.ERRORED;
      workerState.ready = false;

      expect(container.getInfo().workers[0].status).toBe(ProcessStatus.ERRORED);

      // Metrics arrive from the probe → should recover to ONLINE
      mockPrimary.emit('message', {
        type: 'worker:metrics',
        workerId: 0,
        data: {
          heapUsed: 1000,
          heapTotal: 2000,
          external: 0,
          arrayBuffers: 0,
          eventLoopLag: 1,
          eventLoopLagP95: 2,
          activeHandles: 3,
        },
      });

      expect(workerState.status).toBe(ProcessStatus.ONLINE);
      expect(workerState.ready).toBe(true);
      expect(container.getInfo().workers[0].status).toBe(ProcessStatus.ONLINE);

      internal.isShuttingDown = true;
    });

    it('does NOT recover LAUNCHING worker on metrics', () => {
      const { mockPrimary, internal } = createClusterContainer();

      // Worker comes online → LAUNCHING
      mockPrimary.emit('message', { type: 'worker:online', workerId: 0, pid: 1234 });

      const workerState = internal.clusterWorkers.get(0);
      expect(workerState.status).toBe(ProcessStatus.LAUNCHING);

      // Metrics arrive while still LAUNCHING — should stay LAUNCHING
      mockPrimary.emit('message', {
        type: 'worker:metrics',
        workerId: 0,
        data: {
          heapUsed: 1000,
          heapTotal: 2000,
          external: 0,
          arrayBuffers: 0,
          eventLoopLag: 1,
          eventLoopLagP95: 2,
          activeHandles: 3,
        },
      });

      expect(workerState.status).toBe(ProcessStatus.LAUNCHING);

      internal.isShuttingDown = true;
    });

    it('does NOT recover STOPPED worker on metrics', () => {
      const { mockPrimary, internal } = createClusterContainer();

      mockPrimary.emit('message', { type: 'worker:online', workerId: 0, pid: 1234 });

      const workerState = internal.clusterWorkers.get(0);
      workerState.status = ProcessStatus.STOPPED;

      mockPrimary.emit('message', {
        type: 'worker:metrics',
        workerId: 0,
        data: {
          heapUsed: 1000,
          heapTotal: 2000,
          external: 0,
          arrayBuffers: 0,
          eventLoopLag: 1,
          eventLoopLagP95: 2,
          activeHandles: 3,
        },
      });

      expect(workerState.status).toBe(ProcessStatus.STOPPED);

      internal.isShuttingDown = true;
    });

    it('worker:listening recovers ERRORED status', () => {
      const { container, mockPrimary, internal } = createClusterContainer();

      mockPrimary.emit('message', { type: 'worker:online', workerId: 0, pid: 1234 });

      const workerState = internal.clusterWorkers.get(0);
      workerState.status = ProcessStatus.ERRORED;
      workerState.ready = false;

      // Late listening signal arrives
      mockPrimary.emit('message', {
        type: 'worker:listening',
        workerId: 0,
        address: { address: '*', port: 3000 },
      });

      expect(workerState.status).toBe(ProcessStatus.ONLINE);
      expect(workerState.ready).toBe(true);
      expect(container.getInfo().status).toBe(ProcessStatus.ONLINE);

      internal.isShuttingDown = true;
    });

    it('process status reflects worst worker status', () => {
      const { container, mockPrimary, internal } = createClusterContainer();

      mockPrimary.emit('message', { type: 'worker:online', workerId: 0, pid: 1234 });
      mockPrimary.emit('message', { type: 'worker:online', workerId: 1, pid: 5678 });

      // Worker 0: ONLINE, Worker 1: ERRORED → process should be ERRORED
      mockPrimary.emit('message', {
        type: 'worker:listening',
        workerId: 0,
        address: { address: '*', port: 3000 },
      });
      const worker1 = internal.clusterWorkers.get(1);
      worker1.status = ProcessStatus.ERRORED;

      expect(container.getInfo().status).toBe(ProcessStatus.ERRORED);

      // Worker 1 recovers via metrics → both ONLINE → process ONLINE
      mockPrimary.emit('message', {
        type: 'worker:metrics',
        workerId: 1,
        data: {
          heapUsed: 1000,
          heapTotal: 2000,
          external: 0,
          arrayBuffers: 0,
          eventLoopLag: 1,
          eventLoopLagP95: 2,
          activeHandles: 3,
        },
      });

      expect(container.getInfo().status).toBe(ProcessStatus.ONLINE);

      internal.isShuttingDown = true;
    });

    it('updates metrics fields on worker state', () => {
      const { mockPrimary, internal } = createClusterContainer();

      mockPrimary.emit('message', { type: 'worker:online', workerId: 0, pid: 1234 });

      mockPrimary.emit('message', {
        type: 'worker:metrics',
        workerId: 0,
        data: {
          heapUsed: 5000,
          heapTotal: 10000,
          external: 200,
          arrayBuffers: 100,
          eventLoopLag: 3.5,
          eventLoopLagP95: 8.2,
          activeHandles: 12,
        },
      });

      const workerState = internal.clusterWorkers.get(0);
      expect(workerState.heapUsed).toBe(5000);
      expect(workerState.heapTotal).toBe(10000);
      expect(workerState.external).toBe(200);
      expect(workerState.arrayBuffers).toBe(100);
      expect(workerState.eventLoopLag).toBe(3.5);
      expect(workerState.eventLoopLagP95).toBe(8.2);
      expect(workerState.activeHandles).toBe(12);

      internal.isShuttingDown = true;
    });
  });
});
