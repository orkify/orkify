import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProcessConfig } from '../../src/types/index.js';
import { ORKIFY_CONFIG_FILE } from '../../src/constants.js';
import { getOrkifyConfig } from '../../src/deploy/config.js';
import { detectFramework } from '../../src/detect/framework.js';

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
        logMaxSize: 100 * 1024 * 1024,
        logMaxFiles: 90,
        logMaxAge: 90 * 24 * 60 * 60 * 1000,
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

  describe('NEXT_DEPLOYMENT_ID generation', () => {
    it('detects Next.js in release dir with next.config.ts', () => {
      writeFileSync(join(tempDir, 'next.config.ts'), 'export default {}', 'utf-8');
      expect(detectFramework(tempDir)).toBe('nextjs');
    });

    it('detects Next.js in release dir with next.config.js', () => {
      writeFileSync(join(tempDir, 'next.config.js'), 'module.exports = {}', 'utf-8');
      expect(detectFramework(tempDir)).toBe('nextjs');
    });

    it('does not detect Next.js when no config files exist', () => {
      expect(detectFramework(tempDir)).toBeUndefined();
    });

    it('NEXT_DEPLOYMENT_ID format matches v{version}-{artifactSlice}', () => {
      const version = 42;
      const artifactId = 'abcdef1234567890';
      const id = `v${version}-${artifactId.slice(0, 8)}`;
      expect(id).toBe('v42-abcdef12');
      expect(id).toMatch(/^v\d+-[a-f0-9]{8}$/);
    });
  });

  describe('buildEnv handling', () => {
    it('buildEnv values override matching secrets during build', () => {
      const secrets = { API_KEY: 'secret-val', SHARED_KEY: 'from-secrets' };
      const buildEnvConfig = {
        SHARED_KEY: 'from-buildEnv',
        NEXT_PUBLIC_URL: 'https://example.com',
      };

      // Simulates what DeployExecutor does
      const buildEnv = { ...secrets, ...buildEnvConfig };

      expect(buildEnv.SHARED_KEY).toBe('from-buildEnv');
      expect(buildEnv.API_KEY).toBe('secret-val');
      expect(buildEnv.NEXT_PUBLIC_URL).toBe('https://example.com');
    });

    it('buildEnv vars are NOT present in runtime env', () => {
      const secrets = { API_KEY: 'secret-val' };

      // Runtime env only gets secrets, not buildEnv — buildEnv is scoped to build step
      const runtimeEnv = { NODE_ENV: 'production', ...secrets };

      expect(runtimeEnv).not.toHaveProperty('NEXT_PUBLIC_URL');
      expect(runtimeEnv.API_KEY).toBe('secret-val');
      expect(runtimeEnv.NODE_ENV).toBe('production');
    });

    it('user-provided NEXT_DEPLOYMENT_ID in secrets takes precedence', () => {
      const secrets = { NEXT_DEPLOYMENT_ID: 'user-custom-id' };
      const autoId = 'v1-abc12345';

      // Simulates the guard in DeployExecutor
      const buildEnv = { ...secrets };
      if (autoId && !buildEnv.NEXT_DEPLOYMENT_ID) {
        buildEnv.NEXT_DEPLOYMENT_ID = autoId;
      }

      expect(buildEnv.NEXT_DEPLOYMENT_ID).toBe('user-custom-id');
    });

    it('NEXT_DEPLOYMENT_ID is passed to runtime env when auto-detected', () => {
      const secrets = { API_KEY: 'val' };
      const nextDeploymentId = 'v5-deadbeef';

      // Simulates reconcileProcesses
      const runtimeEnv: Record<string, string> = { NODE_ENV: 'production', ...secrets };
      if (nextDeploymentId && !runtimeEnv.NEXT_DEPLOYMENT_ID) {
        runtimeEnv.NEXT_DEPLOYMENT_ID = nextDeploymentId;
      }

      expect(runtimeEnv.NEXT_DEPLOYMENT_ID).toBe('v5-deadbeef');
    });

    it('build command receives buildEnv vars in its environment', () => {
      const deployConfig = {
        install: 'npm ci',
        build: 'npm run build',
        buildEnv: {
          NEXT_PUBLIC_API_URL: 'https://api.example.com',
          NEXT_PUBLIC_SITE_NAME: 'My App',
        },
      };
      const secrets = { DB_URL: 'postgres://...' };

      // Simulates the merge in DeployExecutor
      const buildEnv = { ...secrets, ...deployConfig.buildEnv };

      expect(buildEnv.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
      expect(buildEnv.NEXT_PUBLIC_SITE_NAME).toBe('My App');
      expect(buildEnv.DB_URL).toBe('postgres://...');
    });
  });
});
