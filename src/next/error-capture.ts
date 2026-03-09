'use client';

// Minimal DOM types — this module runs in the browser via 'use client'.
// We don't add "DOM" to tsconfig.lib to avoid polluting Node.js code.

declare const window: {
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
};
declare const location: undefined | { href: string };
declare const navigator: undefined | { userAgent: string };
interface ErrorEvent {
  error: unknown;
  message: string;
}
interface PromiseRejectionEvent {
  reason: unknown;
}

import { useEffect } from 'react';

interface OrkifyErrorCaptureProps {
  /** API route endpoint. Default: `/orkify/errors` */
  endpoint?: string;
  /** Max errors to report per page load. Default: 10 */
  maxErrors?: number;
}

/** Simple hash for client-side dedup (not cryptographic). */
function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/**
 * Normalize a Firefox/Safari `fn@file:line:col` stack to V8 `at fn (file:line:col)` format.
 * Chrome/Edge stacks (already V8 format) pass through unchanged.
 */
export function normalizeStack(stack: string): string {
  return stack
    .split('\n')
    .map((line) => {
      // Already V8 format: "    at fn (...)" or "    at ..."
      if (/^\s*at\s+/.test(line)) return line;

      // Firefox/Safari: "fn@file:line:col" or "@file:line:col"
      const m = line.match(/^([^@]*)@(.+):(\d+):(\d+)$/);
      if (m) {
        const fn = m[1];
        const loc = `${m[2]}:${m[3]}:${m[4]}`;
        return fn ? `    at ${fn} (${loc})` : `    at ${loc}`;
      }

      return line;
    })
    .join('\n');
}

// Module-level state for dedup and rate limiting
const recentHashes = new Map<string, number>();
let errorCount = 0;
let configuredEndpoint = '/orkify/errors';
let configuredMax = 10;

/** Flush expired dedup entries (older than 5 seconds). */
function flushExpired(): void {
  const cutoff = Date.now() - 5_000;
  for (const [hash, ts] of recentHashes) {
    if (ts < cutoff) recentHashes.delete(hash);
  }
}

/** Send an error report to the server endpoint. */
function sendError(
  name: string,
  message: string,
  stack: string,
  errorType: 'browser:error' | 'browser:unhandledRejection'
): void {
  if (errorCount >= configuredMax) return;

  const normalizedStack = normalizeStack(stack);
  const hash = simpleHash(normalizedStack);

  // Dedup: skip if same stack seen in last 5 seconds
  flushExpired();
  if (recentHashes.has(hash)) return;
  recentHashes.set(hash, Date.now());
  errorCount++;

  void fetch(configuredEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      message,
      stack: normalizedStack,
      errorType,
      url: typeof location !== 'undefined' ? location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      timestamp: Date.now(),
    }),
    keepalive: true,
  }).catch(() => {
    // Silently ignore — never crash the app for error reporting
  });
}

/**
 * Report an error manually. Use this from React Error Boundaries
 * (including Next.js `error.tsx`) where errors don't bubble to `window.onerror`.
 *
 * ```tsx
 * import { reportError } from 'orkify/next/error-capture';
 * useEffect(() => { reportError(error); }, [error]);
 * ```
 */
export function reportError(error: unknown): void {
  if (!(error instanceof Error)) return;
  sendError(error.name || 'Error', error.message || '', error.stack || '', 'browser:error');
}

/**
 * Drop-in component that captures browser errors and reports them to orkify.
 * Add to your root layout:
 *
 * ```tsx
 * import { OrkifyErrorCapture } from 'orkify/next/error-capture';
 *
 * <OrkifyErrorCapture />
 * ```
 */
export function OrkifyErrorCapture({
  endpoint = '/orkify/errors',
  maxErrors = 10,
}: OrkifyErrorCaptureProps): null {
  useEffect(() => {
    configuredEndpoint = endpoint;
    configuredMax = maxErrors;

    const onError = (event: ErrorEvent): void => {
      const err = event.error;
      if (err instanceof Error) {
        sendError(err.name || 'Error', err.message || '', err.stack || '', 'browser:error');
      } else {
        sendError('Error', String(event.message || err), '', 'browser:error');
      }
    };

    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason = event.reason;
      if (reason instanceof Error) {
        sendError(
          reason.name || 'UnhandledRejection',
          reason.message || '',
          reason.stack || '',
          'browser:unhandledRejection'
        );
      } else {
        sendError('UnhandledRejection', String(reason), '', 'browser:unhandledRejection');
      }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [endpoint, maxErrors]);

  return null;
}
