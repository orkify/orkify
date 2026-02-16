import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TELEMETRY_MAX_BATCH_SIZE,
  TELEMETRY_LOG_RING_SIZE,
  TELEMETRY_LOG_FLUSH_MAX_LINES,
} from '../../src/constants.js';
import type { Orchestrator } from '../../src/daemon/Orchestrator.js';
import { TelemetryReporter } from '../../src/telemetry/TelemetryReporter.js';
import type { ProcessInfo } from '../../src/types/index.js';

function createMockOrchestrator() {
  const emitter = new EventEmitter();
  const mock = emitter as unknown as Orchestrator;
  mock.list = vi.fn<() => ProcessInfo[]>().mockReturnValue([]);
  mock.getDaemonStatus = vi.fn().mockReturnValue({
    pid: 1234,
    uptime: 5000,
    processCount: 0,
    workerCount: 0,
  });
  return mock;
}

describe('TelemetryReporter', () => {
  let orchestrator: Orchestrator;
  let reporter: TelemetryReporter;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    orchestrator = createMockOrchestrator();
    reporter = new TelemetryReporter(
      { apiKey: 'test-key', apiHost: 'https://test.api.com' },
      orchestrator
    );

    fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(async () => {
    await reporter.shutdown();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('event buffering', () => {
    it('buffers process:start events from Orchestrator', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('process:start', {
        processName: 'app',
        processId: 0,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.events).toHaveLength(1);
      expect(body.events[0].type).toBe('process:start');
      expect(body.events[0].processName).toBe('app');
      expect(body.events[0].processId).toBe(0);
    });

    it('buffers process:stop events from Orchestrator', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('process:stop', {
        processName: 'app',
        processId: 0,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.events[0].type).toBe('process:stop');
    });

    it('buffers reload:complete as process:reloaded', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('reload:complete', {
        processName: 'app',
        processId: 0,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.events[0].type).toBe('process:reloaded');
    });

    it('buffers worker:ready events', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('worker:ready', {
        processName: 'app',
        workerId: 1,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.events[0].type).toBe('worker:ready');
      expect(body.events[0].workerId).toBe(1);
    });

    it('buffers worker:exit events with zero exit code', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('worker:exit', {
        processName: 'app',
        workerId: 1,
        code: 0,
        signal: null,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.events[0].type).toBe('worker:exit');
    });

    it('buffers worker:maxRestarts events', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('worker:maxRestarts', {
        processName: 'app',
        workerId: 2,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.events[0].type).toBe('worker:maxRestarts');
      expect(body.events[0].workerId).toBe(2);
    });
  });

  describe('crash events with log ring buffer', () => {
    it('includes last log lines on crash (non-zero exit)', async () => {
      reporter.start();

      // Emit some logs
      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: 0,
        type: 'out',
        data: 'line 1',
      });
      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: 0,
        type: 'out',
        data: 'line 2',
      });
      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: 0,
        type: 'err',
        data: 'Error: crash!',
      });

      // Emit a crash
      (orchestrator as unknown as EventEmitter).emit('worker:exit', {
        processName: 'app',
        workerId: 0,
        code: 1,
        signal: null,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const crashEvent = body.events.find((e: { type: string }) => e.type === 'worker:crash');
      expect(crashEvent).toBeDefined();
      expect(crashEvent.lastLogs).toEqual(['line 1', 'line 2', 'Error: crash!']);
      expect(crashEvent.exitCode).toBe(1);
    });

    it('clears log ring after attaching to crash event', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: 0,
        type: 'out',
        data: 'old log',
      });
      (orchestrator as unknown as EventEmitter).emit('worker:exit', {
        processName: 'app',
        workerId: 0,
        code: 1,
        signal: null,
      });

      // Emit another log after crash
      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: 0,
        type: 'out',
        data: 'new log',
      });
      (orchestrator as unknown as EventEmitter).emit('worker:exit', {
        processName: 'app',
        workerId: 0,
        code: 1,
        signal: null,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const crashes = body.events.filter((e: { type: string }) => e.type === 'worker:crash');
      expect(crashes).toHaveLength(2);
      expect(crashes[0].lastLogs).toEqual(['old log']);
      expect(crashes[1].lastLogs).toEqual(['new log']);
    });

    it('limits log ring to TELEMETRY_LOG_RING_SIZE entries', async () => {
      reporter.start();

      for (let i = 0; i < TELEMETRY_LOG_RING_SIZE + 20; i++) {
        (orchestrator as unknown as EventEmitter).emit('log', {
          processName: 'app',
          workerId: 0,
          type: 'out',
          data: `line ${i}`,
        });
      }

      (orchestrator as unknown as EventEmitter).emit('worker:exit', {
        processName: 'app',
        workerId: 0,
        code: 1,
        signal: null,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const crash = body.events.find((e: { type: string }) => e.type === 'worker:crash');
      expect(crash.lastLogs).toHaveLength(TELEMETRY_LOG_RING_SIZE);
      expect(crash.lastLogs[0]).toBe(`line 20`);
    });
  });

  describe('metrics collection', () => {
    it('collects metrics from orchestrator.list() on interval', async () => {
      vi.mocked(orchestrator.list).mockReturnValue([
        {
          id: 0,
          name: 'app',
          script: '/app.js',
          cwd: '/',
          execMode: 'fork',
          workerCount: 1,
          status: 'online',
          workers: [
            {
              id: 0,
              pid: 5678,
              status: 'online',
              restarts: 0,
              uptime: 3000,
              memory: 50_000_000,
              cpu: 1.5,
              createdAt: Date.now(),
            },
          ],
          createdAt: Date.now(),
          watch: false,
          sticky: false,
        },
      ]);

      reporter.start();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.metrics).toHaveLength(1);
      expect(body.metrics[0].processName).toBe('app');
      expect(body.metrics[0].workers).toHaveLength(1);
      expect(body.metrics[0].workers[0].pid).toBe(5678);
    });
  });

  describe('flush behavior', () => {
    it('POSTs to correct URL with auth header', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('process:start', {
        processName: 'app',
        processId: 0,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://test.api.com/api/v1/ingest/telemetry');
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer test-key');
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('includes daemon metadata in payload', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('process:start', {
        processName: 'app',
        processId: 0,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.daemonPid).toBe(1234);
      expect(body.daemonUptime).toBe(5000);
      expect(body.hostname).toEqual(expect.any(String));
      expect(body.host).toEqual({
        os: expect.any(String),
        arch: expect.any(String),
        nodeVersion: expect.stringMatching(/^v\d+/),
        cpuCount: expect.any(Number),
        totalMemory: expect.any(Number),
      });
      expect(body.sentAt).toEqual(expect.any(Number));
    });

    it('does not POST when there are no events or metrics', async () => {
      reporter.start();

      await vi.advanceTimersByTimeAsync(10_000);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('uses custom apiHost in fetch URL', async () => {
      const customReporter = new TelemetryReporter(
        { apiKey: 'key', apiHost: 'http://localhost:3001' },
        orchestrator
      );
      customReporter.start();

      (orchestrator as unknown as EventEmitter).emit('process:start', {
        processName: 'app',
        processId: 0,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:3001/api/v1/ingest/telemetry');

      await customReporter.shutdown();
    });

    it('force-flushes when buffer reaches MAX_BATCH_SIZE', async () => {
      reporter.start();

      for (let i = 0; i < TELEMETRY_MAX_BATCH_SIZE; i++) {
        (orchestrator as unknown as EventEmitter).emit('process:start', {
          processName: 'app',
          processId: i,
        });
      }

      // Allow microtasks to run (the force-flush is async void)
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.events).toHaveLength(TELEMETRY_MAX_BATCH_SIZE);
    });
  });

  describe('error handling', () => {
    it('does not throw on fetch failure', async () => {
      fetchSpy.mockRejectedValue(new Error('network error'));
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('process:start', {
        processName: 'app',
        processId: 0,
      });

      await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow();
    });

    it('restores events to buffer on fetch failure', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('network error'));
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('process:start', {
        processName: 'app',
        processId: 0,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      // Now make fetch succeed
      fetchSpy.mockResolvedValue({ ok: true });

      await vi.advanceTimersByTimeAsync(10_000);

      // Second call should include the restored event
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const body = JSON.parse(fetchSpy.mock.calls[1][1].body);
      expect(body.events).toHaveLength(1);
      expect(body.events[0].type).toBe('process:start');
    });

    it('restores events on non-ok response', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('process:start', {
        processName: 'app',
        processId: 0,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      fetchSpy.mockResolvedValue({ ok: true });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[1][1].body);
      expect(body.events).toHaveLength(1);
    });

    it('trims restored buffer past MAX_BATCH_SIZE * 2', async () => {
      fetchSpy.mockRejectedValue(new Error('always fails'));
      reporter.start();

      // Fill beyond limit across multiple flushes
      for (let i = 0; i < TELEMETRY_MAX_BATCH_SIZE * 3; i++) {
        (orchestrator as unknown as EventEmitter).emit('process:start', {
          processName: 'app',
          processId: i,
        });
      }

      // Let all pending flushes run
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(10_000);

      // Switch to success to inspect the buffer
      fetchSpy.mockResolvedValue({ ok: true });
      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.lastCall[1].body);
      expect(body.events.length).toBeLessThanOrEqual(TELEMETRY_MAX_BATCH_SIZE * 2);
    });
  });

  describe('log level detection', () => {
    it('stderr logs default to error level', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: 0,
        type: 'err',
        data: 'Something broke',
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const errorLog = body.logs.find((l: { message: string }) => l.message === 'Something broke');
      expect(errorLog.level).toBe('error');
    });

    it('stderr containing standalone "warning" downgrades to warn level', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: 0,
        type: 'err',
        data: 'warning: something is deprecated',
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const warnLog = body.logs.find((l: { message: string }) =>
        l.message.includes('something is deprecated')
      );
      expect(warnLog.level).toBe('warn');
    });

    it('stderr containing both "warning" and "error" stays at error level', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: 0,
        type: 'err',
        data: 'Warning: error occurred in module',
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.logs[0].level).toBe('error');
    });

    it('stdout logs are info level', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: 0,
        type: 'out',
        data: 'Server started on port 3000',
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.logs[0].level).toBe('info');
    });

    it('skips primary process logs (workerId < 0) from flush buffer', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: -1,
        type: 'out',
        data: 'internal primary message',
      });
      // Also emit a real worker log so there is something to flush
      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: 0,
        type: 'out',
        data: 'worker message',
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].message).toBe('worker message');
    });
  });

  describe('deploy status lifecycle', () => {
    it('includes deploy status in payload when set', async () => {
      reporter.start();

      reporter.setDeployStatus({
        deployId: 'deploy-1',
        targetId: 'target-1',
        phase: 'downloading',
        buildLog: '',
      });

      (orchestrator as unknown as EventEmitter).emit('process:start', {
        processName: 'app',
        processId: 0,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.deployStatus).toBeDefined();
      expect(body.deployStatus.deployId).toBe('deploy-1');
      expect(body.deployStatus.phase).toBe('downloading');
    });

    it('clears deploy status after terminal phase is sent', async () => {
      reporter.start();

      reporter.setDeployStatus({
        deployId: 'deploy-1',
        targetId: 'target-1',
        phase: 'success',
        buildLog: '',
      });

      (orchestrator as unknown as EventEmitter).emit('process:start', {
        processName: 'app',
        processId: 0,
      });
      await vi.advanceTimersByTimeAsync(10_000);

      // First flush includes deploy status
      const body1 = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body1.deployStatus.phase).toBe('success');

      // Second flush should not include deploy status (cleared after terminal)
      (orchestrator as unknown as EventEmitter).emit('process:start', {
        processName: 'app',
        processId: 1,
      });
      await vi.advanceTimersByTimeAsync(10_000);

      const body2 = JSON.parse(fetchSpy.mock.calls[1][1].body);
      expect(body2.deployStatus).toBeUndefined();
    });
  });

  describe('emitEvent and pushEvent', () => {
    it('emitEvent adds an event to the buffer', async () => {
      reporter.start();

      reporter.emitEvent('process:deploy-started', 'deploy', {
        details: { deployId: 'd1', targetId: 't1' },
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.events).toHaveLength(1);
      expect(body.events[0].type).toBe('process:deploy-started');
      expect(body.events[0].details.deployId).toBe('d1');
    });
  });

  describe('worker:error:captured events', () => {
    it('buffers captured error events with last logs', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: 0,
        type: 'out',
        data: 'before crash',
      });

      (orchestrator as unknown as EventEmitter).emit('worker:error:captured', {
        processName: 'app',
        workerId: 0,
        error: {
          errorType: 'uncaughtException',
          name: 'TypeError',
          message: 'Cannot read property x',
          stack: 'at foo.js:1:1',
          fingerprint: 'abc123',
          timestamp: 1234567890,
          nodeVersion: 'v22.0.0',
          pid: 9999,
        },
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].name).toBe('TypeError');
      expect(body.errors[0].message).toBe('Cannot read property x');
      expect(body.errors[0].lastLogs).toEqual(['before crash']);
    });

    it('force-flushes when error buffer reaches MAX_BATCH_SIZE', async () => {
      reporter.start();

      for (let i = 0; i < TELEMETRY_MAX_BATCH_SIZE; i++) {
        (orchestrator as unknown as EventEmitter).emit('worker:error:captured', {
          processName: 'app',
          workerId: 0,
          error: {
            errorType: 'uncaughtException',
            name: 'Error',
            message: `error ${i}`,
            stack: '',
          },
        });
      }

      await vi.advanceTimersByTimeAsync(0);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.errors).toHaveLength(TELEMETRY_MAX_BATCH_SIZE);
    });
  });

  describe('log flush buffer management', () => {
    it('truncates per-worker logs beyond TELEMETRY_LOG_FLUSH_MAX_LINES', async () => {
      reporter.start();

      const lineCount = TELEMETRY_LOG_FLUSH_MAX_LINES + 10;
      for (let i = 0; i < lineCount; i++) {
        (orchestrator as unknown as EventEmitter).emit('log', {
          processName: 'app',
          workerId: 0,
          type: 'out',
          data: `line ${i}`,
        });
      }

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      // Should have TELEMETRY_LOG_FLUSH_MAX_LINES + 1 truncation marker
      expect(body.logs.length).toBe(TELEMETRY_LOG_FLUSH_MAX_LINES + 1);
      expect(body.logs[0].message).toMatch(/truncated/);
    });
  });

  describe('commands:pending event', () => {
    it('emits commands:pending when response has has_commands', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ has_commands: true }),
      });

      const pendingSpy = vi.fn();
      reporter.on('commands:pending', pendingSpy);
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('process:start', {
        processName: 'app',
        processId: 0,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      expect(pendingSpy).toHaveBeenCalledOnce();
    });
  });

  describe('worker log fallback to primary ring', () => {
    it('uses primary ring when worker-specific ring is empty', async () => {
      reporter.start();

      // Emit logs from the primary process (workerId -1)
      (orchestrator as unknown as EventEmitter).emit('log', {
        processName: 'app',
        workerId: -1,
        type: 'out',
        data: 'primary captured output',
      });

      // Worker 0 crashes without having its own log ring
      (orchestrator as unknown as EventEmitter).emit('worker:exit', {
        processName: 'app',
        workerId: 0,
        code: 1,
        signal: null,
      });

      await vi.advanceTimersByTimeAsync(10_000);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const crash = body.events.find((e: { type: string }) => e.type === 'worker:crash');
      expect(crash.lastLogs).toEqual(['primary captured output']);
    });
  });

  describe('shutdown', () => {
    it('triggers a final flush', async () => {
      reporter.start();

      (orchestrator as unknown as EventEmitter).emit('process:start', {
        processName: 'app',
        processId: 0,
      });

      vi.useRealTimers();
      await reporter.shutdown();

      expect(fetchSpy).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.events).toHaveLength(1);
    });

    it('clears the interval timer', async () => {
      reporter.start();

      vi.useRealTimers();
      await reporter.shutdown();

      // After shutdown, no more flushes should happen
      fetchSpy.mockClear();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
