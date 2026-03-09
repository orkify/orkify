import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { type RawSourceMap, SourceMapConsumer } from 'source-map-js';
import type { SourceContextFrame } from '../types/index.js';

interface TopFrame {
  file: string;
  line: number;
  column: number;
}

interface ResolveResult {
  sourceContext: null | SourceContextFrame[];
  topFrame: null | TopFrame;
  resolvedFunctionName: null | string;
  resolved: boolean;
}

const SOURCEMAP_URL_RE = /\/[/*]#\s*sourceMappingURL=(\S+)\s*(?:\*\/)?$/;

/** Protocol prefixes used by bundlers in source map `sources` entries. */
const SOURCE_PROTOCOL_RE =
  /^(?:webpack:\/\/\/|webpack-internal:\/\/\/|webpack:\/\/[^/]*\/|vite-[\w-]+:\/\/)/;

/** Max bytes to read from the tail of a file to find sourceMappingURL. */
const TAIL_BYTES = 512;

/**
 * Parse a base64-encoded inline source map from a data: URL.
 * Returns the parsed JSON object, or null if parsing fails.
 */
function parseInlineSourceMap(dataUrl: string): null | RawSourceMap {
  try {
    const base64Idx = dataUrl.indexOf('base64,');
    if (base64Idx === -1) return null;
    const raw = Buffer.from(dataUrl.slice(base64Idx + 7), 'base64').toString('utf8');
    return JSON.parse(raw) as RawSourceMap;
  } catch {
    return null;
  }
}

/**
 * Scan lines (newest-first) for a sourceMappingURL comment.
 * Returns the URL string or null.
 */
function scanForSourceMapUrl(content: string): null | string {
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(SOURCEMAP_URL_RE);
    if (match) return match[1];
  }
  return null;
}

function findSourceMap(
  filePath: string
): null | { data: RawSourceMap; type: 'inline' } | { path: string; type: 'file' } {
  try {
    const stat = statSync(filePath);
    const size = stat.size;
    if (size === 0) return null;

    // Read only the tail of the file first (sourceMappingURL is always at the end).
    // This is enough for external .map references (~40 chars).
    const readSize = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(readSize);
    const fd = openSync(filePath, 'r');
    try {
      readSync(fd, buf, 0, readSize, size - readSize);
    } finally {
      closeSync(fd);
    }

    const tail = buf.toString('utf8');
    let url = scanForSourceMapUrl(tail);

    // If no match in the tail but we didn't read the whole file, the comment
    // might be a long inline data: URL whose "//# sourceMappingURL=" prefix
    // falls outside our 512-byte window. Fall back to full read.
    if (!url && readSize < size) {
      const full = readFileSync(filePath, 'utf8');
      url = scanForSourceMapUrl(full);
    }

    if (!url) return null;

    if (url.startsWith('data:')) {
      const data = parseInlineSourceMap(url);
      return data ? { type: 'inline', data } : null;
    }

    // External .map file
    const resolvedPath = isAbsolute(url) ? url : join(dirname(filePath), url);
    return { type: 'file', path: resolvedPath };
  } catch {
    return null;
  }
}

/**
 * Strip bundler protocol prefixes from source paths.
 * e.g. "webpack:///src/app.ts" → "src/app.ts"
 *      "webpack-internal:///./src/app.ts" → "./src/app.ts"
 *      "vite-node:///src/app.ts" → "src/app.ts"
 */
function stripSourceProtocol(source: string): string {
  return source.replace(SOURCE_PROTOCOL_RE, '');
}

/**
 * Resolve a source file path for display.
 *
 * For standalone bundler output (webpack/vite), `join(mapDir, source)` typically
 * points to the real file. For Next.js, the source is relative to the project
 * root (e.g. "src/app/page.tsx") but the .map lives deep inside .next/, so the
 * naive join produces a wrong path. We walk up from the map directory looking
 * for a package.json (project root marker) and resolve relative to that.
 */
function resolveDisplayPath(cleanSource: string, mapDir: string): string {
  if (isAbsolute(cleanSource)) return cleanSource;

  // Fast path: source exists relative to the map directory (standalone bundles)
  const naiveJoin = join(mapDir, cleanSource);
  if (existsSync(naiveJoin)) return naiveJoin;

  // Walk up to find the project root (package.json), then resolve relative to it
  let dir = mapDir;
  const root = dirname(dir) === dir ? dir : '/'; // filesystem root
  while (dir !== root) {
    if (existsSync(join(dir, 'package.json'))) {
      const candidate = join(dir, cleanSource);
      if (existsSync(candidate)) return candidate;
    }
    dir = dirname(dir);
  }

  // Fallback: return the clean relative source as-is (still readable)
  return cleanSource;
}

/**
 * Extract source context (pre/target/post lines) from source content.
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

/**
 * Try to resolve a single frame using its source map.
 * Returns the resolved frame or null if resolution fails.
 */
