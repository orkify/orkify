import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest';
import type { SourceContextFrame } from '../../src/types/index.js';
import { resolveSourceMaps } from '../../src/probe/resolve-sourcemaps.js';

// ---------------------------------------------------------------------------
// Test fixtures — a minimal bundled file + source map
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(tmpdir(), 'orkify-sourcemap-test-' + process.pid);
const BUNDLE_FILE = join(FIXTURE_DIR, 'bundle.js');
const MAP_FILE = join(FIXTURE_DIR, 'bundle.js.map');
const ORIGINAL_FILE = join(FIXTURE_DIR, 'src', 'app.ts');
const BUNDLE_NO_COMMENT = join(FIXTURE_DIR, 'no-comment.js');
const BUNDLE_NO_COMMENT_MAP = join(FIXTURE_DIR, 'no-comment.js.map');
const BUNDLE_INLINE = join(FIXTURE_DIR, 'inline.js');
const BUNDLE_WEBPACK = join(FIXTURE_DIR, 'webpack-bundle.js');
const BUNDLE_WEBPACK_MAP = join(FIXTURE_DIR, 'webpack-bundle.js.map');
const BUNDLE_VITE = join(FIXTURE_DIR, 'vite-bundle.js');
const BUNDLE_VITE_MAP = join(FIXTURE_DIR, 'vite-bundle.js.map');

// Minimal source map (v3) mapping line 1, column 0 of bundle.js → line 5, column 4 of src/app.ts
// Generated to represent: original file "src/app.ts", line 5, column 4
const SOURCE_MAP = {
  version: 3,
  file: 'bundle.js',
  sources: ['src/app.ts'],
  sourcesContent: [
    [
      '// App entry point',
      'import { serve } from "./server";',
      '',
      'function main() {',
      '    throw new Error("test error");',
      '}',
      '',
      'main();',
    ].join('\n'),
  ],
  // The mappings encode: generated line 1, col 0 → source 0, original line 5, col 4
  mappings: 'AAII',
};

// Source map without sourcesContent — relies on disk reads
const SOURCE_MAP_NO_CONTENT = {
  version: 3,
  file: 'no-comment.js',
  sources: ['src/app.ts'],
  mappings: 'AAII',
};

// Source map with webpack:/// protocol prefix in sources
const SOURCE_MAP_WEBPACK = {
  version: 3,
  file: 'webpack-bundle.js',
  sources: ['webpack:///src/app.ts'],
  sourcesContent: [SOURCE_MAP.sourcesContent[0]],
  mappings: 'AAII',
};

// Source map with vite-node:// protocol prefix in sources
const SOURCE_MAP_VITE = {
  version: 3,
  file: 'vite-bundle.js',
  sources: ['vite-node:///src/app.ts'],
  sourcesContent: [SOURCE_MAP.sourcesContent[0]],
  mappings: 'AAII',
};

const ORIGINAL_SOURCE = [
  '// App entry point',
  'import { serve } from "./server";',
  '',
  'function main() {',
  '    throw new Error("test error");',
  '}',
  '',
  'main();',
].join('\n');

const BUNDLE_CONTENT =
  'var a=function(){throw new Error("test error")};a();\n//# sourceMappingURL=bundle.js.map';
const BUNDLE_NO_COMMENT_CONTENT = 'var a=function(){throw new Error("test error")};a();';

// Inline source map: base64-encode the source map JSON into a data: URL
const INLINE_MAP_JSON = JSON.stringify(SOURCE_MAP);
const INLINE_MAP_B64 = Buffer.from(INLINE_MAP_JSON).toString('base64');
const BUNDLE_INLINE_CONTENT = `var a=function(){throw new Error("test error")};a();\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${INLINE_MAP_B64}`;

const BUNDLE_WEBPACK_CONTENT =
  'var a=function(){throw new Error("test error")};a();\n//# sourceMappingURL=webpack-bundle.js.map';
