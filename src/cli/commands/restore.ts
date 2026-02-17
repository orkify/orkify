import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import {
  IPCMessageType,
  ORKIFY_DEPLOYS_DIR,
  DEPLOY_META_FILE,
  TELEMETRY_DEFAULT_API_HOST,
} from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';
import type { DeployRestorePayload, ProcessInfo, RestorePayload } from '../../types/index.js';

export const restoreCommand = new Command('restore')
  .description('Restore previously saved process list')
  .argument('[file]', 'Path to snapshot file (default: ~/.orkify/snapshot.yml)')
  .option('--no-remote', 'Skip remote deploy restore and force local snapshot restore')
  .action(async (file: string | undefined, opts: { remote: boolean }) => {
    try {
      // Deploy-aware restore: check for API key + deploy metadata
      if (opts.remote) {
        const apiKey = process.env.ORKIFY_API_KEY;
        const metaPath = join(ORKIFY_DEPLOYS_DIR, 'current', DEPLOY_META_FILE);

        if (apiKey && existsSync(metaPath)) {
          try {
            const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as {
              version: number;
              artifactId: string;
            };
            const apiHost = process.env.ORKIFY_API_HOST || TELEMETRY_DEFAULT_API_HOST;
            const url = `${apiHost}/api/v1/deploy/restore?artifactId=${encodeURIComponent(meta.artifactId)}`;

            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${apiKey}` },
            });

            if (!res.ok) {
              console.error(
                chalk.yellow(`⚠ Remote restore failed (${res.status}), falling back to snapshot`)
              );
            } else {
              const payload = (await res.json()) as DeployRestorePayload;
              const response = await daemonClient.request(IPCMessageType.DEPLOY_RESTORE, payload);

              if (response.success) {
                const data = response.data as
                  | { deployed: boolean; version: number }
                  | { started: string[]; reloaded: string[]; deleted: string[] };

                if ('deployed' in data) {
                  console.log(chalk.green(`✓ Deployed version ${data.version} from remote`));
                } else {
                  const count = data.started.length + data.reloaded.length;
                  if (count === 0) {
                    console.log(chalk.gray('No processes to restore'));
                  } else {
                    console.log(chalk.green(`✓ Restored from local deploy:`));
                    for (const name of data.started) {
                      console.log(`  - ${name} (started)`);
                    }
                    for (const name of data.reloaded) {
                      console.log(`  - ${name} (reloaded)`);
                    }
                  }
                }
                return;
              }
              console.error(
                chalk.yellow(`⚠ Deploy restore failed: ${response.error}, falling back to snapshot`)
              );
            }
          } catch (err) {
            console.error(
              chalk.yellow(
                `⚠ Deploy restore error: ${(err as Error).message}, falling back to snapshot`
              )
            );
          }
        }
      }

      // Snapshot restore (default / fallback)
      const payload: RestorePayload = { file };
      const response = await daemonClient.request(IPCMessageType.RESTORE, payload);

      if (response.success) {
        const results = response.data as ProcessInfo[];

        if (results.length === 0) {
          console.log(chalk.gray('No processes to restore'));
          return;
        }

        console.log(chalk.green(`✓ Restored ${results.length} process(es):`));
        for (const info of results) {
          console.log(`  - ${info.name} (${info.workers.length} worker(s))`);
        }
      } else {
        console.error(chalk.red(`✗ Failed to restore: ${response.error}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    } finally {
      daemonClient.disconnect();
    }
  });
