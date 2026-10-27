import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/** Per-release directory holding source maps taken off the public path. */
export const PRIVATE_SOURCEMAP_DIR = join('.orkify', 'sourcemaps');

/**
 * Next.js serves everything under `.next/static` publicly at `/_next/static/`.
 * With `productionBrowserSourceMaps: true` that includes the `.map` files —
 * i.e. the app's original source. Move them into `<release>/.orkify/sourcemaps/`
 * (path kept relative to `static/`) where only the daemon's resolver reads them.
 * The `sourceMappingURL` comments stay and simply 404 in the browser.
 *
 * Covers both `.next/static` and the standalone copy that is actually served.
 * Returns the number of maps moved.
 */
export function stashNextSourceMaps(releaseDir: string): number {
  const dest = join(releaseDir, PRIVATE_SOURCEMAP_DIR);
  let moved = 0;

  for (const staticDir of [
    join(releaseDir, '.next', 'static'),
    join(releaseDir, '.next', 'standalone', '.next', 'static'),
  ]) {
    if (!existsSync(staticDir)) continue;
    for (const file of walkMaps(staticDir)) {
      const target = join(dest, relative(staticDir, file));
      if (existsSync(target)) {
        // Same map from the other static copy — already stashed.
        rmSync(file);
      } else {
        mkdirSync(dirname(target), { recursive: true });
        renameSync(file, target);
      }
      moved++;
    }
  }
  return moved;
}

function* walkMaps(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkMaps(full);
    else if (entry.isFile() && entry.name.endsWith('.map')) yield full;
  }
}