const BUNDLE_VITE_CONTENT =
  'var a=function(){throw new Error("test error")};a();\n//# sourceMappingURL=vite-bundle.js.map';

function makeFrame(
  file: string,
  line: number,
  column: number,
  pre: string[] = [],
  target: string = '',
  post: string[] = []
): SourceContextFrame {
  return { file, line, column, pre, target, post };
}

beforeAll(() => {
  mkdirSync(join(FIXTURE_DIR, 'src'), { recursive: true });
  writeFileSync(BUNDLE_FILE, BUNDLE_CONTENT);
  writeFileSync(MAP_FILE, JSON.stringify(SOURCE_MAP));
  writeFileSync(ORIGINAL_FILE, ORIGINAL_SOURCE);
  writeFileSync(BUNDLE_NO_COMMENT, BUNDLE_NO_COMMENT_CONTENT);
  writeFileSync(BUNDLE_NO_COMMENT_MAP, JSON.stringify(SOURCE_MAP_NO_CONTENT));
  writeFileSync(BUNDLE_INLINE, BUNDLE_INLINE_CONTENT);
  writeFileSync(BUNDLE_WEBPACK, BUNDLE_WEBPACK_CONTENT);
  writeFileSync(BUNDLE_WEBPACK_MAP, JSON.stringify(SOURCE_MAP_WEBPACK));
  writeFileSync(BUNDLE_VITE, BUNDLE_VITE_CONTENT);
  writeFileSync(BUNDLE_VITE_MAP, JSON.stringify(SOURCE_MAP_VITE));
});

afterAll(() => {
  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
});

