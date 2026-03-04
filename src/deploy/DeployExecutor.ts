import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Orchestrator } from '../daemon/Orchestrator.js';
import type { TelemetryReporter } from '../telemetry/TelemetryReporter.js';
import type {
  DeployCommand,
  DeployOptions,
  DeployStatus,
  TelemetryConfig,
} from '../types/index.js';
import { DEPLOY_CRASH_WINDOW_DEFAULT, DEPLOY_META_FILE, ORKIFY_DEPLOYS_DIR } from '../constants.js';
import { detectFramework } from '../detect/framework.js';
import { getOrkifyConfig } from './config.js';

export class DeployExecutor {
  private config: TelemetryConfig;
  private orchestrator: Orchestrator;
  private telemetry: TelemetryReporter;
  private cmd: DeployCommand;
  private options: DeployOptions;
  private buildLog = '';
  private buildLogLines: string[] = [];
  private nextDeploymentId: string | undefined;

  constructor(
    config: TelemetryConfig,
    orchestrator: Orchestrator,
    telemetry: TelemetryReporter,
    cmd: DeployCommand,
    options?: DeployOptions
  ) {
    this.config = config;
    this.orchestrator = orchestrator;
    this.telemetry = telemetry;
    this.cmd = cmd;
    this.options = options ?? {};
  }

  async execute(): Promise<void> {
    const deployConfig = this.cmd.deployConfig;
    const deploysDir = this.options.deploysDir ?? ORKIFY_DEPLOYS_DIR;
    const releaseName = this.options.localTarball
      ? `local-${this.cmd.version}`
      : `${this.cmd.version}-${this.cmd.artifactId.slice(0, 8)}`;
    const releasesDir = join(deploysDir, 'releases');
    const releaseDir = join(releasesDir, releaseName);
    const currentLink = join(deploysDir, 'current');

    try {
      mkdirSync(releasesDir, { recursive: true });

      // 1. Download or copy local tarball
      this.reportPhase('downloading');
      const tarPath = join(releasesDir, `v${this.cmd.version}.tar.gz`);
      if (this.options.localTarball) {
        copyFileSync(this.options.localTarball, tarPath);
      } else {
        await this.download(this.cmd.downloadUrl, tarPath);
        await this.verifySha256(tarPath, this.cmd.sha256);
      }

      // 2. Extract
      this.reportPhase('extracting');
      mkdirSync(releaseDir, { recursive: true });
      await this.extract(tarPath, releaseDir);
      unlinkSync(tarPath);

      // 2b. Write deploy metadata (used by restore to identify the current release)
      writeFileSync(
        join(releaseDir, DEPLOY_META_FILE),
        JSON.stringify({
          version: this.cmd.version,
          artifactId: this.cmd.artifactId,
        }),
        'utf-8'
      );

      // 2c. Detect Next.js for version skew protection
      if (detectFramework(releaseDir) === 'nextjs') {
        this.nextDeploymentId = `v${this.cmd.version}-${this.cmd.artifactId.slice(0, 8)}`;
      }

      // 3. Fetch secrets
      const secrets =
        this.options.secrets !== undefined
          ? this.options.secrets
          : await this.fetchSecrets(this.cmd.downloadToken);

      // 4. Install + 5. Build
      const buildEnv = { ...secrets, ...deployConfig.buildEnv };

      // Pass NEXT_DEPLOYMENT_ID to build (unless user already set it)
      if (this.nextDeploymentId && !buildEnv.NEXT_DEPLOYMENT_ID) {
        buildEnv.NEXT_DEPLOYMENT_ID = this.nextDeploymentId;
      }

      if (!this.options.skipInstall) {
        this.reportPhase('installing');
        await this.runCommand(deployConfig.install, releaseDir, buildEnv);
      }

      if (!this.options.skipBuild && deployConfig.build) {
        this.reportPhase('building');
        await this.runCommand(deployConfig.build, releaseDir, buildEnv);
      }

      // 6. Swap symlink
      let previousDir: null | string = null;
      if (existsSync(currentLink)) {
        try {
          previousDir = readlinkSync(currentLink);
        } catch {
          // Not a symlink
        }
      }

      this.reportPhase('reloading');
      this.swapSymlink(currentLink, releaseDir);

      // 7. Reconcile processes
      await this.reconcileProcesses(currentLink, secrets);

      // 8. Monitor crash window
      if (!this.options.skipMonitor) {
        this.reportPhase('monitoring');
        const crashWindow = deployConfig.crashWindow ?? DEPLOY_CRASH_WINDOW_DEFAULT;
        const healthy = await this.monitorCrashWindow(crashWindow);

        if (!healthy) {
          if (previousDir && existsSync(previousDir)) {
            this.swapSymlink(currentLink, previousDir);
            await this.reconcileProcesses(currentLink, secrets);
            this.reportPhase('rolled_back', 'Workers crashed within monitoring window');
          } else {
            this.reportPhase('failed', 'Workers crashed and no previous version to rollback to');
          }
          return;
        }
      }

      // 9. Success — health checks are now handled per-process during reconcile/reload
      this.reportPhase('success');

      // 10. Cleanup old releases (preserve the previous version for rollback)
      this.cleanupOldReleases(releasesDir, 3, previousDir);
    } catch (err) {
      this.reportPhase('failed', (err as Error).message);
    }
  }

