import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PRIVATE_SOURCEMAP_DIR, stashNextSourceMaps } from '../../src/deploy/sourcemaps.js';
import { resolveSourceMaps } from '../../src/probe/resolve-sourcemaps.js';

// Generated line 1, col 0 → src/app/page.tsx line 5, col 4
const MAP = JSON.stringify({
  version: 3,
  file: 'page.js',
  sources: ['src/app/page.tsx'],
  sourcesContent: [['a', 'b', 'c', 'd', '    throw new Error("x");', 'f'].join('\n')],
  mappings: 'AAII',
});
const CHUNK = 'throw new Error("x");\n//# sourceMappingURL=page.js.map';

let release: string;
const write = (rel: string, content: string) => {
  const p = join(release, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
};

/** A built standalone Next release, as the deploy's build step leaves it. */
function buildRelease() {
  for (const root of ['.next/static', '.next/standalone/.next/static']) {
    write(`${root}/chunks/app/page.js`, CHUNK);
    write(`${root}/chunks/app/page.js.map`, MAP);
    write(`${root}/css/main.css`, 'body{}');
    write(`${root}/css/main.css.map`, '{}');
  }
}

describe('stashNextSourceMaps', () => {
  beforeEach(() => {
    release = mkdtempSync(join(tmpdir(), 'orkify-release-'));
    buildRelease();
  });

  it('removes every .map from both public static dirs', () => {
    stashNextSourceMaps(release);
    for (const root of ['.next/static', '.next/standalone/.next/static']) {
      expect(existsSync(join(release, root, 'chunks/app/page.js.map'))).toBe(false);
      expect(existsSync(join(release, root, 'css/main.css.map'))).toBe(false);
      // Served assets are untouched.
      expect(readFileSync(join(release, root, 'chunks/app/page.js'), 'utf8')).toBe(CHUNK);
      expect(existsSync(join(release, root, 'css/main.css'))).toBe(true);
    }
  });

  it('keeps them privately in the release, path relative to static/', () => {
    const moved = stashNextSourceMaps(release);
    expect(moved).toBe(4);
    const priv = join(release, PRIVATE_SOURCEMAP_DIR);
    expect(readFileSync(join(priv, 'chunks/app/page.js.map'), 'utf8')).toBe(MAP);
    expect(existsSync(join(priv, 'css/main.css.map'))).toBe(true);
  });

  it('is a no-op without .next/static or maps (idempotent)', () => {
    stashNextSourceMaps(release);
    expect(stashNextSourceMaps(release)).toBe(0);
    expect(stashNextSourceMaps(mkdtempSync(join(tmpdir(), 'orkify-empty-')))).toBe(0);
  });
});

describe('resolving browser frames from stashed maps', () => {
  beforeEach(() => {
    release = mkdtempSync(join(tmpdir(), 'orkify-release-'));
    buildRelease();
    stashNextSourceMaps(release);
  });

  it.each([
    ['standalone server', '.next/standalone/.next/static/chunks/app/page.js'],
    ['plain next start', '.next/static/chunks/app/page.js'],
  ])('resolves a %s frame via .orkify/sourcemaps', (_label, rel) => {
    const frame = { file: join(release, rel), line: 1, column: 0, pre: [], target: '', post: [] };
    const r = resolveSourceMaps([frame], { file: frame.file, line: 1, column: 0 });

    expect(r.resolved).toBe(true);
    expect(r.topFrame?.file).toMatch(/src[/\\]app[/\\]page\.tsx$/);
    expect(r.topFrame?.line).toBe(5);
    expect(r.sourceContext?.[0].target).toContain('throw new Error');
  });
});