describe('resolveSourceMaps', () => {
  // -----------------------------------------------------------------------
  // No-op cases
  // -----------------------------------------------------------------------
  describe('no-op cases', () => {
    it('returns original data when sourceContext is null', () => {
      const result = resolveSourceMaps(null, null);
      expect(result.resolved).toBe(false);
      expect(result.resolvedFunctionName).toBeNull();
      expect(result.sourceContext).toBeNull();
    });

    it('returns original data when sourceContext is empty', () => {
      const result = resolveSourceMaps([], null);
      expect(result.resolved).toBe(false);
      expect(result.resolvedFunctionName).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Source map resolution via sourceMappingURL comment
  // -----------------------------------------------------------------------
  describe('resolution via sourceMappingURL', () => {
    it('resolves a frame using the sourceMappingURL comment', () => {
      const frames = [makeFrame(BUNDLE_FILE, 1, 1, [], BUNDLE_CONTENT.split('\n')[0], [])];
      const result = resolveSourceMaps(frames, { file: BUNDLE_FILE, line: 1, column: 1 });

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      expect(result.sourceContext).toHaveLength(1);

      const frame = result.sourceContext[0];
      expect(frame.file).toContain('src/app.ts');
      expect(frame.line).toBe(5);
      expect(frame.target).toBe('    throw new Error("test error");');
    });

    it('updates topFrame to the resolved location', () => {
      const frames = [makeFrame(BUNDLE_FILE, 1, 1, [], BUNDLE_CONTENT.split('\n')[0], [])];
      const result = resolveSourceMaps(frames, { file: BUNDLE_FILE, line: 1, column: 1 });

      assert(result.topFrame);
      expect(result.topFrame.file).toContain('src/app.ts');
      expect(result.topFrame.line).toBe(5);
    });

    it('extracts correct pre/post context from original source', () => {
      const frames = [makeFrame(BUNDLE_FILE, 1, 1, [], BUNDLE_CONTENT.split('\n')[0], [])];
      const result = resolveSourceMaps(frames, null);

      assert(result.sourceContext);
      const frame = result.sourceContext[0];
      // Line 5 → pre should be lines 1-4, post should be lines 6-8
      expect(frame.pre).toEqual([
        '// App entry point',
        'import { serve } from "./server";',
        '',
        'function main() {',
      ]);
      expect(frame.post).toEqual(['}', '', 'main();']);
    });
  });

  // -----------------------------------------------------------------------
  // Fallback: <file>.map
  // -----------------------------------------------------------------------
  describe('fallback to <file>.map', () => {
    it('resolves when there is no sourceMappingURL but <file>.map exists', () => {
      const frames = [makeFrame(BUNDLE_NO_COMMENT, 1, 1, [], BUNDLE_NO_COMMENT_CONTENT, [])];
      const result = resolveSourceMaps(frames, null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      const frame = result.sourceContext[0];
      expect(frame.file).toContain('src/app.ts');
      expect(frame.line).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // sourcesContent usage
  // -----------------------------------------------------------------------
  describe('sourcesContent', () => {
    it('prefers sourcesContent over disk reads', () => {
      // The source map with sourcesContent should work even without the original file
      const frames = [makeFrame(BUNDLE_FILE, 1, 1, [], BUNDLE_CONTENT.split('\n')[0], [])];
      const result = resolveSourceMaps(frames, null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      expect(result.sourceContext[0].target).toBe('    throw new Error("test error");');
    });

    it('falls back to disk when sourcesContent is not available', () => {
      // BUNDLE_NO_COMMENT uses SOURCE_MAP_NO_CONTENT (no sourcesContent)
      // but the original file exists on disk
      const frames = [makeFrame(BUNDLE_NO_COMMENT, 1, 1, [], BUNDLE_NO_COMMENT_CONTENT, [])];
      const result = resolveSourceMaps(frames, null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      expect(result.sourceContext[0].target).toBe('    throw new Error("test error");');
    });
  });

  // -----------------------------------------------------------------------
  // Inline source maps (data: URLs)
  // -----------------------------------------------------------------------
  describe('inline source maps', () => {
    it('resolves frames from inline base64 source maps', () => {
      const frames = [makeFrame(BUNDLE_INLINE, 1, 1, [], BUNDLE_INLINE_CONTENT.split('\n')[0], [])];
      const result = resolveSourceMaps(frames, null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      const frame = result.sourceContext[0];
      expect(frame.file).toContain('src/app.ts');
      expect(frame.line).toBe(5);
      expect(frame.target).toBe('    throw new Error("test error");');
    });

    it('degrades gracefully for malformed inline source maps', () => {
      const badInline = join(FIXTURE_DIR, 'bad-inline.js');
      writeFileSync(
        badInline,
        'broken();\n//# sourceMappingURL=data:application/json;base64,bm90LWpzb24='
      );
      const frame = makeFrame(badInline, 1, 1, [], 'broken();', []);
      const result = resolveSourceMaps([frame], null);

      expect(result.resolved).toBe(false);
      assert(result.sourceContext);
      expect(result.sourceContext[0]).toEqual(frame);
    });

    it('degrades gracefully for non-base64 inline source maps', () => {
      const noBase64 = join(FIXTURE_DIR, 'no-base64.js');
      writeFileSync(
        noBase64,
        'broken();\n//# sourceMappingURL=data:application/json;charset=utf-8,{"version":3}'
      );
      const frame = makeFrame(noBase64, 1, 1, [], 'broken();', []);
      const result = resolveSourceMaps([frame], null);

      // No base64 marker → returns null → tries fallback <file>.map → not found → unresolved
      expect(result.resolved).toBe(false);
    });

    it('resolves large inline source maps that exceed the tail-read window', () => {
      // Create a bundle with enough padding that the sourceMappingURL comment
      // starts BEFORE the 512-byte tail window — this verifies the full-file
      // fallback for inline maps
      const largeInline = join(FIXTURE_DIR, 'large-inline.js');
      const padding = 'var x = ' + 'a'.repeat(2000) + ';\n';
      writeFileSync(
        largeInline,
        padding +
          `//# sourceMappingURL=data:application/json;charset=utf-8;base64,${INLINE_MAP_B64}`
      );

      const frames = [makeFrame(largeInline, 1, 1, [], 'minified', [])];
      const result = resolveSourceMaps(frames, null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      const frame = result.sourceContext[0];
      expect(frame.file).toContain('src/app.ts');
      expect(frame.line).toBe(5);
      expect(frame.target).toBe('    throw new Error("test error");');
    });
  });

  // -----------------------------------------------------------------------
  // Bundler protocol prefixes (webpack:///, vite-node://, etc.)
  // -----------------------------------------------------------------------
  describe('bundler protocol prefixes', () => {
    it('strips webpack:/// prefix from source paths', () => {
      const frames = [
        makeFrame(BUNDLE_WEBPACK, 1, 1, [], BUNDLE_WEBPACK_CONTENT.split('\n')[0], []),
      ];
      const result = resolveSourceMaps(frames, null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      const frame = result.sourceContext[0];
      // Should NOT contain webpack:/// in the resolved path
      expect(frame.file).not.toContain('webpack:');
      expect(frame.file).toContain('src/app.ts');
      expect(frame.line).toBe(5);
    });

    it('strips vite-node:// prefix from source paths', () => {
      const frames = [makeFrame(BUNDLE_VITE, 1, 1, [], BUNDLE_VITE_CONTENT.split('\n')[0], [])];
      const result = resolveSourceMaps(frames, null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      const frame = result.sourceContext[0];
      expect(frame.file).not.toContain('vite-node:');
      expect(frame.file).toContain('src/app.ts');
    });

    it('strips webpack-internal:/// prefix from source paths', () => {
      const internalMap = {
        ...SOURCE_MAP_WEBPACK,
        sources: ['webpack-internal:///./src/app.ts'],
        file: 'internal-bundle.js',
      };
      const bundleFile = join(FIXTURE_DIR, 'internal-bundle.js');
      const mapFile = join(FIXTURE_DIR, 'internal-bundle.js.map');
      writeFileSync(
        bundleFile,
        'var a=function(){throw new Error("test error")};a();\n//# sourceMappingURL=internal-bundle.js.map'
      );
      writeFileSync(mapFile, JSON.stringify(internalMap));

      const frames = [makeFrame(bundleFile, 1, 1, [], 'minified', [])];
      const result = resolveSourceMaps(frames, null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      expect(result.sourceContext[0].file).not.toContain('webpack-internal:');
    });

    it('strips webpack://[name]/ prefix from source paths', () => {
      const namedMap = {
        ...SOURCE_MAP_WEBPACK,
        sources: ['webpack://my-app/src/app.ts'],
        file: 'named-bundle.js',
      };
      const bundleFile = join(FIXTURE_DIR, 'named-bundle.js');
      const mapFile = join(FIXTURE_DIR, 'named-bundle.js.map');
      writeFileSync(
        bundleFile,
        'var a=function(){throw new Error("test error")};a();\n//# sourceMappingURL=named-bundle.js.map'
      );
      writeFileSync(mapFile, JSON.stringify(namedMap));

      const frames = [makeFrame(bundleFile, 1, 1, [], 'minified', [])];
      const result = resolveSourceMaps(frames, null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      expect(result.sourceContext[0].file).not.toContain('webpack:');
      expect(result.sourceContext[0].file).toContain('src/app.ts');
    });
  });

  // -----------------------------------------------------------------------
  // Next.js-style deep map directory (resolveDisplayPath)
  // -----------------------------------------------------------------------
  describe('Next.js-style deep map directory', () => {
    it('resolves display path via project root when map is deep inside .next/', () => {
      // Simulate Next.js structure:
      //   project/package.json
      //   project/src/app/page.ts          (original source)
      //   project/.next/server/app/page.js  (bundle)
      //   project/.next/server/app/page.js.map  (source map with webpack://name/src/app/page.ts)
      const projectDir = join(FIXTURE_DIR, 'nextjs-project');
      const srcDir = join(projectDir, 'src', 'app');
      const nextDir = join(projectDir, '.next', 'server', 'app');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(nextDir, { recursive: true });

      // Project root marker
      writeFileSync(join(projectDir, 'package.json'), '{"name":"test"}');

      // Original source at project root
      writeFileSync(join(srcDir, 'page.ts'), ORIGINAL_SOURCE);

      // Bundle deep in .next/
      const bundlePath = join(nextDir, 'page.js');
      writeFileSync(
        bundlePath,
        'var a=function(){throw new Error("test error")};a();\n//# sourceMappingURL=page.js.map'
      );

      // Source map with webpack://name/ prefix — source is relative to project root
      const mapData = {
        version: 3,
        file: 'page.js',
        sources: ['webpack://test/src/app/page.ts'],
        sourcesContent: [ORIGINAL_SOURCE],
        mappings: 'AAII',
      };
      writeFileSync(join(nextDir, 'page.js.map'), JSON.stringify(mapData));

      const frames = [makeFrame(bundlePath, 1, 1, [], 'minified', [])];
      const result = resolveSourceMaps(frames, null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      const frame = result.sourceContext[0];
      // Should resolve to the ACTUAL source file, not a broken .next/server/app/src/app/page.ts
      expect(frame.file).toBe(join(srcDir, 'page.ts'));
      expect(frame.file).not.toContain('.next');
      expect(frame.line).toBe(5);
      expect(frame.target).toBe('    throw new Error("test error");');
    });

    it('falls back to clean relative path when project root not found', () => {
      // Source map with sourcesContent but source path doesn't match anything on disk
      const isolatedDir = join(FIXTURE_DIR, 'isolated');
      mkdirSync(isolatedDir, { recursive: true });

      const bundlePath = join(isolatedDir, 'bundle.js');
      writeFileSync(
        bundlePath,
        'var a=function(){throw new Error("test error")};a();\n//# sourceMappingURL=bundle.js.map'
      );

      const mapData = {
        version: 3,
        file: 'bundle.js',
        sources: ['webpack://ghost/src/nonexistent/file.ts'],
        sourcesContent: [ORIGINAL_SOURCE],
        mappings: 'AAII',
      };
      writeFileSync(join(isolatedDir, 'bundle.js.map'), JSON.stringify(mapData));

      const frames = [makeFrame(bundlePath, 1, 1, [], 'minified', [])];
      const result = resolveSourceMaps(frames, null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      // Falls back to clean relative path (not a broken absolute join)
      expect(result.sourceContext[0].file).toBe('src/nonexistent/file.ts');
    });
  });

  // -----------------------------------------------------------------------
  // Graceful degradation
  // -----------------------------------------------------------------------
  describe('graceful degradation', () => {
    it('keeps original frame when .map file does not exist', () => {
      const nonExistentFile = join(FIXTURE_DIR, 'nonexistent.js');
      writeFileSync(nonExistentFile, 'console.log("hello");');
      const frame = makeFrame(nonExistentFile, 1, 1, [], 'console.log("hello");', []);
      const result = resolveSourceMaps([frame], null);

      expect(result.resolved).toBe(false);
      assert(result.sourceContext);
      expect(result.sourceContext[0]).toEqual(frame);
    });

    it('keeps original frame when .map file is malformed', () => {
      const badBundle = join(FIXTURE_DIR, 'bad.js');
      const badMap = join(FIXTURE_DIR, 'bad.js.map');
      writeFileSync(badBundle, 'broken();\n//# sourceMappingURL=bad.js.map');
      writeFileSync(badMap, 'this is not json');

      const frame = makeFrame(badBundle, 1, 1, [], 'broken();', []);
      const result = resolveSourceMaps([frame], null);

      expect(result.resolved).toBe(false);
      assert(result.sourceContext);
      expect(result.sourceContext[0]).toEqual(frame);
    });

    it('keeps original frame when source file does not exist', () => {
      const frame = makeFrame('/totally/nonexistent/file.js', 1, 1, [], 'x()', []);
      const result = resolveSourceMaps([frame], null);

      expect(result.resolved).toBe(false);
      assert(result.sourceContext);
      expect(result.sourceContext[0]).toEqual(frame);
    });

    it('resolves some frames while keeping others as-is', () => {
      const resolvable = makeFrame(BUNDLE_FILE, 1, 1, [], BUNDLE_CONTENT.split('\n')[0], []);
      const unresolvable = makeFrame('/no/such/file.js', 1, 1, [], 'nope()', []);

      const result = resolveSourceMaps([resolvable, unresolvable], null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      expect(result.sourceContext).toHaveLength(2);
      expect(result.sourceContext[0].file).toContain('src/app.ts');
      expect(result.sourceContext[1].file).toBe('/no/such/file.js');
    });

    it('preserves already-resolved frames when a later frame throws', () => {
      // First frame resolves normally, second frame has a map that will cause issues
      const goodFrame = makeFrame(BUNDLE_FILE, 1, 1, [], BUNDLE_CONTENT.split('\n')[0], []);

      // Create a bundle whose .map has valid JSON but invalid mappings that cause SourceMapConsumer to throw
      const throwBundle = join(FIXTURE_DIR, 'throw-frame.js');
      const throwMap = join(FIXTURE_DIR, 'throw-frame.js.map');
      writeFileSync(throwBundle, 'x();\n//# sourceMappingURL=throw-frame.js.map');
      // Valid JSON, but the consumer will return source: null for unmapped positions
      writeFileSync(
        throwMap,
        JSON.stringify({ version: 3, file: 'throw-frame.js', sources: [], mappings: '' })
      );
      const badFrame = makeFrame(throwBundle, 1, 1, [], 'x()', []);

      const result = resolveSourceMaps([goodFrame, badFrame], null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      expect(result.sourceContext).toHaveLength(2);
      // First frame was resolved
      expect(result.sourceContext[0].file).toContain('src/app.ts');
      // Second frame kept as-is (per-frame try/catch)
      expect(result.sourceContext[1].file).toBe(throwBundle);
    });
  });

  // -----------------------------------------------------------------------
  // Resolved function name
  // -----------------------------------------------------------------------
  describe('resolvedFunctionName', () => {
    it('returns null when nothing is resolved', () => {
      const frame = makeFrame('/no/file.js', 1, 1, [], 'x()', []);
      const result = resolveSourceMaps([frame], null);

      expect(result.resolvedFunctionName).toBeNull();
    });

    it('returns null when source map has no name mapping', () => {
      const frames = [makeFrame(BUNDLE_FILE, 1, 1, [], BUNDLE_CONTENT.split('\n')[0], [])];
      const result = resolveSourceMaps(frames, { file: BUNDLE_FILE, line: 1, column: 1 });

      // Our test fixture's mappings ('AAII') don't include a name segment
      expect(result.resolved).toBe(true);
      expect(result.resolvedFunctionName).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Tail reading optimization
  // -----------------------------------------------------------------------
  describe('tail reading', () => {
    it('finds sourceMappingURL in a large file without reading the whole thing', () => {
      const largeBundle = join(FIXTURE_DIR, 'large-bundle.js');
      // Create a ~10KB file with the sourceMappingURL at the end
      const padding = 'var x = ' + 'a'.repeat(10000) + ';\n';
      writeFileSync(largeBundle, padding + '//# sourceMappingURL=bundle.js.map');

      const frames = [makeFrame(largeBundle, 1, 1, [], 'minified', [])];
      const result = resolveSourceMaps(frames, null);

      expect(result.resolved).toBe(true);
      assert(result.sourceContext);
      expect(result.sourceContext[0].file).toContain('src/app.ts');
    });

    it('handles empty files gracefully', () => {
      const emptyFile = join(FIXTURE_DIR, 'empty.js');
      writeFileSync(emptyFile, '');
      const frame = makeFrame(emptyFile, 1, 1, [], '', []);
      const result = resolveSourceMaps([frame], null);

      expect(result.resolved).toBe(false);
    });
  });
});
