/**
 * Browser stack frame parsing — extracted from probe/parse-frames.ts.
 * Only the browser-specific logic needed by the error handler.
 */

import { resolve } from 'node:path';

export interface StackFrame {
  file: string;
  line: number;
  column: number;
}

const STACK_LINE_RE = /at\s+(?:.*?\s+)?\(?(.+?):(\d+):(\d+)\)?$/;

/** URL schemes that indicate browser internals (skipped). */
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
    return resolve(cwd, '.next' + pathname.slice(6));
  }

  // Generic: resolve pathname against cwd
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
      if (file.includes('node_modules')) continue;
      frames.push({ file, line: parseInt(m[2], 10), column: parseInt(m[3], 10) });
      if (frames.length >= 10) break;
      continue;
    }

    // Skip browser internals and other URL schemes
    if (BROWSER_INTERNAL_RE.test(rawFile)) continue;
    if (rawFile.startsWith('node:') || rawFile.includes('node_modules')) continue;

    frames.push({ file: rawFile, line: parseInt(m[2], 10), column: parseInt(m[3], 10) });
    if (frames.length >= 10) break;
  }

  return frames;
}

/**
 * Extract source context lines around a target line number.
 * Returns 5 lines before, the target line, and 5 lines after.
 */
export function extractContext(
  source: string,
  line: number
): null | { pre: string[]; target: string; post: string[] } {
  const lines = source.split('\n');
  if (line < 1 || line > lines.length) return null;

  const start = Math.max(0, line - 6);
  const end = Math.min(lines.length, line + 5);

  return {
    pre: lines.slice(start, line - 1),
    target: lines[line - 1] || '',
    post: lines.slice(line, end),
  };
}
