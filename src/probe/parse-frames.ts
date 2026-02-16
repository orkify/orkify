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
