import { createReadStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { extract } from 'tar-stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundleFileDeps } from '../../src/deploy/tarball.js';

// Mock ORKIFY_HOME so createTarball writes to a temp dir
let tempDir: string;
let orkifyHome: string;

vi.mock('../../src/constants.js', () => ({
  get ORKIFY_HOME() {
    return orkifyHome;
  },
}));

/** Extract all entries from a tar.gz file into a map of path → content. */
async function extractTarball(tarPath: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  const ex = extract();

  ex.on('entry', (header, stream, next) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      entries.set(header.name, Buffer.concat(chunks).toString('utf-8'));
      next();
    });
    stream.resume();
  });

  await pipeline(createReadStream(tarPath), createGunzip(), ex);
  return entries;
}

describe('tarball', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-tarball-test-'));
    orkifyHome = join(tempDir, '.orkify');
    mkdirSync(orkifyHome, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('bundleFileDeps', () => {
    it('returns null when no package.json exists', () => {
      const projectDir = join(tempDir, 'no-pkg');
      mkdirSync(projectDir);
      expect(bundleFileDeps(projectDir)).toBeNull();
    });

    it('returns null when no file: deps exist', () => {
      const projectDir = join(tempDir, 'no-file-deps');
      mkdirSync(projectDir);
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({ dependencies: { express: '^4.0.0' } })
      );
      expect(bundleFileDeps(projectDir)).toBeNull();
    });

    it('collects file: deps and rewrites package.json', () => {
      // Create the file: dep
      const depDir = join(tempDir, 'my-lib');
      mkdirSync(depDir);
      writeFileSync(join(depDir, 'package.json'), JSON.stringify({ name: 'my-lib' }));
      writeFileSync(join(depDir, 'index.js'), 'module.exports = {}');

      // Create the project
      const projectDir = join(tempDir, 'project');
      mkdirSync(projectDir);
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({
          dependencies: { 'my-lib': `file:${depDir}` },
        })
      );

      const result = bundleFileDeps(projectDir);
      expect(result).not.toBeNull();
      if (!result) return;

      // Package.json should be rewritten
      const rewritten = JSON.parse(result.rewrittenPkg);
      expect(rewritten.dependencies['my-lib']).toBe('file:.file-deps/my-lib');

      // Files should be collected
      expect(result.fileDeps.has('my-lib')).toBe(true);
      const dep = result.fileDeps.get('my-lib');
      expect(dep).toBeDefined();
      if (!dep) return;
      expect(dep.files.length).toBeGreaterThanOrEqual(2);
      expect(dep.files.some((f) => f.endsWith('index.js'))).toBe(true);
      expect(dep.files.some((f) => f.endsWith('package.json'))).toBe(true);
    });

    it('handles file: deps in both dependencies and devDependencies', () => {
      const depA = join(tempDir, 'dep-a');
      mkdirSync(depA);
      writeFileSync(join(depA, 'a.js'), 'a');

      const depB = join(tempDir, 'dep-b');
      mkdirSync(depB);
      writeFileSync(join(depB, 'b.js'), 'b');

      const projectDir = join(tempDir, 'project');
      mkdirSync(projectDir);
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({
          dependencies: { 'dep-a': `file:${depA}` },
          devDependencies: { 'dep-b': `file:${depB}` },
        })
      );

      const result = bundleFileDeps(projectDir);
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.fileDeps.size).toBe(2);

      const rewritten = JSON.parse(result.rewrittenPkg);
      expect(rewritten.dependencies['dep-a']).toBe('file:.file-deps/dep-a');
      expect(rewritten.devDependencies['dep-b']).toBe('file:.file-deps/dep-b');
    });

    it('excludes node_modules from file: deps', () => {
      const depDir = join(tempDir, 'with-nm');
      mkdirSync(depDir);
      writeFileSync(join(depDir, 'index.js'), 'x');
      mkdirSync(join(depDir, 'node_modules', 'foo'), { recursive: true });
      writeFileSync(join(depDir, 'node_modules', 'foo', 'bar.js'), 'should be excluded');

      const projectDir = join(tempDir, 'project');
      mkdirSync(projectDir);
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({ dependencies: { 'with-nm': `file:${depDir}` } })
      );

      const result = bundleFileDeps(projectDir);
      expect(result).not.toBeNull();
      if (!result) return;
      const dep = result.fileDeps.get('with-nm');
      expect(dep).toBeDefined();
      if (!dep) return;
      expect(dep.files.some((f) => f.includes('node_modules'))).toBe(false);
    });

    it('throws when file: dep path does not exist', () => {
      const projectDir = join(tempDir, 'project');
      mkdirSync(projectDir);
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({ dependencies: { ghost: 'file:../does-not-exist' } })
      );

      expect(() => bundleFileDeps(projectDir)).toThrow('does not exist');
    });

    it('preserves non-file: deps unchanged', () => {
      const depDir = join(tempDir, 'my-lib');
      mkdirSync(depDir);
      writeFileSync(join(depDir, 'index.js'), 'x');

      const projectDir = join(tempDir, 'project');
      mkdirSync(projectDir);
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({
          dependencies: {
            express: '^4.0.0',
            'my-lib': `file:${depDir}`,
          },
        })
      );

      const result = bundleFileDeps(projectDir);
      expect(result).toBeDefined();
      if (!result) return;
      const rewritten = JSON.parse(result.rewrittenPkg);
      expect(rewritten.dependencies.express).toBe('^4.0.0');
    });
  });

  describe('createTarball', () => {
    it('bundles file: deps into .file-deps/ and rewrites package.json', async () => {
      // Dynamic import to ensure mock is applied
      const { createTarball } = await import('../../src/deploy/tarball.js');

      // Create file: dep
      const depDir = join(tempDir, 'orkify');
      mkdirSync(depDir);
      writeFileSync(join(depDir, 'package.json'), JSON.stringify({ name: 'orkify' }));
      mkdirSync(join(depDir, 'dist'), { recursive: true });
      writeFileSync(join(depDir, 'dist', 'index.js'), 'export const cache = {}');

      // Create project
      const projectDir = join(tempDir, 'myapp');
      mkdirSync(projectDir);
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({
          name: 'myapp',
          dependencies: { orkify: `file:${depDir}` },
        })
      );
      writeFileSync(join(projectDir, 'server.js'), 'console.log("hi")');

      const tarPath = await createTarball(projectDir);
      const entries = await extractTarball(tarPath);

      // Project files should be present
      expect(entries.has('server.js')).toBe(true);

      // package.json should be rewritten
      expect(entries.has('package.json')).toBe(true);
      const pkg = JSON.parse(entries.get('package.json') ?? '{}');
      expect(pkg.dependencies.orkify).toBe('file:.file-deps/orkify');

      // File dep contents should be under .file-deps/
      expect(entries.has('.file-deps/orkify/package.json')).toBe(true);
      expect(entries.has('.file-deps/orkify/dist/index.js')).toBe(true);
    });

    it('leaves package.json unchanged when no file: deps', async () => {
      const { createTarball } = await import('../../src/deploy/tarball.js');

      const projectDir = join(tempDir, 'plain');
      mkdirSync(projectDir);
      const originalPkg = JSON.stringify({ name: 'plain', dependencies: { express: '^4.0.0' } });
      writeFileSync(join(projectDir, 'package.json'), originalPkg);
      writeFileSync(join(projectDir, 'index.js'), 'x');

      const tarPath = await createTarball(projectDir);
      const entries = await extractTarball(tarPath);

      // package.json should be the original content
      expect(entries.has('package.json')).toBe(true);
      const pkg = JSON.parse(entries.get('package.json') ?? '{}');
      expect(pkg.dependencies.express).toBe('^4.0.0');

      // No .file-deps/ directory
      const fileDepsEntries = [...entries.keys()].filter((k) => k.startsWith('.file-deps/'));
      expect(fileDepsEntries).toHaveLength(0);
    });
  });
});
