import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parse, stringify } from 'yaml';
import { ORKIFY_CONFIG_FILE } from '../constants.js';
import type { DeploySettings, ProcessConfig, SavedState } from '../types/index.js';

interface PackageManager {
  name: string;
  install: string;
}

export function detectPackageManager(projectDir: string): PackageManager {
  if (existsSync(join(projectDir, 'pnpm-lock.yaml')))
    return { name: 'pnpm', install: 'pnpm install --frozen-lockfile' };
  if (existsSync(join(projectDir, 'yarn.lock')))
    return { name: 'yarn', install: 'yarn install --frozen-lockfile' };
  if (existsSync(join(projectDir, 'bun.lock')))
    return { name: 'bun', install: 'bun install --frozen-lockfile' };
  return { name: 'npm', install: 'npm ci' };
}

export function detectBuildCommand(
  packageJson: Record<string, unknown>,
  pm: PackageManager
): string | null {
  const scripts = packageJson.scripts as Record<string, string> | undefined;
  if (scripts?.build) return `${pm.name} run build`;
  return null;
}

export function detectEntryPoint(packageJson: Record<string, unknown>, projectDir: string): string {
  if (packageJson.main && typeof packageJson.main === 'string') return packageJson.main;
  const candidates = ['dist/index.js', 'build/index.js', 'index.js', 'server.js', 'app.js'];
  for (const candidate of candidates) {
    if (existsSync(join(projectDir, candidate))) return candidate;
  }
  return 'index.js';
}

export function readPackageJson(projectDir: string): Record<string, unknown> {
  const pkgPath = join(projectDir, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`No package.json found in ${projectDir}`);
  }
  return JSON.parse(readFileSync(pkgPath, 'utf-8'));
}

export function getOrkifyConfig(projectDir: string): SavedState | null {
  const configPath = join(projectDir, ORKIFY_CONFIG_FILE);
  if (!existsSync(configPath)) return null;

  try {
    const content = readFileSync(configPath, 'utf-8');
    const raw = parse(content) as SavedState | null;
    if (!raw) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveOrkifyConfig(projectDir: string, config: SavedState): void {
  const configPath = join(projectDir, ORKIFY_CONFIG_FILE);
  writeFileSync(configPath, stringify(config, { defaultStringType: 'QUOTE_DOUBLE' }), 'utf-8');
}

async function prompt(question: string, defaultValue: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [${defaultValue}]: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

export async function interactiveConfig(projectDir: string): Promise<SavedState> {
  const pkg = readPackageJson(projectDir);
  const pm = detectPackageManager(projectDir);
  const buildCmd = detectBuildCommand(pkg, pm);
  const entry = detectEntryPoint(pkg, projectDir);

  console.log('\nConfiguring deployment for this project:\n');

  const install = await prompt('Install command', pm.install);
  const build = await prompt('Build command (leave empty to skip)', buildCmd || '');
  const entryPoint = await prompt('Entry point', entry);
  const workersStr = await prompt('Number of workers (0 = CPU cores)', '1');
  const workers = parseInt(workersStr, 10) || 1;

  const deploy: DeploySettings = { install };
  if (build) {
    deploy.build = build;
  }

  const process: ProcessConfig = {
    name: 'app',
    script: entryPoint,
    cwd: projectDir,
    workerCount: workers,
    execMode: workers > 1 ? 'cluster' : 'fork',
    watch: false,
    env: {},
    nodeArgs: [],
    args: [],
    killTimeout: 5000,
    maxRestarts: 10,
    minUptime: 1000,
    restartDelay: 100,
    sticky: false,
  };

  return {
    version: 1,
    deploy,
    processes: [process],
  };
}

export function collectGitMetadata(projectDir: string): {
  gitSha?: string;
  gitBranch?: string;
  gitAuthor?: string;
  gitMessage?: string;
} {
  const meta: {
    gitSha?: string;
    gitBranch?: string;
    gitAuthor?: string;
    gitMessage?: string;
  } = {};

  try {
    meta.gitSha = execSync('git rev-parse HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();
  } catch {
    // Not a git repo
  }

  try {
    meta.gitBranch = execSync('git branch --show-current', {
      cwd: projectDir,
      encoding: 'utf-8',
    }).trim();
  } catch {
    // git not available
  }

  try {
    meta.gitAuthor = execSync('git log -1 --format=%an', {
      cwd: projectDir,
      encoding: 'utf-8',
    }).trim();
  } catch {
    // git not available
  }

  try {
    meta.gitMessage = execSync('git log -1 --format=%s', {
      cwd: projectDir,
      encoding: 'utf-8',
    }).trim();
  } catch {
    // git not available
  }

  return meta;
}
