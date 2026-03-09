import ig, { type Ignore } from 'ignore';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { pack } from 'tar-stream';
import { ORKIFY_HOME } from '../constants.js';

// Always exclude these patterns
const ALWAYS_EXCLUDE = [
  'node_modules',
  '.git',
  '.gitignore',
  '.env',
  '.env.local',
  '.env.production',
  '.env.staging',
  '.orkify',
];

interface IgnoreFilter {
  dir: string;
  ig: Ignore;
}

/** Walk up from startDir looking for a .git directory. */
function findGitRoot(startDir: string): null | string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Parse a .gitignore file into an array of patterns. */
function readGitignorePatterns(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * Collect .gitignore filters from ancestor directories (gitRoot up to,
 * but not including, projectDir). The projectDir's own .gitignore is
 * handled during the walk so it isn't double-loaded.
 */
function collectAncestorFilters(projectDir: string): IgnoreFilter[] {
  const filters: IgnoreFilter[] = [];
  const gitRoot = findGitRoot(projectDir);
  if (!gitRoot) return filters;

  const relPath = relative(gitRoot, projectDir);
  if (!relPath) return filters; // projectDir IS the git root

  const parts = relPath.split(sep);
  let current = gitRoot;

  // Git root .gitignore
  const rootPatterns = readGitignorePatterns(join(current, '.gitignore'));
  if (rootPatterns.length > 0) {
    filters.push({ dir: current, ig: ig().add(rootPatterns) });
  }

  // Intermediate directories (not including projectDir itself)
  for (let i = 0; i < parts.length - 1; i++) {
    current = join(current, parts[i]);
    const patterns = readGitignorePatterns(join(current, '.gitignore'));
    if (patterns.length > 0) {
      filters.push({ dir: current, ig: ig().add(patterns) });
    }
  }

  return filters;
}

/** Check whether absPath is ignored by any of the gitignore filters. */
function isIgnoredByFilters(absPath: string, isDir: boolean, filters: IgnoreFilter[]): boolean {
  for (const filter of filters) {
    const rel = relative(filter.dir, absPath);
    if (rel.startsWith('..') || rel === '') continue;
    const normalized = rel.split(sep).join('/') + (isDir ? '/' : '');
    if (filter.ig.ignores(normalized)) return true;
  }
  return false;
}

/**
 * Recursively walk a directory, collecting file paths while respecting
 * .gitignore files found along the way and the built-in exclude list.
 */
function walkDirectory(
  dir: string,
  projectDir: string,
  parentFilters: IgnoreFilter[],
  builtinIgnore: Ignore
): string[] {
  const files: string[] = [];

  // Load .gitignore from this directory (if any)
  const patterns = readGitignorePatterns(join(dir, '.gitignore'));
  const filters =
    patterns.length > 0 ? [...parentFilters, { dir, ig: ig().add(patterns) }] : parentFilters;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absPath = join(dir, entry.name);
    const relToProject = relative(projectDir, absPath).split(sep).join('/');
    const isDir = entry.isDirectory();

    // Check built-in excludes
    if (builtinIgnore.ignores(relToProject + (isDir ? '/' : ''))) continue;

    // Check gitignore filters
    if (isIgnoredByFilters(absPath, isDir, filters)) continue;

    if (isDir) {
      files.push(...walkDirectory(absPath, projectDir, filters, builtinIgnore));
    } else if (entry.isFile()) {
      files.push(absPath);
    }
  }

  return files;
}

interface FileDep {
  dir: string;
  files: string[];
}

/**
 * Scan package.json for `file:` dependencies. For each one, walk the
 * referenced directory and collect its files. Returns a rewritten
 * package.json string with paths pointing to `.file-deps/<name>/` and
 * a map of the collected files — or null if there are no file deps.
 */
export function bundleFileDeps(
  projectDir: string
): null | { rewrittenPkg: string; fileDeps: Map<string, FileDep> } {
  const pkgPath = join(projectDir, 'package.json');
  if (!existsSync(pkgPath)) return null;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const fileDeps = new Map<string, FileDep>();

  for (const section of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[section] as Record<string, string> | undefined;
    if (!deps) continue;

    for (const [name, spec] of Object.entries(deps)) {
      if (!spec.startsWith('file:')) continue;

      const depDir = resolve(projectDir, spec.slice(5));
      if (!existsSync(depDir)) {
        throw new Error(`file: dependency "${name}" points to "${depDir}" which does not exist`);
      }

      const ancestorFilters = collectAncestorFilters(depDir);
      const builtinIgnore = ig().add(ALWAYS_EXCLUDE);
      const files = walkDirectory(depDir, depDir, ancestorFilters, builtinIgnore);

      deps[name] = `file:.file-deps/${name}`;
      fileDeps.set(name, { dir: depDir, files });
    }
  }

  if (fileDeps.size === 0) return null;
  return { rewrittenPkg: JSON.stringify(pkg, null, 2) + '\n', fileDeps };
}

/**
 * Create a tar.gz archive of the project directory.
 *
 * Walks the directory tree, respecting .gitignore files from the git root
 * all the way down into the project, plus a built-in exclude list
 * (node_modules, .git, .env, etc.).
 *
 * Any `file:` dependencies in package.json are bundled into the tarball
 * under `.file-deps/<name>/` and the paths are rewritten so `npm ci`
 * can resolve them on the deploy target.
 */
export interface TarballOptions {
  excludeSourceMaps?: boolean;
}

export async function createTarball(projectDir: string, options?: TarballOptions): Promise<string> {
  const artifactsDir = join(ORKIFY_HOME, 'tmp');
  if (!existsSync(artifactsDir)) {
    mkdirSync(artifactsDir, { recursive: true });
  }

  const tarPath = join(artifactsDir, `deploy-${Date.now()}.tar.gz`);
  const ancestorFilters = collectAncestorFilters(projectDir);
  const excludes = options?.excludeSourceMaps ? [...ALWAYS_EXCLUDE, '*.map'] : ALWAYS_EXCLUDE;
  const builtinIgnore = ig().add(excludes);
  const files = walkDirectory(projectDir, projectDir, ancestorFilters, builtinIgnore);

  // Check for file: deps to bundle
  const bundle = bundleFileDeps(projectDir);

  const p = pack();
  const gzip = createGzip();
  const output = createWriteStream(tarPath);

  const done = pipeline(p, gzip, output);

  for (const file of files) {
    const rel = relative(projectDir, file).split(sep).join('/');

    // Skip package.json if we need to rewrite it
    if (bundle && rel === 'package.json') continue;

    const stat = statSync(file);
    p.entry({ name: rel, size: stat.size, mode: stat.mode, mtime: stat.mtime }, readFileSync(file));
  }

  if (bundle) {
    // Add rewritten package.json
    const content = Buffer.from(bundle.rewrittenPkg);
    p.entry({ name: 'package.json', size: content.length }, content);

    // Add bundled file: dep contents
    for (const [name, dep] of bundle.fileDeps) {
      for (const file of dep.files) {
        const rel = relative(dep.dir, file).split(sep).join('/');
        const stat = statSync(file);
        p.entry(
          {
            name: `.file-deps/${name}/${rel}`,
            size: stat.size,
            mode: stat.mode,
            mtime: stat.mtime,
          },
          readFileSync(file)
        );
      }
    }
  }

  p.finalize();
  await done;

  return tarPath;
}
