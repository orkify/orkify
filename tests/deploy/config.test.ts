import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { ORKIFY_CONFIG_FILE } from '../../src/constants.js';
import {
  getOrkifyConfig,
  saveOrkifyConfig,
  readPackageJson,
  detectPackageManager,
  detectBuildCommand,
  detectEntryPoint,
  collectGitMetadata,
  interactiveConfig,
} from '../../src/deploy/config.js';
import type { SavedState } from '../../src/types/index.js';

vi.mock('node:readline', () => ({
  createInterface: vi.fn(),
}));

const mockCreateInterface = createInterface as unknown as Mock;

describe('deploy config', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-config-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getOrkifyConfig', () => {
    it('returns null when orkify.yml does not exist', () => {
      const config = getOrkifyConfig(tempDir);
      expect(config).toBeNull();
    });

    it('reads a valid orkify.yml', () => {
      const yml = `
version: 1
deploy:
  install: npm ci
  build: npm run build
processes:
  - name: api
    script: dist/server.js
    workerCount: 4
    sticky: true
    port: 3000
    healthCheck: /health
`;
      writeFileSync(join(tempDir, ORKIFY_CONFIG_FILE), yml, 'utf-8');

      const config = getOrkifyConfig(tempDir);
      if (!config) throw new Error('expected config');
      expect(config.version).toBe(1);
      expect(config.deploy).toEqual({ install: 'npm ci', build: 'npm run build' });
      expect(config.processes).toHaveLength(1);
      expect(config.processes[0].name).toBe('api');
      expect(config.processes[0].script).toBe('dist/server.js');
      expect(config.processes[0].workerCount).toBe(4);
      expect(config.processes[0].sticky).toBe(true);
      expect(config.processes[0].port).toBe(3000);
      expect(config.processes[0].healthCheck).toBe('/health');
    });

    it('returns null for invalid YAML', () => {
      writeFileSync(join(tempDir, ORKIFY_CONFIG_FILE), '{{{{invalid', 'utf-8');
      const config = getOrkifyConfig(tempDir);
      expect(config).toBeNull();
    });

    it('reads config without deploy section', () => {
      const yml = `
version: 1
processes:
  - name: worker
    script: dist/worker.js
    workerCount: 2
`;
      writeFileSync(join(tempDir, ORKIFY_CONFIG_FILE), yml, 'utf-8');

      const config = getOrkifyConfig(tempDir);
      if (!config) throw new Error('expected config');
      expect(config.deploy).toBeUndefined();
      expect(config.processes).toHaveLength(1);
    });
  });

  describe('saveOrkifyConfig', () => {
    it('writes orkify.yml', () => {
      const state: SavedState = {
        version: 1,
        deploy: { install: 'npm ci', build: 'npm run build' },
        processes: [
          {
            name: 'api',
            script: 'dist/server.js',
            cwd: '/app',
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
        ],
      };

      saveOrkifyConfig(tempDir, state);

      const configPath = join(tempDir, ORKIFY_CONFIG_FILE);
      expect(existsSync(configPath)).toBe(true);

      // Read it back
      const loaded = getOrkifyConfig(tempDir);
      if (!loaded) throw new Error('expected loaded config');
      if (!loaded.deploy) throw new Error('expected deploy section');
      expect(loaded.deploy.install).toBe('npm ci');
      expect(loaded.processes[0].name).toBe('api');
      expect(loaded.processes[0].healthCheck).toBe('/health');
    });
  });

  describe('readPackageJson', () => {
    it('reads package.json', () => {
      writeFileSync(
        join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test-app', version: '1.2.3' }),
        'utf-8'
      );
      const pkg = readPackageJson(tempDir);
      expect(pkg.name).toBe('test-app');
      expect(pkg.version).toBe('1.2.3');
    });

    it('throws when package.json is missing', () => {
      expect(() => readPackageJson(tempDir)).toThrow('No package.json found');
    });
  });

  describe('detectPackageManager', () => {
    it('detects npm by default', () => {
      const pm = detectPackageManager(tempDir);
      expect(pm.name).toBe('npm');
    });

    it('detects pnpm', () => {
      writeFileSync(join(tempDir, 'pnpm-lock.yaml'), '', 'utf-8');
      const pm = detectPackageManager(tempDir);
      expect(pm.name).toBe('pnpm');
    });

    it('detects yarn', () => {
      writeFileSync(join(tempDir, 'yarn.lock'), '', 'utf-8');
      const pm = detectPackageManager(tempDir);
      expect(pm.name).toBe('yarn');
    });

    it('detects bun', () => {
      writeFileSync(join(tempDir, 'bun.lock'), '', 'utf-8');
      const pm = detectPackageManager(tempDir);
      expect(pm.name).toBe('bun');
    });
  });

  describe('detectEntryPoint', () => {
    it('uses package.json main field', () => {
      const entry = detectEntryPoint({ main: 'src/app.js' }, tempDir);
      expect(entry).toBe('src/app.js');
    });

    it('ignores non-string main field', () => {
      const entry = detectEntryPoint({ main: 42 }, tempDir);
      // Should fall through to candidate detection, default to server.js
      expect(entry).toBe('server.js');
    });

    it('finds dist/index.js if it exists', () => {
      mkdirSync(join(tempDir, 'dist'), { recursive: true });
      writeFileSync(join(tempDir, 'dist', 'index.js'), '', 'utf-8');
      const entry = detectEntryPoint({}, tempDir);
      expect(entry).toBe('dist/index.js');
    });

    it('finds server.js when earlier candidates do not exist', () => {
      writeFileSync(join(tempDir, 'server.js'), '', 'utf-8');
      const entry = detectEntryPoint({}, tempDir);
      expect(entry).toBe('server.js');
    });

    it('defaults to server.js', () => {
      const entry = detectEntryPoint({}, tempDir);
      expect(entry).toBe('server.js');
    });
  });

  describe('detectBuildCommand', () => {
    it('returns build command when scripts.build exists', () => {
      const result = detectBuildCommand(
        { scripts: { build: 'tsc' } },
        { name: 'npm', install: 'npm ci' }
      );
      expect(result).toBe('npm run build');
    });

    it('returns null when scripts.build is absent', () => {
      const result = detectBuildCommand(
        { scripts: { start: 'node app.js' } },
        { name: 'npm', install: 'npm ci' }
      );
      expect(result).toBeNull();
    });

    it('returns null when scripts is undefined', () => {
      const result = detectBuildCommand({}, { name: 'npm', install: 'npm ci' });
      expect(result).toBeNull();
    });

    it('uses the correct package manager name', () => {
      const result = detectBuildCommand(
        { scripts: { build: 'tsc' } },
        { name: 'pnpm', install: 'pnpm install' }
      );
      expect(result).toBe('pnpm run build');
    });
  });

  describe('collectGitMetadata', () => {
    it('collects git metadata from a real git repo', () => {
      // tempDir is not a git repo, but the parent project is
      // Use the actual project dir which is a git repo
      const projectRoot = join(__dirname, '..', '..');
      const meta = collectGitMetadata(projectRoot);

      // Should have at least sha and branch since we're in a git repo
      expect(meta.gitSha).toBeDefined();
      expect(meta.gitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(meta.gitBranch).toBeDefined();
      expect(meta.gitAuthor).toBeDefined();
      expect(meta.gitMessage).toBeDefined();
    });

    it('returns empty fields for non-git directory', () => {
      const meta = collectGitMetadata(tempDir);
      // tempDir is a fresh temp dir, not a git repo
      expect(meta.gitSha).toBeUndefined();
      expect(meta.gitBranch).toBeUndefined();
      expect(meta.gitAuthor).toBeUndefined();
      expect(meta.gitMessage).toBeUndefined();
    });
  });

  describe('getOrkifyConfig edge cases', () => {
    it('returns null for empty YAML file', () => {
      writeFileSync(join(tempDir, ORKIFY_CONFIG_FILE), '', 'utf-8');
      const config = getOrkifyConfig(tempDir);
      expect(config).toBeNull();
    });
  });

  describe('interactiveConfig', () => {
    function setupPromptMock(answers: string[]) {
      let callIndex = 0;
      mockCreateInterface.mockReturnValue({
        question(_q: string, cb: (answer: string) => void) {
          cb(answers[callIndex++] ?? '');
        },
        write() {},
        close() {},
      });
    }

    afterEach(() => {
      mockCreateInterface.mockReset();
    });

    it('generates config with package.json and build script', async () => {
      writeFileSync(
        join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test', scripts: { build: 'tsc' } }),
        'utf-8'
      );
      setupPromptMock(['npm ci', 'npm run build', 'server.js', '0']);
      const result = await interactiveConfig(tempDir);
      expect(result.version).toBe(1);
      expect(result.deploy.install).toBe('npm ci');
      expect(result.deploy.build).toBe('npm run build');
      expect(result.processes).toHaveLength(1);
      expect(result.processes[0].script).toBe('server.js');
      expect(result.processes[0].workerCount).toBe(0);
      expect(result.processes[0].execMode).toBe('cluster');
    });

    it('stores workerCount 0 as 0 with cluster mode', async () => {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
      setupPromptMock(['npm ci', '', 'app.js', '0']);
      const result = await interactiveConfig(tempDir);
      expect(result.processes[0].workerCount).toBe(0);
      expect(result.processes[0].execMode).toBe('cluster');
    });

    it('sets fork mode for workerCount 1', async () => {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
      setupPromptMock(['npm ci', '', 'app.js', '1']);
      const result = await interactiveConfig(tempDir);
      expect(result.processes[0].workerCount).toBe(1);
      expect(result.processes[0].execMode).toBe('fork');
    });

    it('sets cluster mode for workerCount > 1', async () => {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
      setupPromptMock(['npm ci', '', 'app.js', '4']);
      const result = await interactiveConfig(tempDir);
      expect(result.processes[0].workerCount).toBe(4);
      expect(result.processes[0].execMode).toBe('cluster');
    });

    it('treats non-numeric workers as 0', async () => {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
      setupPromptMock(['npm ci', '', 'app.js', 'abc']);
      const result = await interactiveConfig(tempDir);
      expect(result.processes[0].workerCount).toBe(0);
      expect(result.processes[0].execMode).toBe('cluster');
    });

    it('omits deploy.build when build answer is empty', async () => {
      writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8');
      setupPromptMock(['npm ci', '', 'app.js', '1']);
      const result = await interactiveConfig(tempDir);
      expect(result.deploy.build).toBeUndefined();
    });

    it('works without package.json', async () => {
      setupPromptMock(['', '', 'index.js', '2']);
      const result = await interactiveConfig(tempDir);
      expect(result.deploy.install).toBe('');
      expect(result.processes[0].script).toBe('index.js');
      expect(result.processes[0].workerCount).toBe(2);
      expect(result.processes[0].execMode).toBe('cluster');
    });
  });
});