  private reportPhase(phase: DeployStatus['phase'], error?: string): void {
    console.log(`[deploy] v${this.cmd.version}: ${phase}${error ? ` — ${error}` : ''}`);

    if (this.options.skipTelemetry) return;

    const status: DeployStatus = {
      deployId: this.cmd.deployId,
      targetId: this.cmd.targetId,
      phase,
      buildLog: this.buildLog.slice(-5000),
      error,
    };
    this.telemetry.setDeployStatus(status);

    // Emit deploy lifecycle events for SSE streaming.
    // Fields must be nested inside `details` so they survive Zod parsing
    // on the ingest endpoint and end up in the ClickHouse details column.
    if (phase === 'downloading') {
      this.telemetry.emitEvent('process:deploy-started', 'deploy', {
        details: { deployId: this.cmd.deployId, targetId: this.cmd.targetId },
      });
    } else if (phase === 'success') {
      this.telemetry.emitEvent('process:deploy-finished', 'deploy', {
        details: { deployId: this.cmd.deployId, targetId: this.cmd.targetId },
      });
    } else if (phase === 'failed' || phase === 'rolled_back') {
      this.telemetry.emitEvent('process:deploy-failed', 'deploy', {
        details: {
          deployId: this.cmd.deployId,
          targetId: this.cmd.targetId,
          error: error ?? phase,
        },
      });
    }
  }

  private async download(url: string, destPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const fileStream = createWriteStream(destPath);
    const nodeStream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    await pipeline(nodeStream, fileStream);
  }

  private async verifySha256(filePath: string, expected: string): Promise<void> {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    for await (const chunk of stream) {
      hash.update(chunk);
    }
    const actual = hash.digest('hex');
    if (actual !== expected) {
      throw new Error(
        `SHA-256 mismatch: expected ${expected.slice(0, 12)}..., got ${actual.slice(0, 12)}...`
      );
    }
  }

  private extract(tarPath: string, destDir: string): void {
    execSync(`tar xzf "${tarPath}" -C "${destDir}"`, { stdio: 'pipe' });
  }

