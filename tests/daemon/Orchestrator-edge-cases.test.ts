import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UpPayload } from '../../src/types/index.js';
import { Orchestrator } from '../../src/daemon/Orchestrator.js';
import { StateStore } from '../../src/state/StateStore.js';

describe('Orchestrator edge cases', () => {
  let tempDir: string;
  let scriptPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-orch-edge-'));
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

  function makePayload(name: string, script?: string): UpPayload {
    return {
      script: script ?? scriptPath,
      name,
      workers: 1,
      cwd: tempDir,
    };
  }

  describe('concurrent up() with same name', () => {
    // Note: Originally identified as Issue #12 (race condition), but Node's
    // single-threaded event loop means nameToId.has() + nameToId.set() execute
    // synchronously before the first await, preventing the race. This test
    // verifies the duplicate name protection works correctly.
    it('should reject second concurrent up() with same name', async () => {
      const orchestrator = new Orchestrator();

      try {
        // Launch two up() calls simultaneously with the same name.
        // Due to Node's event loop, the first up() registers the name
        // synchronously before yielding at await container.start().
        // The second up() then sees the name already exists.
        const results = await Promise.allSettled([
          orchestrator.up(makePayload('race-test')),
          orchestrator.up(makePayload('race-test')),
        ]);

        // Exactly one should succeed and one should fail
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);

        const error = (rejected[0] as PromiseRejectedResult).reason as Error;
        expect(error.message).toContain('already exists');
      } finally {
        await orchestrator.shutdown();
      }
    }, 15000);
  });

  describe('parallel shutdown', () => {
    // Issue #3: Orchestrator.shutdown() stops processes one at a time in a
    // for-of loop. One hanging process blocks all others. Should use
    // Promise.all() like ClusterWrapper does.
    it('should stop all processes in parallel, not sequentially', async () => {
      // Create a script with a slow shutdown (takes 1.5s to exit after SIGTERM)
      const slowShutdownScript = join(tempDir, 'slow-shutdown.js');
      writeFileSync(
        slowShutdownScript,
        `
        const http = require('http');
        const server = http.createServer((req, res) => res.end('ok'));
        server.listen(0, () => {
          if (process.send) process.send('ready');
        });
        process.on('SIGTERM', () => {
          // Simulate slow graceful shutdown (1.5 seconds)
          setTimeout(() => {
            server.close(() => process.exit(0));
          }, 1500);
        });
      `
      );

      const orchestrator = new Orchestrator();

      try {
        // Start 3 processes with slow shutdown
        await orchestrator.up({
          script: slowShutdownScript,
          name: 'slow-1',
          workers: 1,
          cwd: tempDir,
        });
        await orchestrator.up({
          script: slowShutdownScript,
          name: 'slow-2',
          workers: 1,
          cwd: tempDir,
        });
        await orchestrator.up({
          script: slowShutdownScript,
          name: 'slow-3',
          workers: 1,
          cwd: tempDir,
        });

        // Wait for processes to be running
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Measure shutdown time
        const start = Date.now();
        await orchestrator.shutdown();
        const elapsed = Date.now() - start;

        // If parallel: ~1.5s (all stop simultaneously)
        // If sequential: ~4.5s (each waits 1.5s)
        // Use 3s as the threshold - well above parallel, well below sequential
        expect(elapsed).toBeLessThan(3000);
      } finally {
        // Safety net in case shutdown didn't complete
        await orchestrator.shutdown().catch(() => {});
      }
    }, 15000);
  });

  describe('forceShutdown', () => {
    it('should SIGKILL all children immediately', async () => {
      const orchestrator = new Orchestrator();

      try {
        await orchestrator.up({
          script: scriptPath,
          name: 'force-1',
          workers: 1,
          cwd: tempDir,
        });
        await orchestrator.up({
          script: scriptPath,
          name: 'force-2',
          workers: 1,
          cwd: tempDir,
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        // forceShutdown should be synchronous (no waiting for SIGTERM)
        const start = Date.now();
        orchestrator.forceShutdown();
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(500);
        expect(orchestrator.list()).toHaveLength(0);
      } finally {
        orchestrator.forceShutdown();
      }
    }, 10000);
  });

  describe('snap with --no-env', () => {
    it('snap({ noEnv: true }) strips env from snapshot file', async () => {
      const stateFile = join(tempDir, 'snapshot.yml');
      const store = new StateStore(stateFile);
      const orchestrator = new Orchestrator();

      // Override the private stateStore via save() indirection — use the store directly
      // to verify. We start a real process so getRunningConfigs() returns something.
      try {
        await orchestrator.up({
          script: scriptPath,
          name: 'env-strip-test',
          workers: 1,
          cwd: tempDir,
          env: { SECRET: 'supersecret', NODE_ENV: 'production' },
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        // Access the private stateStore to point it at our temp file
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (orchestrator as any).stateStore = store;

        await orchestrator.snap({ noEnv: true });

        const content = readFileSync(stateFile, 'utf-8');
        const { parse } = await import('yaml');
        const state = parse(content);

        expect(state.processes).toHaveLength(1);
        expect(state.processes[0].env).toEqual({});
        // Other config properties should be preserved
        expect(state.processes[0].name).toBe('env-strip-test');
        expect(state.processes[0].script).toBe(scriptPath);
      } finally {
        await orchestrator.shutdown();
      }
    }, 15000);

    it('snap() (default) preserves env in snapshot file', async () => {
      const stateFile = join(tempDir, 'snapshot.yml');
      const store = new StateStore(stateFile);
      const orchestrator = new Orchestrator();

      try {
        await orchestrator.up({
          script: scriptPath,
          name: 'env-preserve-test',
          workers: 1,
          cwd: tempDir,
          env: { SECRET: 'supersecret', NODE_ENV: 'production' },
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (orchestrator as any).stateStore = store;

        await orchestrator.snap();

        const content = readFileSync(stateFile, 'utf-8');
        const { parse } = await import('yaml');
        const state = parse(content);

        expect(state.processes).toHaveLength(1);
        expect(state.processes[0].env).toEqual({
          SECRET: 'supersecret',
          NODE_ENV: 'production',
        });
      } finally {
        await orchestrator.shutdown();
      }
    }, 15000);
  });

  describe('down then up with same name', () => {
    // Issue #17: down() stops the process but doesn't remove it from the
    // process map. A subsequent up() with the same name fails with
    // "Process already exists" even though it's stopped.
    it('should allow up() after down() with the same name', async () => {
      const orchestrator = new Orchestrator();

      try {
        // Start a process
        await orchestrator.up(makePayload('reuse-name'));
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Stop it (but don't delete)
        await orchestrator.down('reuse-name');
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Verify it's stopped but still in the list
        const list = orchestrator.list();
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('reuse-name');
        expect(list[0].status).toBe('stopped');

        // Try to start a new process with the same name — should work,
        // but currently fails with "Process already exists"
        const info = await orchestrator.up(makePayload('reuse-name'));
        expect(info.name).toBe('reuse-name');
        // Status may be 'launching' (launch timer running) or 'online' (ready signal received)
        expect(['online', 'launching']).toContain(info.status);
      } finally {
        await orchestrator.shutdown();
      }
    }, 15000);
  });
});