function resolveFrame(
  frame: SourceContextFrame,
  consumerCache: Map<string, null | SourceMapConsumer>
): null | { frame: SourceContextFrame; functionName: null | string } {
  // Find the source map (external file or inline data: URL)
  const sourceMap = findSourceMap(frame.file);
  let consumer: null | SourceMapConsumer | undefined;
  let mapDir: string = dirname(frame.file);

  if (sourceMap) {
    if (sourceMap.type === 'inline') {
      // Inline source map — create consumer directly from parsed data
      try {
        consumer = new SourceMapConsumer(sourceMap.data);
      } catch {
        consumer = null;
      }
    } else {
      // External .map file — use cache
      mapDir = dirname(sourceMap.path);
      consumer = consumerCache.get(sourceMap.path);
      if (consumer === undefined) {
        try {
          const raw = readFileSync(sourceMap.path, 'utf8');
          consumer = new SourceMapConsumer(JSON.parse(raw));
          consumerCache.set(sourceMap.path, consumer);
        } catch {
          consumerCache.set(sourceMap.path, null);
          return null;
        }
      }
    }
  } else {
    // Fallback: try <file>.map
    const fallback = frame.file + '.map';
    if (existsSync(fallback)) {
      mapDir = dirname(fallback);
      consumer = consumerCache.get(fallback);
      if (consumer === undefined) {
        try {
          const raw = readFileSync(fallback, 'utf8');
          consumer = new SourceMapConsumer(JSON.parse(raw));
          consumerCache.set(fallback, consumer);
        } catch {
          consumerCache.set(fallback, null);
          return null;
        }
      }
    } else {
      return null;
    }
  }
  if (!consumer) return null;

  // Resolve the original position
  const pos = consumer.originalPositionFor({
    line: frame.line,
    column: Math.max(0, (frame.column || 1) - 1),
  });

  if (!pos.source || !pos.line) return null;

  // Strip bundler protocol prefixes (webpack:///, vite-node://, etc.)
  const cleanSource = stripSourceProtocol(pos.source);

  // Get source content — prefer sourcesContent from the map, fall back to disk
  let sourceContent: null | string = null;
  try {
    sourceContent = consumer.sourceContentFor(pos.source);
  } catch {
    // Not available in sourcesContent
  }

  if (!sourceContent) {
    // Try reading from disk using the cleaned source path
    const displayPath = resolveDisplayPath(cleanSource, mapDir);
    try {
      sourceContent = readFileSync(displayPath, 'utf8');
    } catch {
      return null;
    }
  }

  const context = extractContext(sourceContent, pos.line);
  if (!context) return null;

  // Resolve the display file path from the cleaned source
  const file = resolveDisplayPath(cleanSource, mapDir);

  return {
    frame: {
      file,
      line: pos.line,
      column: (pos.column ?? 0) + 1,
      pre: context.pre,
      target: context.target,
      post: context.post,
    },
    functionName: pos.name || null,
  };
}

/**
 * Resolve source maps for all frames in an error's source context.
 *
 * For each frame, attempts to find and parse the corresponding .map file,
 * then replaces the minified location with the original source location.
 * Frames that can't be resolved are kept as-is.
 *
 * Returns the resolved function name from the source map (if available)
 * so the caller can use it for fingerprinting.
 */
export function resolveSourceMaps(
  sourceContext: null | SourceContextFrame[],
  topFrame: null | TopFrame
): ResolveResult {
  if (!sourceContext || sourceContext.length === 0) {
    return { sourceContext, topFrame, resolvedFunctionName: null, resolved: false };
  }

  try {
    const consumerCache = new Map<string, null | SourceMapConsumer>();
    const resolvedFrames: SourceContextFrame[] = [];
    let anyResolved = false;
    let resolvedTopFrame: null | TopFrame = null;
    let resolvedFunctionName: null | string = null;

    for (const frame of sourceContext) {
      try {
        const result = resolveFrame(frame, consumerCache);
        if (result) {
          resolvedFrames.push(result.frame);
          anyResolved = true;
          if (!resolvedTopFrame) {
            resolvedTopFrame = {
              file: result.frame.file,
              line: result.frame.line,
              column: result.frame.column,
            };
            resolvedFunctionName = result.functionName;
          }
        } else {
          resolvedFrames.push(frame);
        }
      } catch {
        // Per-frame try/catch: one bad frame doesn't block others
        resolvedFrames.push(frame);
      }
    }

    if (!anyResolved) {
      return { sourceContext, topFrame, resolvedFunctionName: null, resolved: false };
    }

    return {
      sourceContext: resolvedFrames,
      topFrame: resolvedTopFrame ?? topFrame,
      resolvedFunctionName,
      resolved: true,
    };
  } catch {
    // Never crash the daemon — return original data
    return { sourceContext, topFrame, resolvedFunctionName: null, resolved: false };
  }
}
