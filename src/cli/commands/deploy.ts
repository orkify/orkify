import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { IPCMessageType, ORKIFY_CONFIG_FILE, TELEMETRY_DEFAULT_API_HOST } from '../../constants.js';
import {
  collectGitMetadata,
  getOrkifyConfig,
  interactiveConfig,
  readPackageJson,
  saveOrkifyConfig,
} from '../../deploy/config.js';
import { parseEnvFile } from '../../deploy/env.js';
import { createTarball } from '../../deploy/tarball.js';
import { daemonClient } from '../../ipc/DaemonClient.js';
import type { DeployLocalPayload } from '../../types/index.js';

export const deployCommand = new Command('deploy').description('Deployment commands');

deployCommand
  .command('upload')
  .description('Upload a build artifact for deployment')
  .option('--project-dir <path>', 'Project directory', process.cwd())
  .option('--interactive', 'Force interactive config prompts')
  .option('--api-key <key>', 'API key (or ORKIFY_API_KEY env)')
  .option('--api-host <url>', 'API host (or ORKIFY_API_HOST env)')
  .option('--npm-version-patch', 'Increment patch version in package.json before uploading')
  .action(async (options) => {
    try {
      const projectDir = resolve(options.projectDir);
      const apiKey = options.apiKey || process.env.ORKIFY_API_KEY;
      const apiHost = options.apiHost || process.env.ORKIFY_API_HOST || TELEMETRY_DEFAULT_API_HOST;

      if (!apiKey) {
        console.error(chalk.red('✗ API key required. Set ORKIFY_API_KEY or use --api-key'));
        process.exit(1);
      }

      if (!existsSync(resolve(projectDir, 'package.json'))) {
        console.error(chalk.red('✗ No package.json found in ' + projectDir));
        process.exit(1);
      }

      // 1. Get or create orkify.yml config
      let config = getOrkifyConfig(projectDir);

      if (!config || !config.processes?.length || options.interactive) {
        config = await interactiveConfig(projectDir);
        saveOrkifyConfig(projectDir, config);
        console.log(chalk.green(`✓ Deploy config saved to ${ORKIFY_CONFIG_FILE}`));
      }

      if (!config.deploy) {
        console.error(
          chalk.red(`✗ No deploy section found in ${ORKIFY_CONFIG_FILE}. Run with --interactive`)
        );
        process.exit(1);
      }

      if (!config.processes?.length) {
        console.error(
          chalk.red(`✗ No processes defined in ${ORKIFY_CONFIG_FILE}. Run with --interactive`)
        );
        process.exit(1);
      }

      // 2. Bump patch version if requested
      if (options.npmVersionPatch) {
        const pkgPath = join(projectDir, 'package.json');
        const pkg = readPackageJson(projectDir);
        const current = (pkg.version as string) || '0.0.0';
        const parts = current.split('.').map(Number);
        parts[2] = (parts[2] ?? 0) + 1;
        pkg.version = parts.join('.');
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
        console.log(chalk.dim(`  version: ${current} → ${pkg.version}`));
      }

      // 3. Collect git metadata
      const gitMeta = collectGitMetadata(projectDir);
      if (gitMeta.gitSha) {
        console.log(
          chalk.dim(`  git: ${gitMeta.gitBranch ?? 'detached'} ${gitMeta.gitSha.slice(0, 7)}`)
        );
      }

      // 4. Create tarball
      console.log('Creating artifact...');
      const tarPath = await createTarball(projectDir);
      const tarStat = statSync(tarPath);
      const sizeStr = formatSize(tarStat.size);
      console.log(chalk.dim(`  ${sizeStr}`));

      // 5. Compute SHA-256
      const sha256 = await computeSha256(tarPath);

      // 6. Request upload URL
      console.log('Uploading...');
      const pkg = readPackageJson(projectDir);
      const uploadResp = await fetch(`${apiHost}/api/v1/deploy/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          sha256,
          sizeBytes: tarStat.size,
          filename: `${(pkg.name as string) || 'artifact'}.tar.gz`,
          gitSha: gitMeta.gitSha,
          gitBranch: gitMeta.gitBranch,
          gitAuthor: gitMeta.gitAuthor,
          gitMessage: gitMeta.gitMessage,
          deployConfig: config.deploy,
        }),
      });

      if (!uploadResp.ok) {
        const body = await uploadResp.text();
        console.error(chalk.red(`✗ Upload request failed: ${uploadResp.status} ${body}`));
        process.exit(1);
      }

      const { artifactId, uploadUrl, version } = (await uploadResp.json()) as {
        artifactId: string;
        uploadUrl: string;
        version: number;
      };

      // 7. Upload tarball to pre-signed URL
      const tarBuffer = readFileSync(tarPath);
      const putResp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Length': String(tarStat.size),
        },
        body: tarBuffer,
      });

      if (!putResp.ok) {
        console.error(chalk.red(`✗ S3 upload failed: ${putResp.status}`));
        process.exit(1);
      }

      // 8. Confirm upload
      const confirmResp = await fetch(`${apiHost}/api/v1/deploy/upload/${artifactId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!confirmResp.ok) {
        const body = await confirmResp.text();
        console.error(chalk.red(`✗ Upload confirmation failed: ${body}`));
        process.exit(1);
      }

      // 9. Clean up tarball
      unlinkSync(tarPath);

      console.log(
        chalk.green(`✓ Artifact v${version} uploaded (${sizeStr}, ${sha256.slice(0, 12)}...)`)
      );
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

deployCommand
  .command('pack [dir]')
  .description('Create a deploy tarball without uploading')
  .option('--output <path>', 'Output tarball path')
  .action(async (dir: string | undefined, options: { output?: string }) => {
    try {
      const projectDir = resolve(dir ?? process.cwd());

      if (!existsSync(join(projectDir, ORKIFY_CONFIG_FILE))) {
        console.error(
          chalk.red(
            `✗ ${ORKIFY_CONFIG_FILE} not found. Create one manually or run orkify deploy upload --interactive.`
          )
        );
        process.exit(1);
      }

      console.log('Creating artifact...');
      const tarPath = await createTarball(projectDir);

      let finalPath = tarPath;
      if (options.output) {
        finalPath = resolve(options.output);
        renameSync(tarPath, finalPath);
      }

      const tarStat = statSync(finalPath);
      const sha256 = await computeSha256(finalPath);

      console.log(
        chalk.green(
          `✓ Created: ${finalPath} (${formatSize(tarStat.size)}, sha256: ${sha256.slice(0, 12)}...)`
        )
      );
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

deployCommand
  .command('local <tarball>')
  .description('Deploy from a local tarball')
  .option('--env-file <path>', 'Load env vars from file')
  .action(async (tarball: string, options: { envFile?: string }) => {
    try {
      const tarballPath = resolve(tarball);

      if (!existsSync(tarballPath)) {
        console.error(chalk.red(`✗ Tarball not found: ${tarballPath}`));
        process.exit(1);
      }

      // Extract orkify.yml from tarball to read deploy config
      const tmpDir = mkdtempSync(join(tmpdir(), 'orkify-local-'));
      try {
        execSync(`tar xzf "${tarballPath}" -C "${tmpDir}" ${ORKIFY_CONFIG_FILE}`, {
          stdio: 'pipe',
        });
      } catch {
        rmSync(tmpDir, { recursive: true, force: true });
        console.error(
          chalk.red(`✗ Tarball is not a valid orkify package: ${ORKIFY_CONFIG_FILE} not found`)
        );
        process.exit(1);
      }

      const config = getOrkifyConfig(tmpDir);
      rmSync(tmpDir, { recursive: true, force: true });

      if (!config?.deploy) {
        console.error(chalk.red(`✗ No deploy section found in ${ORKIFY_CONFIG_FILE}`));
        process.exit(1);
      }

      // Parse env file if provided
      let env: Record<string, string> | undefined;
      if (options.envFile) {
        const envPath = resolve(options.envFile);
        if (!existsSync(envPath)) {
          console.error(chalk.red(`✗ Env file not found: ${envPath}`));
          process.exit(1);
        }
        env = parseEnvFile(readFileSync(envPath, 'utf-8'));
      }

      console.log(`Deploying ${tarballPath}...`);

      const payload: DeployLocalPayload = {
        tarballPath,
        deployConfig: config.deploy,
        env,
      };

      const response = await daemonClient.request(IPCMessageType.DEPLOY_LOCAL, payload as never);

      if (response.success) {
        console.log(chalk.green('✓ Deploy complete'));
      } else {
        console.error(chalk.red(`✗ Deploy failed: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

async function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
