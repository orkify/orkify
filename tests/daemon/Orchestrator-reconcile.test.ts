import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ExecMode,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_MIN_UPTIME,
  DEFAULT_RESTART_DELAY,
  DEFAULT_RELOAD_RETRIES,
  DEFAULT_LOG_MAX_SIZE,
  DEFAULT_LOG_MAX_FILES,
  DEFAULT_LOG_MAX_AGE,
  KILL_TIMEOUT,
} from '../../src/constants.js';
import { Orchestrator } from '../../src/daemon/Orchestrator.js';
import type { ProcessConfig } from '../../src/types/index.js';

describe('Orchestrator.reconcile', () => {
  let tempDir: string;
  let scriptPath: string;
  let scriptPath2: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-reconcile-test-'));
    scriptPath = join(tempDir, 'app.js');
    scriptPath2 = join(tempDir, 'worker.js');

    const appScript = `
      const http = require('http');
      const server = http.createServer((req, res) => res.end('ok'));
      server.listen(0, () => { if (process.send) process.send('ready'); });
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `;

    writeFileSync(scriptPath, appScript);
    writeFileSync(scriptPath2, appScript);
  });

  afterEach(async () => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeConfig(name: string, overrides?: Partial<ProcessConfig>): ProcessConfig {
    return {
      name,
      script: scriptPath,
      cwd: tempDir,
      workerCount: 1,
      execMode: ExecMode.FORK,
      watch: false,
      env: {},
      nodeArgs: [],
      args: [],
      killTimeout: KILL_TIMEOUT,
      maxRestarts: DEFAULT_MAX_RESTARTS,
      minUptime: DEFAULT_MIN_UPTIME,
      restartDelay: DEFAULT_RESTART_DELAY,
      sticky: false,
      reloadRetries: DEFAULT_RELOAD_RETRIES,
      logMaxSize: DEFAULT_LOG_MAX_SIZE,
      logMaxFiles: DEFAULT_LOG_MAX_FILES,
      logMaxAge: DEFAULT_LOG_MAX_AGE,
      ...overrides,
    };
  }

  it('starts new processes that are not running', async () => {
    const orkify = new Orchestrator();

    try {
      const result = await orkify.reconcile([makeConfig('api'), makeConfig('worker')]);

      expect(result.started).toEqual(['api', 'worker']);
      expect(result.reloaded).toEqual([]);
      expect(result.deleted).toEqual([]);
      expect(orkify.list()).toHaveLength(2);
    } finally {
      await orkify.shutdown();
    }
  }, 15000);

  it('reloads unchanged processes', async () => {
    const orkify = new Orchestrator();

    try {
      // Start an initial process
      await orkify.up({ script: scriptPath, name: 'api', workers: 1, cwd: tempDir });
      await new Promise((r) => setTimeout(r, 500));

      // Reconcile with the same config
      const result = await orkify.reconcile([makeConfig('api')]);

      expect(result.started).toEqual([]);
      expect(result.reloaded).toEqual(['api']);
      expect(result.deleted).toEqual([]);
    } finally {
      await orkify.shutdown();
    }
  }, 15000);

  it('deletes processes not in target configs', async () => {
    const orkify = new Orchestrator();

    try {
      await orkify.up({ script: scriptPath, name: 'api', workers: 1, cwd: tempDir });
      await orkify.up({ script: scriptPath, name: 'old-worker', workers: 1, cwd: tempDir });
      await new Promise((r) => setTimeout(r, 500));

      // Reconcile with only 'api' — 'old-worker' should be deleted
      const result = await orkify.reconcile([makeConfig('api')]);

      expect(result.deleted).toEqual(['old-worker']);
      expect(orkify.getProcessByName('old-worker')).toBeUndefined();
    } finally {
      await orkify.shutdown();
    }
  }, 15000);

  it('replaces processes with changed config', async () => {
    const orkify = new Orchestrator();

    try {
      await orkify.up({ script: scriptPath, name: 'api', workers: 1, cwd: tempDir });
      await new Promise((r) => setTimeout(r, 500));

      // Reconcile with a different script — should delete + re-up
      const result = await orkify.reconcile([makeConfig('api', { script: scriptPath2 })]);

      // Changed config causes delete + start, which appears as 'started'
      expect(result.started).toEqual(['api']);
      expect(orkify.list()).toHaveLength(1);
    } finally {
      await orkify.shutdown();
    }
  }, 15000);

  it('handles empty target configs (deletes all)', async () => {
    const orkify = new Orchestrator();

    try {
      await orkify.up({ script: scriptPath, name: 'api', workers: 1, cwd: tempDir });
      await new Promise((r) => setTimeout(r, 500));

      const result = await orkify.reconcile([]);

      expect(result.deleted).toEqual(['api']);
      expect(orkify.list()).toHaveLength(0);
    } finally {
      await orkify.shutdown();
    }
  }, 15000);

  it('merges env from second argument', async () => {
    const orkify = new Orchestrator();

    try {
      const config = makeConfig('api', { env: { APP_ENV: 'production' } });
      await orkify.reconcile([config], { SECRET: 'value' });

      const running = orkify.list();
      expect(running).toHaveLength(1);
      expect(running[0].name).toBe('api');
    } finally {
      await orkify.shutdown();
    }
  }, 15000);
});
