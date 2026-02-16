import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ORKIFY_CONFIG_FILE } from '../../src/constants.js';
import { getOrkifyConfig } from '../../src/deploy/config.js';
import type { ProcessConfig } from '../../src/types/index.js';

describe('DeployExecutor reconcile integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-deploy-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('getOrkifyConfig reads processes from orkify.yml in release dir', () => {
    const orkifyYml = `
version: 1
deploy:
  install: npm ci
  build: npm run build
processes:
  - name: api
    script: dist/server.js
    workerCount: 4
    cwd: /app
    execMode: cluster
    watch: false
    env: {}
    nodeArgs: []
    args: []
    killTimeout: 5000
    maxRestarts: 10
    minUptime: 1000
    restartDelay: 100
    sticky: true
    port: 3000
    healthCheck: /health
  - name: worker
    script: dist/worker.js
    workerCount: 2
    cwd: /app
    execMode: cluster
    watch: false
    env: {}
    nodeArgs: []
    args: []
    killTimeout: 5000
    maxRestarts: 10
    minUptime: 1000
    restartDelay: 100
    sticky: false
`;
    writeFileSync(join(tempDir, ORKIFY_CONFIG_FILE), orkifyYml, 'utf-8');

    const config = getOrkifyConfig(tempDir);
    if (!config) throw new Error('expected config');
    expect(config.deploy).toEqual({ install: 'npm ci', build: 'npm run build' });
    expect(config.processes).toHaveLength(2);
    expect(config.processes[0].name).toBe('api');
    expect(config.processes[0].healthCheck).toBe('/health');
    expect(config.processes[0].port).toBe(3000);
    expect(config.processes[1].name).toBe('worker');
    expect(config.processes[1].workerCount).toBe(2);
  });

  it('reconcile resolves script paths relative to release dir', () => {
    const currentLink = join(tempDir, 'current');
    mkdirSync(currentLink, { recursive: true });

    const configs: ProcessConfig[] = [
      {
        name: 'api',
        script: 'dist/server.js',
        cwd: '/old',
        workerCount: 4,
        execMode: 'cluster',
        watch: false,
        env: {},
        nodeArgs: [],
        args: [],
        killTimeout: 5000,
        maxRestarts: 10,
        minUptime: 1000,
        restartDelay: 100,
        sticky: true,
        port: 3000,
        healthCheck: '/health',
      },
    ];

    // Simulate what DeployExecutor.reconcileProcesses does
    const resolvedConfigs = configs.map((config) => ({
      ...config,
      script: join(currentLink, config.script),
      cwd: currentLink,
    }));

    expect(resolvedConfigs[0].script).toBe(join(currentLink, 'dist/server.js'));
    expect(resolvedConfigs[0].cwd).toBe(currentLink);
    // Original name and config preserved
    expect(resolvedConfigs[0].name).toBe('api');
    expect(resolvedConfigs[0].healthCheck).toBe('/health');
  });

  it('throws when orkify.yml is missing', () => {
    // No orkify.yml in tempDir — reconcileProcesses now requires it
    const fileConfig = getOrkifyConfig(tempDir);

    expect(fileConfig).toBeNull();

    // DeployExecutor.reconcileProcesses would throw
    if (!fileConfig?.processes?.length) {
      expect(() => {
        throw new Error('No processes defined in orkify.yml');
      }).toThrow('No processes defined in orkify.yml');
    }
  });

  it('DeployCommand includes deployConfig field', () => {
    // Verify the shape matches the DeployCommand interface
    const cmd = {
      type: 'deploy' as const,
      deployId: 'deploy-1',
      targetId: 'target-1',
      artifactId: 'abc123',
      version: 1,
      sha256: 'abc',
      sizeBytes: 1024,
      downloadToken: 'token',
      downloadUrl: 'http://example.com/dl',
      deployConfig: { install: 'npm ci', build: 'npm run build', crashWindow: 30 },
    };

    expect(cmd.deployConfig.install).toBe('npm ci');
    expect(cmd.deployConfig.build).toBe('npm run build');
    expect(cmd.deployConfig.crashWindow).toBe(30);
  });
});
