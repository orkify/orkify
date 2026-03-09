/**
 * Parse user stack frames from an Error.stack string.
 *
 * Handles multiple file path formats found in stack traces:
 *  - Absolute paths: /home/user/project/src/app.ts
 *  - Windows paths: C:\Users\project\src\app.ts
 *  - ESM file:// URLs: file:///home/user/project/src/app.ts
 *  - webpack-internal:// (Next.js): webpack-internal:///(rsc)/./src/app.ts
 *  - webpack:// (plain webpack): webpack:///./src/file.ts
 *  - Unknown URL schemes (data:, blob:, turbopack://, etc.) are skipped.
 *
 * IMPORTANT: The probe string in constants.ts inlines a copy of this logic
 * (it runs inside a data: URL and cannot import modules). Keep them in sync.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface StackFrame {
  file: string;
  line: number;
  column: number;
}

const STACK_LINE_RE = /at\s+(?:.*?\s+)?\(?(.+?):(\d+):(\d+)\)?$/;
const WEBPACK_PREFIX_RE = /^webpack(?:-internal)?:\/\/\/(?:[^/]*\/)?/;
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]+:/i;

/** URL schemes that indicate browser internals (skipped for browser frames). */
const BROWSER_INTERNAL_RE =
  /^(?:chrome-extension|moz-extension|safari-extension|about|blob|data):/i;

/**
 * Map a browser URL to a local file path.
 * Strips the origin, maps Next.js `/_next/static/` to `.next/static/`,
 * and resolves the path against the working directory.
 * Returns null for unmappable URLs.
 */
export function mapBrowserUrlToPath(url: string, cwd: string): null | string {
  if (BROWSER_INTERNAL_RE.test(url)) return null;

  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  // Next.js: /_next/static/ → .next/static/
  if (pathname.startsWith('/_next/')) {
    return resolve(cwd, '.next' + pathname.slice(6)); // strip "/_next" (6 chars), keep "/static/..."
  }

  // Generic: resolve pathname against cwd (strip leading slash — URL pathnames always start with /)
  const relative = pathname.slice(1);
  if (!relative) return null;
  return resolve(cwd, relative);
}

/**
 * Parse stack frames from a browser Error.stack string.
 * Expects V8 format (Chrome stacks or pre-normalized Firefox/Safari stacks).
 * Maps http/https URLs to local file paths using Next.js conventions.
 */
export function parseBrowserFrames(stack: string, cwd: string): StackFrame[] {
  const frames: StackFrame[] = [];
  if (!stack) return frames;

  for (const line of stack.split('\n')) {
    const m = line.match(STACK_LINE_RE);
    if (!m) continue;

    const rawFile = m[1];

    // Handle http/https URLs (browser stack traces)
    if (rawFile.startsWith('http://') || rawFile.startsWith('https://')) {
      const file = mapBrowserUrlToPath(rawFile, cwd);
      if (!file) continue;
      // Skip node_modules in resolved paths
      if (file.includes('node_modules')) continue;
      frames.push({ file, line: parseInt(m[2], 10), column: parseInt(m[3], 10) });
      if (frames.length >= 10) break;
      continue;
    }

    // Skip browser internals and other URL schemes
    if (BROWSER_INTERNAL_RE.test(rawFile) || URL_SCHEME_RE.test(rawFile)) continue;

    // Skip Node.js internals and dependencies
    if (rawFile.startsWith('node:') || rawFile.includes('node_modules')) continue;

    frames.push({ file: rawFile, line: parseInt(m[2], 10), column: parseInt(m[3], 10) });
    if (frames.length >= 10) break;
  }

  return frames;
}

export function parseUserFrames(stack: string, cwd: string = process.cwd()): StackFrame[] {
  const frames: StackFrame[] = [];
  if (!stack) return frames;

  for (const line of stack.split('\n')) {
    const m = line.match(STACK_LINE_RE);
    if (!m) continue;

    let file = m[1];

    // ESM file:// URLs → absolute path
    if (file.startsWith('file://')) {
      try {
        file = fileURLToPath(file);
      } catch {
        continue;
      }
    }
    // webpack / webpack-internal URLs → resolve relative path against cwd
    else if (file.startsWith('webpack-internal://') || file.startsWith('webpack://')) {
      const relative = file.replace(WEBPACK_PREFIX_RE, '');
      file = resolve(cwd, relative);
    }
    // Any other URL scheme (data:, blob:, turbopack://, http://, etc.) → skip
    else if (URL_SCHEME_RE.test(file)) {
      continue;
    }

    // Filter out Node.js internals and dependencies
    if (file.startsWith('node:') || file.includes('node_modules')) {
      continue;
    }

    frames.push({ file, line: parseInt(m[2], 10), column: parseInt(m[3], 10) });
    if (frames.length >= 10) break;
  }

  return frames;
}
