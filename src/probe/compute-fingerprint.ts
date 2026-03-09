import { createHash } from 'node:crypto';

/**
 * Parse the function name from a V8 stack trace for a specific file and line.
 * Returns null if the frame has no function name (bare path) or isn't found.
 */
export function parseFunctionName(
  stack: string,
  targetFile: string,
  targetLine: number
): null | string {
  if (!stack || !targetFile) return null;

  const needle = targetFile + ':' + targetLine + ':';
  // Also match file:// URL form (ESM stacks keep the URL in the raw trace)
  const fileUrlNeedle = targetFile.startsWith('/')
    ? 'file://' + targetFile + ':' + targetLine + ':'
    : null;

  for (const line of stack.split('\n')) {
    // Check this line references the target file and line number
    if (!line.includes(needle) && !(fileUrlNeedle && line.includes(fileUrlNeedle))) continue;

    // Must be an actual stack frame line (starts with "at")
    const m = line.match(/^\s*at\s+(.+?)\s+[(]/);
    if (!m) continue; // Not a frame line or bare path — keep searching

    let name = m[1];

    // Strip "async " prefix
    if (name.startsWith('async ')) {
      name = name.slice(6);
    }

    // "Object.<anonymous>" → "<anonymous>"
    if (name === 'Object.<anonymous>') {
      return '<anonymous>';
    }

    return name;
  }

  return null;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RE = /\b[0-9a-f]{16,}\b/gi;
const IPV4_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const NUMBER_RE = /\b\d+\b/g;

/**
 * Normalize an error message by replacing dynamic values with `*`.
 * This stabilizes fingerprints across instances of the same logical error.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(UUID_RE, '*')
    .replace(HEX_RE, '*')
    .replace(IPV4_RE, '*')
    .replace(NUMBER_RE, '*');
}

interface FingerprintInput {
  errorName: string;
  message: string;
  file: string;
  line: number;
  functionName?: null | string;
}

/**
 * Compute a stable error fingerprint.
 *
 * Uses file + function name when available (stable across line shifts).
 * Falls back to file + line number when no function name is available.
 * Includes error name and normalized message for proper grouping.
 */
export function computeFingerprint(input: FingerprintInput): string {
  const normalized = normalizeMessage(input.message);
  const location = input.functionName
    ? input.file + '\0' + input.functionName
    : input.file + ':' + input.line;

  const raw = input.errorName + '\0' + normalized + '\0' + location;
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}