  private async fetchSecrets(token: string): Promise<Record<string, string>> {
    try {
      const response = await fetch(`${this.config.apiHost}/api/v1/deploy/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.error(`Secrets fetch failed: ${response.status}`);
        return {};
      }

      const body = (await response.json()) as { secrets: Record<string, string> };
      return body.secrets ?? {};
    } catch (err) {
      console.error(`Secrets fetch error: ${(err as Error).message}`);
      return {};
    }
  }

  private async runCommand(cmd: string, cwd: string, env: Record<string, string>): Promise<void> {
    // Strip NODE_ENV during install/build so devDependencies (TypeScript,
    // bundlers, etc.) are installed. Runtime processes get NODE_ENV from
    // secrets/env as configured — this only affects the build phase.
    const { NODE_ENV: _stripped, ...parentEnv } = process.env;

    return new Promise((resolve, reject) => {
      const isWin = process.platform === 'win32';
      const child = spawn(isWin ? 'cmd.exe' : 'sh', isWin ? ['/c', cmd] : ['-c', cmd], {
        cwd,
        env: { ...parentEnv, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const capture = (data: Buffer) => {
        const text = data.toString();
        this.buildLogLines.push(...text.split('\n'));
        if (this.buildLogLines.length > 200) {
          this.buildLogLines.splice(0, this.buildLogLines.length - 200);
        }
        this.buildLog = this.buildLogLines.join('\n');
      };

      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);

      child.on('exit', (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `Command "${cmd}" exited with code ${code}\n${this.buildLogLines.slice(-20).join('\n')}`
            )
          );
      });

      child.on('error', reject);
    });
  }

  private swapSymlink(linkPath: string, targetPath: string): void {
    if (process.platform === 'win32') {
      if (existsSync(linkPath)) rmSync(linkPath, { recursive: true });
      execSync(`mklink /J "${linkPath}" "${targetPath}"`, { shell: 'cmd.exe' });
    } else {
      const tmpLink = linkPath + '.tmp';
      if (existsSync(tmpLink)) unlinkSync(tmpLink);
      symlinkSync(targetPath, tmpLink);
      renameSync(tmpLink, linkPath);
    }
  }

  private async monitorCrashWindow(windowSeconds: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;

      const onExit = (data: { code: number }) => {
        if (!settled && data.code !== 0 && data.code !== null) {
          settled = true;
          clearTimeout(timer);
          this.orchestrator.removeListener('worker:exit', onExit);
          resolve(false);
        }
      };

      this.orchestrator.on('worker:exit', onExit);

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.orchestrator.removeListener('worker:exit', onExit);
          resolve(true);
        }
      }, windowSeconds * 1000);
      timer.unref();
    });
  }

  private async reconcileProcesses(
    currentLink: string,
    secrets: Record<string, string>
  ): Promise<void> {
    const fileConfig = getOrkifyConfig(currentLink);
    if (!fileConfig?.processes?.length) {
      throw new Error('No processes defined in orkify.yml');
    }
    const configs = fileConfig.processes;

    // Resolve script paths relative to currentLink and set cwd
    const resolvedConfigs = configs.map((config) => ({
      ...config,
      script: join(currentLink, config.script),
      cwd: currentLink,
    }));

    // Default NODE_ENV=production for runtime processes during deploy.
    // Users can override this via secrets/env vars on the dashboard.
    const runtimeEnv: Record<string, string> = { NODE_ENV: 'production', ...secrets };

    // Pass NEXT_DEPLOYMENT_ID to runtime for version skew protection
    if (this.nextDeploymentId && !runtimeEnv.NEXT_DEPLOYMENT_ID) {
      runtimeEnv.NEXT_DEPLOYMENT_ID = this.nextDeploymentId;
    }

    const result = await this.orchestrator.reconcile(resolvedConfigs, runtimeEnv);

    if (result.started.length > 0) {
      console.log(`[deploy] Started: ${result.started.join(', ')}`);
    }
    if (result.reloaded.length > 0) {
      console.log(`[deploy] Reloaded: ${result.reloaded.join(', ')}`);
    }
    if (result.deleted.length > 0) {
      console.log(`[deploy] Deleted: ${result.deleted.join(', ')}`);
    }
  }

  private cleanupOldReleases(releasesDir: string, keep: number, preserveDir: null | string): void {
    try {
      const entries = readdirSync(releasesDir)
        .filter((e) => statSync(join(releasesDir, e)).isDirectory())
        .sort((a, b) => {
          // Sort by directory mtime descending (newest first)
          const mtimeA = statSync(join(releasesDir, a)).mtimeMs;
          const mtimeB = statSync(join(releasesDir, b)).mtimeMs;
          return mtimeB - mtimeA;
        });

      for (const entry of entries.slice(keep)) {
        const dir = join(releasesDir, entry);
        // Never delete the previous release — it's the rollback target
        if (preserveDir && dir === preserveDir) continue;
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
