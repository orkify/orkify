import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mapBrowserUrlToPath,
  parseBrowserFrames,
  type StackFrame,
} from '../../packages/next/src/utils.js';
import { parseUserFrames } from '../../src/probe/parse-frames.js';

const CWD = '/project';

function frame(file: string, line: number, column: number): StackFrame {
  return { file, line, column };
}

describe('parseUserFrames', () => {
  // -----------------------------------------------------------------------
  // Absolute paths (Linux / macOS)
  // -----------------------------------------------------------------------
  describe('absolute paths', () => {
    it('parses a simple stack trace with absolute paths', () => {
      const stack = [
        'Error: something broke',
        '    at doWork (/home/user/project/src/worker.ts:42:10)',
        '    at main (/home/user/project/src/index.ts:10:3)',
      ].join('\n');

      expect(parseUserFrames(stack, CWD)).toEqual([
        frame('/home/user/project/src/worker.ts', 42, 10),
        frame('/home/user/project/src/index.ts', 10, 3),
      ]);
    });

    it('parses anonymous function frames (no parentheses around path)', () => {
      const stack = ['Error: oops', '    at /home/user/project/src/app.ts:5:12'].join('\n');

      expect(parseUserFrames(stack, CWD)).toEqual([frame('/home/user/project/src/app.ts', 5, 12)]);
    });
  });

  // -----------------------------------------------------------------------
  // Windows paths
  // -----------------------------------------------------------------------
  describe('Windows paths', () => {
    it('parses Windows drive letter paths', () => {
      const stack = [
        'Error: fail',
        '    at handler (C:\\Users\\dev\\project\\src\\server.ts:20:5)',
      ].join('\n');

      expect(parseUserFrames(stack, CWD)).toEqual([
        frame('C:\\Users\\dev\\project\\src\\server.ts', 20, 5),
      ]);
    });

    it('does not confuse drive letters with URL schemes', () => {
      const stack = ['Error: fail', '    at run (D:\\work\\app\\index.js:1:1)'].join('\n');

      const frames = parseUserFrames(stack, CWD);
      expect(frames).toHaveLength(1);
      expect(frames[0].file).toBe('D:\\work\\app\\index.js');
    });
  });

  // -----------------------------------------------------------------------
  // ESM file:// URLs
  // -----------------------------------------------------------------------
  describe('file:// URLs', () => {
    it('converts file:// URLs to absolute paths', () => {
      const stack = [
        'Error: boom',
        '    at run (file:///home/user/project/src/main.mjs:8:14)',
      ].join('\n');

      const frames = parseUserFrames(stack, CWD);
      expect(frames).toHaveLength(1);
      expect(frames[0].file).toBe('/home/user/project/src/main.mjs');
      expect(frames[0].line).toBe(8);
    });
  });

  // -----------------------------------------------------------------------
  // webpack-internal:// (Next.js)
  // -----------------------------------------------------------------------
  describe('webpack-internal:// paths', () => {
    it('resolves webpack-internal (rsc) paths against cwd', () => {
      const stack = [
        'TypeError: Cannot read properties of null',
        '    at fetchUserProfile (webpack-internal:///(rsc)/./src/app/api/chaos/route.ts:13:17)',
        '    at Object.make (webpack-internal:///(rsc)/./src/app/api/chaos/route.ts:35:19)',
      ].join('\n');

      expect(parseUserFrames(stack, CWD)).toEqual([
        frame(resolve(CWD, './src/app/api/chaos/route.ts'), 13, 17),
        frame(resolve(CWD, './src/app/api/chaos/route.ts'), 35, 19),
      ]);
    });

    it('resolves webpack-internal (ssr) paths', () => {
      const stack = [
        'Error: hydration mismatch',
        '    at render (webpack-internal:///(ssr)/./src/app/page.tsx:22:5)',
      ].join('\n');

      expect(parseUserFrames(stack, CWD)).toEqual([
        frame(resolve(CWD, './src/app/page.tsx'), 22, 5),
      ]);
    });

    it('resolves webpack-internal (action-browser) paths', () => {
      const stack = [
        'Error: action failed',
        '    at submitForm (webpack-internal:///(action-browser)/./src/lib/actions.ts:45:11)',
      ].join('\n');

      expect(parseUserFrames(stack, CWD)).toEqual([
        frame(resolve(CWD, './src/lib/actions.ts'), 45, 11),
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // webpack:// (plain webpack, without -internal)
  // -----------------------------------------------------------------------
  describe('webpack:// paths', () => {
    it('resolves webpack:/// with scope prefix', () => {
      const stack = [
        'Error: fail',
        '    at handler (webpack:///client/./src/handler.ts:10:3)',
      ].join('\n');

      expect(parseUserFrames(stack, CWD)).toEqual([frame(resolve(CWD, './src/handler.ts'), 10, 3)]);
    });

    it('resolves webpack:/// without scope prefix', () => {
      const stack = ['Error: fail', '    at init (webpack:///./src/init.ts:2:8)'].join('\n');

      expect(parseUserFrames(stack, CWD)).toEqual([frame(resolve(CWD, './src/init.ts'), 2, 8)]);
    });
  });

  // -----------------------------------------------------------------------
  // Unknown URL schemes — should be skipped
  // -----------------------------------------------------------------------
  describe('unknown URL schemes', () => {
    it('skips data: URLs', () => {
      const stack = [
        'Error: probe error',
        '    at eval (data:text/javascript;base64,abc:1:10)',
        '    at main (/project/src/app.ts:5:1)',
      ].join('\n');

      const frames = parseUserFrames(stack, CWD);
      expect(frames).toEqual([frame('/project/src/app.ts', 5, 1)]);
    });

    it('skips blob: URLs', () => {
      const stack = [
        'Error: worker error',
        '    at run (blob:nodedata:12345:3:7)',
        '    at main (/project/src/app.ts:5:1)',
      ].join('\n');

      const frames = parseUserFrames(stack, CWD);
      expect(frames).toEqual([frame('/project/src/app.ts', 5, 1)]);
    });

    it('skips turbopack:// URLs', () => {
      const stack = [
        'Error: turbo error',
        '    at run (turbopack://[project]/src/app.ts:10:5)',
        '    at main (/project/src/app.ts:5:1)',
      ].join('\n');

      const frames = parseUserFrames(stack, CWD);
      expect(frames).toEqual([frame('/project/src/app.ts', 5, 1)]);
    });

    it('skips invalid file:// URLs gracefully', () => {
      const stack = [
        'Error: bad url',
        '    at run (file://not%a%valid%url:1:1)',
        '    at main (/project/src/app.ts:5:1)',
      ].join('\n');

      const frames = parseUserFrames(stack, CWD);
      expect(frames).toEqual([frame('/project/src/app.ts', 5, 1)]);
    });

    it('skips http:// and https:// URLs', () => {
      const stack = [
        'Error: remote',
        '    at load (https://cdn.example.com/lib.js:1:100)',
        '    at main (/project/src/app.ts:5:1)',
      ].join('\n');

      const frames = parseUserFrames(stack, CWD);
      expect(frames).toEqual([frame('/project/src/app.ts', 5, 1)]);
    });
  });

  // -----------------------------------------------------------------------
  // Filtering — node: internals and node_modules
  // -----------------------------------------------------------------------
  describe('filtering', () => {
    it('skips node: internal frames', () => {
      const stack = [
        'Error: timeout',
        '    at process.processImmediate (node:internal/timers:504:21)',
        '    at process.callbackTrampoline (node:internal/async_hooks:131:14)',
        '    at handler (/project/src/app.ts:10:5)',
      ].join('\n');

      expect(parseUserFrames(stack, CWD)).toEqual([frame('/project/src/app.ts', 10, 5)]);
    });

    it('skips node_modules frames', () => {
      const stack = [
        'Error: lib error',
        '    at Router.handle (/project/node_modules/express/lib/router.js:45:12)',
        '    at handler (/project/src/routes.ts:10:5)',
      ].join('\n');

      expect(parseUserFrames(stack, CWD)).toEqual([frame('/project/src/routes.ts', 10, 5)]);
    });

    it('skips node_modules in webpack-internal paths', () => {
      const stack = [
        'Error: dep error',
        '    at call (webpack-internal:///(rsc)/./node_modules/some-lib/index.js:5:3)',
        '    at handler (webpack-internal:///(rsc)/./src/app.ts:10:5)',
      ].join('\n');

      const frames = parseUserFrames(stack, CWD);
      expect(frames).toHaveLength(1);
      expect(frames[0].line).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // Limits and edge cases
  // -----------------------------------------------------------------------
  describe('limits and edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(parseUserFrames('', CWD)).toEqual([]);
    });

    it('returns empty array for null-ish stack', () => {
      expect(parseUserFrames(null as unknown as string, CWD)).toEqual([]);
      expect(parseUserFrames(undefined as unknown as string, CWD)).toEqual([]);
    });

    it('returns empty array when only node internals', () => {
      const stack = ['Error: oops', '    at node:internal/process:123:45'].join('\n');

      expect(parseUserFrames(stack, CWD)).toEqual([]);
    });

    it('caps at 10 frames', () => {
      const lines = ['Error: deep stack'];
      for (let i = 1; i <= 20; i++) {
        lines.push(`    at fn${i} (/project/src/deep.ts:${i}:1)`);
      }

      const frames = parseUserFrames(lines.join('\n'), CWD);
      expect(frames).toHaveLength(10);
      expect(frames[0].line).toBe(1);
      expect(frames[9].line).toBe(10);
    });

    it('handles mixed frame types in a realistic Next.js stack', () => {
      const stack = [
        "TypeError: Cannot read properties of null (reading 'profile')",
        '    at fetchUserProfile (webpack-internal:///(rsc)/./src/app/api/chaos/route.ts:13:17)',
        '    at Object.make (webpack-internal:///(rsc)/./src/app/api/chaos/route.ts:35:19)',
        '    at triggerThrow (webpack-internal:///(rsc)/./src/app/api/chaos/route.ts:69:19)',
        '    at Immediate.eval (webpack-internal:///(rsc)/./src/app/api/chaos/route.ts:86:30)',
        '    at process.processImmediate (node:internal/timers:504:21)',
        '    at process.callbackTrampoline (node:internal/async_hooks:131:14)',
      ].join('\n');

      const frames = parseUserFrames(stack, CWD);
      expect(frames).toHaveLength(4);
      expect(frames.every((f) => f.file === resolve(CWD, './src/app/api/chaos/route.ts'))).toBe(
        true
      );
      expect(frames.map((f) => f.line)).toEqual([13, 35, 69, 86]);
    });

    it('handles mixed absolute + webpack + node frames', () => {
      const stack = [
        'Error: mixed',
        '    at userFn (/project/src/util.ts:5:3)',
        '    at render (webpack-internal:///(ssr)/./src/page.tsx:10:7)',
        '    at Router (/project/node_modules/next/dist/server.js:100:5)',
        '    at process.processImmediate (node:internal/timers:504:21)',
      ].join('\n');

      const frames = parseUserFrames(stack, CWD);
      expect(frames).toEqual([
        frame('/project/src/util.ts', 5, 3),
        frame(resolve(CWD, './src/page.tsx'), 10, 7),
      ]);
    });
  });
});

describe('mapBrowserUrlToPath', () => {
  const CWD = '/app';

  it('maps Next.js /_next/static/ URLs to .next/static/', () => {
    const result = mapBrowserUrlToPath(
      'http://localhost:3000/_next/static/chunks/app/page-abc.js',
      CWD
    );
    expect(result).toBe(resolve(CWD, '.next/static/chunks/app/page-abc.js'));
  });

  it('maps generic paths against cwd', () => {
    const result = mapBrowserUrlToPath('http://localhost:3000/assets/script.js', CWD);
    expect(result).toBe(resolve(CWD, 'assets/script.js'));
  });

  it('returns null for data: URLs', () => {
    expect(mapBrowserUrlToPath('data:text/javascript;base64,abc', CWD)).toBeNull();
  });

  it('returns null for blob: URLs', () => {
    expect(mapBrowserUrlToPath('blob:http://localhost:3000/uuid', CWD)).toBeNull();
  });

  it('returns null for chrome-extension: URLs', () => {
    expect(mapBrowserUrlToPath('chrome-extension://abc/content.js', CWD)).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(mapBrowserUrlToPath('not-a-url', CWD)).toBeNull();
  });

  it('returns null for root path only', () => {
    expect(mapBrowserUrlToPath('http://localhost:3000/', CWD)).toBeNull();
  });

  it('handles https URLs', () => {
    const result = mapBrowserUrlToPath('https://myapp.com/_next/static/chunks/main.js', CWD);
    expect(result).toBe(resolve(CWD, '.next/static/chunks/main.js'));
  });
});

describe('parseBrowserFrames', () => {
  const CWD = '/app';

  it('parses Chrome V8 browser stack with http URLs', () => {
    const stack = [
      'TypeError: Cannot read properties of undefined',
      '    at handleClick (http://localhost:3000/_next/static/chunks/app/page.js:42:15)',
      '    at onClick (http://localhost:3000/_next/static/chunks/framework.js:100:20)',
    ].join('\n');

    const frames = parseBrowserFrames(stack, CWD);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual(frame(resolve(CWD, '.next/static/chunks/app/page.js'), 42, 15));
    expect(frames[1]).toEqual(frame(resolve(CWD, '.next/static/chunks/framework.js'), 100, 20));
  });

  it('skips chrome-extension frames', () => {
    const stack = [
      'Error: test',
      '    at ext (chrome-extension://abc/content.js:1:1)',
      '    at handleClick (http://localhost:3000/_next/static/chunks/app.js:10:5)',
    ].join('\n');

    const frames = parseBrowserFrames(stack, CWD);
    expect(frames).toHaveLength(1);
    expect(frames[0].line).toBe(10);
  });

  it('skips node_modules in resolved paths', () => {
    const stack = [
      'Error: lib',
      '    at lib (http://localhost:3000/node_modules/react/index.js:1:1)',
      '    at app (http://localhost:3000/_next/static/chunks/app.js:5:3)',
    ].join('\n');

    const frames = parseBrowserFrames(stack, CWD);
    expect(frames).toHaveLength(1);
    expect(frames[0].line).toBe(5);
  });

  it('caps at 10 frames', () => {
    const lines = ['Error: deep'];
    for (let i = 1; i <= 20; i++) {
      lines.push(`    at fn${i} (http://localhost:3000/_next/static/chunks/app.js:${i}:1)`);
    }

    const frames = parseBrowserFrames(lines.join('\n'), CWD);
    expect(frames).toHaveLength(10);
  });

  it('handles empty stack', () => {
    expect(parseBrowserFrames('', CWD)).toEqual([]);
  });

  it('handles https URLs', () => {
    const stack = [
      'Error: prod',
      '    at handler (https://myapp.com/_next/static/chunks/main.js:50:10)',
    ].join('\n');

    const frames = parseBrowserFrames(stack, CWD);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(frame(resolve(CWD, '.next/static/chunks/main.js'), 50, 10));
  });

  it('handles absolute paths (non-URL frames) in browser stack', () => {
    const stack = ['Error: test', '    at handler (/app/src/util.ts:5:3)'].join('\n');

    const frames = parseBrowserFrames(stack, CWD);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(frame('/app/src/util.ts', 5, 3));
  });

  it('skips node: internals in absolute path frames', () => {
    const stack = [
      'Error: test',
      '    at internal (node:internal/process:10:5)',
      '    at handler (http://localhost:3000/_next/static/chunks/app.js:5:3)',
    ].join('\n');

    const frames = parseBrowserFrames(stack, CWD);
    expect(frames).toHaveLength(1);
    expect(frames[0].line).toBe(5);
  });

  it('skips http URLs that map to null (root path)', () => {
    const stack = [
      'Error: test',
      '    at handler (http://localhost:3000/:1:1)',
      '    at app (http://localhost:3000/_next/static/chunks/app.js:5:3)',
    ].join('\n');

    const frames = parseBrowserFrames(stack, CWD);
    expect(frames).toHaveLength(1);
    expect(frames[0].line).toBe(5);
  });

  it('skips node_modules in absolute path frames', () => {
    const stack = [
      'Error: test',
      '    at lib (/app/node_modules/react/index.js:1:1)',
      '    at handler (http://localhost:3000/_next/static/chunks/app.js:5:3)',
    ].join('\n');

    const frames = parseBrowserFrames(stack, CWD);
    expect(frames).toHaveLength(1);
    expect(frames[0].line).toBe(5);
  });

  it('caps absolute path frames at 10', () => {
    const lines = ['Error: deep'];
    for (let i = 1; i <= 20; i++) {
      lines.push(`    at fn${i} (/app/src/deep.ts:${i}:1)`);
    }

    const frames = parseBrowserFrames(lines.join('\n'), CWD);
    expect(frames).toHaveLength(10);
  });

  it('skips data: URLs in browser stack', () => {
    const stack = [
      'Error: test',
      '    at eval (data:text/javascript;base64,abc:1:1)',
      '    at handler (http://localhost:3000/_next/static/chunks/app.js:5:3)',
    ].join('\n');

    const frames = parseBrowserFrames(stack, CWD);
    expect(frames).toHaveLength(1);
    expect(frames[0].line).toBe(5);
  });
});
