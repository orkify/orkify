import chalk from 'chalk';
import { Command } from 'commander';
import { resolve } from 'node:path';
import { PRIVATE_SOURCEMAP_DIR, stashNextSourceMaps } from '../../deploy/sourcemaps.js';

export const sourcemapsCommand = new Command('sourcemaps')
  .description(
    'Move Next.js browser source maps off the public /_next/static path (run after next build; `orkify deploy` does this automatically)'
  )
  .argument('[dir]', 'Next.js app directory', '.')
  .action((dir: string) => {
    const root = resolve(dir);
    try {
      const moved = stashNextSourceMaps(root);
      if (moved === 0) {
        console.log(chalk.gray('No source maps found under .next/static'));
      } else {
        console.log(chalk.green(`✓ Moved ${moved} source map(s) to ${PRIVATE_SOURCEMAP_DIR}`));
      }
    } catch (err) {
      console.error(chalk.red(`✗ Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });
