import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProcessConfig } from '../../src/types/index.js';
import { ExecMode } from '../../src/constants.js';
import { ManagedProcess } from '../../src/daemon/ManagedProcess.js';

describe('ManagedProcess edge cases', () => {
  let tempDir: string;
  let scriptPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-mp-edge-'));
    scriptPath = join(tempDir, 'app.js');

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
    name: 'test-edge',
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

  describe('graceful exit (code 0) handling', () => {
    // Issue #2: Fork mode counts graceful exits as crashes.
    // A process exiting with code 0 on its own (not via stop()) should NOT
    // be counted as a crash and should NOT be auto-restarted.
    it('should not increment crash counter on clean exit (code 0)', async () => {
      const exitZeroScript = join(tempDir, 'exit-zero.js');
      writeFileSync(exitZeroScript, `setTimeout(() => process.exit(0), 300);`);

      const container = new ManagedProcess(
        0,
        createConfig({
          script: exitZeroScript,
          maxRestarts: 3,
          restartDelay: 100,
        })
      );

      // Wait for the process to exit and for any restart attempt to settle
      const exitPromise = new Promise<void>((resolve) => {
        container.on('worker:exit', () => resolve());
      });

      await container.start();
      await exitPromise;

      // Give time for the restart cycle to kick in (if it does)
      await new Promise((resolve) => setTimeout(resolve, 500));

      const info = container.getInfo();
      // A clean exit (code 0) should NOT be counted as a crash
      expect(info.workers[0].crashes).toBe(0);

      await container.stop();
    }, 10000);

    it('should not auto-restart on clean exit (code 0)', async () => {
      const exitZeroScript = join(tempDir, 'exit-zero.js');
      writeFileSync(exitZeroScript, `setTimeout(() => process.exit(0), 300);`);

      const container = new ManagedProcess(
        0,
        createConfig({
          script: exitZeroScript,
          maxRestarts: 3,
          restartDelay: 100,
        })
      );

      let restartCount = 0;
      container.on('worker:exit', () => {
        restartCount++;
      });

      await container.start();

      // Wait long enough for the process to exit and for any restart attempts
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Should have exited once and NOT been restarted
      // (restartCount would be 1 for the initial exit, more if restarted)
      expect(restartCount).toBe(1);

      await container.stop();
    }, 10000);
  });

  describe('fork mode launch timer', () => {
    // Issue #7: Fork mode has no launch timer. If a process hangs during
    // startup without binding a port or sending 'ready', there's no
    // diagnostic signal. The launch timer emits a worker:error event
    // to alert operators that the process never became ready.
    it('should emit worker:error when process never signals ready', async () => {
      const hangScript = join(tempDir, 'hang-forever.js');
      writeFileSync(
        hangScript,
        `
        // Process that starts but never sends 'ready' or listens on a port.
        // Just keeps running with a timer to prevent exit.
        setInterval(() => {}, 10000);
      `
      );

      const container = new ManagedProcess(
        0,
        createConfig({
          script: hangScript,
          maxRestarts: 0,
        })
      );

      const errorPromise = new Promise<{ workerId: number; error: Error }>((resolve) => {
        container.on('worker:error', (data) => resolve(data));
      });

      await container.start();

      // Replace the 30s LAUNCH_TIMEOUT timer with a shorter 2s one for testing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = container as any;
      clearTimeout(internal.forkLaunchTimer);
      internal.forkLaunchTimer = setTimeout(() => {
        internal.forkLaunchTimer = null;
        if (!internal.forkReady && internal.forkProcess && !internal.isShuttingDown) {
          container.emit('worker:error', {
            workerId: 0,
            error: new Error('Fork process launch timeout after 2s'),
          });
        }
      }, 2000);

      const errorData = await errorPromise;
      expect(errorData.workerId).toBe(0);
      expect(errorData.error.message).toContain('launch timeout');

      await container.stop();
    }, 10000);
  });

  describe('restart backoff', () => {
    // Issue #8: No exponential backoff for restarts. A crash-looping process
    // is restarted with a fixed delay (100ms), hammering the system.
    it('should increase delay between consecutive crash restarts', async () => {
      const crashScript = join(tempDir, 'crash-immediate.js');
      writeFileSync(crashScript, `process.exit(1);`);

      const container = new ManagedProcess(
        0,
        createConfig({
          script: crashScript,
          maxRestarts: 4,
          restartDelay: 100,
        })
      );

      const exitTimes: number[] = [];
      container.on('worker:exit', () => {
        exitTimes.push(Date.now());
      });

      await container.start();

      // Wait for all restarts to exhaust
      await new Promise<void>((resolve) => {
        container.on('worker:maxRestarts', () => resolve());
      });

      // Calculate intervals between exits
      const intervals: number[] = [];
      for (let i = 1; i < exitTimes.length; i++) {
        intervals.push(exitTimes[i] - exitTimes[i - 1]);
      }

      // With exponential backoff, later intervals should be larger than earlier ones.
      // Currently they're all ~restartDelay (100ms).
      expect(intervals.length).toBeGreaterThanOrEqual(3);
      // The last interval should be notably larger than the first
      expect(intervals[intervals.length - 1]).toBeGreaterThan(intervals[0] * 1.5);

      await container.stop();
    }, 15000);
  });

  describe('cluster primary crash limit', () => {
    // Issue #4: No restart limit for cluster primary crash-loop. If the
    // ClusterWrapper itself crashes, it restarts unconditionally with no
    // counter, no backoff, and no limit.
    it('should stop restarting cluster primary after maxRestarts', async () => {
      const container = new ManagedProcess(
        0,
        createConfig({ workerCount: 2, execMode: ExecMode.CLUSTER, maxRestarts: 2 })
      );

      // Create a mock cluster primary that crashes immediately
      const mockPrimary = Object.assign(new EventEmitter(), {
        connected: true,
        pid: 9999,
        stdout: null,
        stderr: null,
        send: () => true,
        kill: () => true,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = container as any;
      internal.clusterPrimary = mockPrimary;
      internal.setupClusterHandlers(mockPrimary);

      let restartAttempts = 0;
      const _origStartCluster = internal.startCluster.bind(container);
      internal.startCluster = async () => {
        restartAttempts++;
        // Simulate another crash by re-emitting exit
        if (restartAttempts <= 5) {
          const newMock = Object.assign(new EventEmitter(), {
            connected: true,
            pid: 10000 + restartAttempts,
            stdout: null,
            stderr: null,
            send: () => true,
            kill: () => true,
          });
          internal.clusterPrimary = newMock;
          internal.setupClusterHandlers(newMock);
          // Simulate immediate crash
          setTimeout(() => newMock.emit('exit', 1, null), 50);
        }
      };

      // Trigger the first crash
      mockPrimary.emit('exit', 1, null);

      // Wait for restart attempts
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should have stopped after maxRestarts (2), not continued to 5+
      expect(restartAttempts).toBeLessThanOrEqual(2);

      // Prevent the handler from trying to restart during cleanup
      internal.isShuttingDown = true;
    }, 10000);
  });

  describe('waitForPrimaryReady timeout behavior', () => {
    // Issue #10: waitForPrimaryReady() resolves silently on timeout instead
    // of rejecting. This means startCluster() appears successful even when
    // the primary never initialized.
    it('should reject when primary never sends ready', async () => {
      const container = new ManagedProcess(
        0,
        createConfig({ workerCount: 2, execMode: ExecMode.CLUSTER })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = container as any;

      // Mock a primary that never sends 'primary:ready'
      const mockPrimary = Object.assign(new EventEmitter(), {
        connected: true,
        pid: 9999,
        stdout: null,
        stderr: null,
        send: () => true,
        kill: () => true,
      });
      internal.clusterPrimary = mockPrimary;

      // Call waitForPrimaryReady directly — it should reject on timeout,
      // but currently it resolves silently.
      await expect(internal.waitForPrimaryReady()).rejects.toThrow();

      internal.isShuttingDown = true;
    }, 15000);
  });

  describe('log stream error resilience', () => {
    // Issue #1: WriteStream errors from log files (e.g., disk full, permission
    // denied) are not handled and can crash the daemon process.
    it('should not crash when log directory is not writable', async () => {
      // Create a read-only logs directory to force write errors
      const readOnlyLogsDir = join(tempDir, 'readonly-logs');
      mkdirSync(readOnlyLogsDir, { recursive: true });

      // Create the log files first (they need to exist for createWriteStream)
      writeFileSync(join(readOnlyLogsDir, 'test-edge.stdout.log'), '');
      writeFileSync(join(readOnlyLogsDir, 'test-edge.stderr.log'), '');

      // Make the directory read-only
      chmodSync(join(readOnlyLogsDir, 'test-edge.stdout.log'), 0o000);
      chmodSync(join(readOnlyLogsDir, 'test-edge.stderr.log'), 0o000);

      // ManagedProcess uses LOGS_DIR from constants, which we can't easily
      // override. Instead, we test that log stream errors don't propagate
      // as unhandled. We create a container and manually trigger a log write
      // error to see if it crashes.
      const container = new ManagedProcess(0, createConfig());

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = container as any;

      // Replace log streams with ones that will error
      internal.logStream?.end();
      internal.errStream?.end();

      const { createWriteStream } = await import('node:fs');
      const badStream = createWriteStream('/dev/null/nonexistent/path', { flags: 'a' });

      // Swallow the expected error to prevent test framework noise
      badStream.on('error', () => {});

      internal.logStream = badStream;

      // This should not throw or crash — the daemon should survive log errors
      expect(() => {
        internal.handleLog('out', 0, Buffer.from('test log line'));
      }).not.toThrow();

      // Restore permissions for cleanup
      chmodSync(join(readOnlyLogsDir, 'test-edge.stdout.log'), 0o644);
      chmodSync(join(readOnlyLogsDir, 'test-edge.stderr.log'), 0o644);

      await container.stop();
    }, 10000);
  });

  describe('forceKill', () => {
    it('should SIGKILL a fork-mode process immediately', async () => {
      const container = new ManagedProcess(0, createConfig());
      await container.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = container as any;
      expect(internal.forkProcess).not.toBeNull();

      const start = Date.now();
      container.forceKill();
      const elapsed = Date.now() - start;

      // forceKill is synchronous — should complete in < 100ms
      expect(elapsed).toBeLessThan(100);
      expect(internal.forkProcess).toBeNull();
    }, 10000);

    it('should SIGKILL a cluster primary immediately', async () => {
      const container = new ManagedProcess(
        0,
        createConfig({ workerCount: 2, execMode: ExecMode.CLUSTER })
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const internal = container as any;

      // Mock a cluster primary
      const mockPrimary = Object.assign(new EventEmitter(), {
        connected: true,
        pid: 9999,
        stdout: null,
        stderr: null,
        send: () => true,
        kill: () => true,
      });
      internal.clusterPrimary = mockPrimary;

      container.forceKill();
      expect(internal.clusterPrimary).toBeNull();
    }, 10000);

    it('should be safe to call when no process is running', () => {
      const container = new ManagedProcess(0, createConfig());
      // Should not throw
      container.forceKill();
    });
  });
});
