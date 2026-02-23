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

  describe('memory threshold restart', () => {
    it('restarts fork process when memory exceeds threshold', async () => {
      const memScript = join(tempDir, 'mem-grow.js');
      writeFileSync(
        memScript,
        `
        const chunks = [];
        setInterval(() => chunks.push(Buffer.alloc(5 * 1024 * 1024)), 200);
        const http = require('http');
        const server = http.createServer((req, res) => res.end('ok'));
        server.listen(0, () => { if (process.send) process.send('ready'); });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
        `
      );

      const container = new ManagedProcess(
        0,
        createConfig({
          script: memScript,
          restartOnMemory: 50 * 1024 * 1024, // 50 MB
        })
      );

      const memoryRestartPromise = new Promise<{ workerId: number; memory: number; limit: number }>(
        (resolve) => {
          container.on('worker:memoryRestart', (data) => resolve(data));
        }
      );

      await container.start();

      const data = await memoryRestartPromise;
      expect(data.workerId).toBe(0);
      expect(data.memory).toBeGreaterThan(50 * 1024 * 1024);
      expect(data.limit).toBe(50 * 1024 * 1024);

      // Wait for restart to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const info = container.getInfo();
      expect(info.workers[0].restarts).toBeGreaterThanOrEqual(1);
      expect(info.status).toBe(ProcessStatus.ONLINE);

      await container.stop();
    }, 30000);

    it('increments restarts but NOT crashes on memory restart', async () => {
      const memScript = join(tempDir, 'mem-grow-2.js');
      writeFileSync(
        memScript,
        `
        const chunks = [];
        setInterval(() => chunks.push(Buffer.alloc(5 * 1024 * 1024)), 200);
        const http = require('http');
        const server = http.createServer((req, res) => res.end('ok'));
        server.listen(0, () => { if (process.send) process.send('ready'); });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
        `
      );

      const container = new ManagedProcess(
        0,
        createConfig({
          script: memScript,
          restartOnMemory: 50 * 1024 * 1024,
        })
      );

      const memoryRestartPromise = new Promise<void>((resolve) => {
        container.on('worker:memoryRestart', () => resolve());
      });

      await container.start();
      await memoryRestartPromise;

      // Wait for restart to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const info = container.getInfo();
      // Memory restart should increment restarts
      expect(info.workers[0].restarts).toBeGreaterThanOrEqual(1);
      // Memory restart should NOT increment crashes
      expect(info.workers[0].crashes).toBe(0);

      await container.stop();
    }, 30000);

    it('does not restart when under threshold', async () => {
      const container = new ManagedProcess(
        0,
        createConfig({
          restartOnMemory: 1024 * 1024 * 1024, // 1 GB — way above any test process
        })
      );

      let memoryRestartCount = 0;
      container.on('worker:memoryRestart', () => {
        memoryRestartCount++;
      });

      await container.start();
      await new Promise((resolve) => setTimeout(resolve, 3000));

      expect(memoryRestartCount).toBe(0);

      await container.stop();
    }, 10000);

    it('does not restart when restartOnMemory is not set', async () => {
      const container = new ManagedProcess(0, createConfig());

      let memoryRestartCount = 0;
      container.on('worker:memoryRestart', () => {
        memoryRestartCount++;
      });

      await container.start();
      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(memoryRestartCount).toBe(0);

      await container.stop();
    }, 10000);

    it('respects 30s cooldown after memory restart', async () => {
      const container = new ManagedProcess(
        0,
        createConfig({
          restartOnMemory: 50 * 1024 * 1024,
        })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = container as any;

      // Simulate that a memory restart just happened
      internal.lastMemoryRestart = Date.now();

      // Manually set forkStats.memory above threshold
      internal.forkStats.memory = 100 * 1024 * 1024;

      // checkMemoryThreshold should skip due to cooldown
      internal.checkMemoryThreshold();

      // No restart should have been triggered
      expect(internal.forkRestarts).toBe(0);

      await container.stop();
    }, 10000);
  });

  describe('cronSecret', () => {
    it('generates a 64-char hex cronSecret when cron is configured', () => {
      const container = new ManagedProcess(
        0,
        createConfig({
          cron: [{ schedule: '*/5 * * * *', path: '/api/cron/check' }],
        })
      );

      expect(container.cronSecret).toBeDefined();
      expect(container.cronSecret).toHaveLength(64);
      expect(container.cronSecret).toMatch(/^[0-9a-f]{64}$/);
    });

    it('does not generate cronSecret when cron is not configured', () => {
      const container = new ManagedProcess(0, createConfig());
      expect(container.cronSecret).toBeUndefined();
    });

    it('does not generate cronSecret when cron is empty array', () => {
      const container = new ManagedProcess(0, createConfig({ cron: [] }));
      expect(container.cronSecret).toBeUndefined();
    });

    it('getInfo() does not expose cronSecret', () => {
      const container = new ManagedProcess(
        0,
        createConfig({
          cron: [{ schedule: '*/5 * * * *', path: '/api/cron/check' }],
        })
      );

      const info = container.getInfo();
      expect(container.cronSecret).toBeDefined();
      expect('cronSecret' in info).toBe(false);
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
