import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExecMode } from '../../src/constants.js';
import { Orchestrator } from '../../src/daemon/Orchestrator.js';
import type { ProcessConfig, UpPayload } from '../../src/types/index.js';

describe('Orchestrator', () => {
  let tempDir: string;
  let scriptPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-orchestrator-test-'));
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

  afterEach(async () => {
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

  function makeConfig(name: string, script?: string): ProcessConfig {
    return {
      name,
      script: script ?? scriptPath,
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
    };
  }

  describe('restoreFromMemory', () => {
    it('continues restoring after one config fails', async () => {
      const orkify = new Orchestrator();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        const configs: ProcessConfig[] = [
          makeConfig('app-1'),
          makeConfig('app-bad', '/nonexistent/script.js'),
          makeConfig('app-3'),
        ];

        const results = await orkify.restoreFromMemory(configs);

        // 1st and 3rd should be restored; 2nd should have failed
        expect(results).toHaveLength(2);
        expect(results[0].name).toBe('app-1');
        expect(results[1].name).toBe('app-3');

        // Error should be logged for the failed one
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('app-bad'),
          expect.any(String)
        );
      } finally {
        consoleSpy.mockRestore();
        await orkify.shutdown();
      }
    }, 15000);
  });

  describe('up', () => {
    it('allows retry after up() throws', async () => {
      const orkify = new Orchestrator();

      try {
        // First attempt: script doesn't exist → up() throws "Script not found"
        await expect(
          orkify.up(makePayload('retry-test', '/nonexistent/script.js'))
        ).rejects.toThrow('Script not found');

        // Second attempt with same name and valid script should succeed
        // (maps were cleaned up because the error happened before start())
        const info = await orkify.up(makePayload('retry-test'));
        expect(info.name).toBe('retry-test');
      } finally {
        await orkify.shutdown();
      }
    }, 15000);
  });

  describe('down', () => {
    it('continues stopping when one container.stop() throws', async () => {
      const orkify = new Orchestrator();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Start 3 processes
        await orkify.up(makePayload('stop-1'));
        await orkify.up(makePayload('stop-2'));
        await orkify.up(makePayload('stop-3'));
        await new Promise((r) => setTimeout(r, 500));

        // Monkey-patch the 2nd container's stop() to throw
        const container2 = orkify.getProcessByName('stop-2');
        expect(container2).toBeDefined();
        if (!container2) throw new Error('unreachable');
        const originalStop = container2.stop.bind(container2);
        container2.stop = async () => {
          throw new Error('Simulated stop failure');
        };

        const results = await orkify.down('all');

        // 1st and 3rd should have been stopped successfully
        expect(results.length).toBeGreaterThanOrEqual(2);

        // Error should be logged
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('stop-2'),
          expect.any(String)
        );

        // Restore original stop for cleanup
        container2.stop = originalStop;
      } finally {
        consoleSpy.mockRestore();
        await orkify.shutdown();
      }
    }, 15000);
  });

  describe('delete', () => {
    it('continues deleting when one container.stop() throws', async () => {
      const orkify = new Orchestrator();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await orkify.up(makePayload('del-1'));
        await orkify.up(makePayload('del-2'));
        await orkify.up(makePayload('del-3'));
        await new Promise((r) => setTimeout(r, 500));

        // Monkey-patch the 2nd container's stop() to throw
        const container2 = orkify.getProcessByName('del-2');
        expect(container2).toBeDefined();
        if (!container2) throw new Error('unreachable');
        container2.stop = async () => {
          throw new Error('Simulated stop failure');
        };

        const results = await orkify.delete('all');

        // All 3 should be removed from maps (delete always removes, even on stop failure)
        expect(results.length).toBeGreaterThanOrEqual(2);

        // Verify all are removed from maps
        expect(orkify.getProcessByName('del-1')).toBeUndefined();
        expect(orkify.getProcessByName('del-2')).toBeUndefined();
        expect(orkify.getProcessByName('del-3')).toBeUndefined();

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('del-2'),
          expect.any(String)
        );
      } finally {
        consoleSpy.mockRestore();
        // No need to shutdown — all processes deleted
      }
    }, 15000);
  });

  describe('shutdown', () => {
    it('continues shutdown when one container.stop() throws', async () => {
      const orkify = new Orchestrator();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await orkify.up(makePayload('shut-1'));
        await orkify.up(makePayload('shut-2'));
        await orkify.up(makePayload('shut-3'));
        await new Promise((r) => setTimeout(r, 500));

        // Monkey-patch the 2nd container's stop() to throw
        const container2 = orkify.getProcessByName('shut-2');
        expect(container2).toBeDefined();
        if (!container2) throw new Error('unreachable');
        container2.stop = async () => {
          throw new Error('Simulated stop failure');
        };

        // shutdown() should not throw
        await orkify.shutdown();

        // Maps should be cleared
        expect(orkify.list()).toHaveLength(0);
      } finally {
        consoleSpy.mockRestore();
      }
    }, 15000);
  });
});
