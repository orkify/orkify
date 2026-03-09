import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { parseBrowserFrames, type StackFrame } from '../probe/parse-frames.js';
import { extractContext } from '../probe/resolve-sourcemaps.js';

// ── HMAC Token ──────────────────────────────────────────────────────────

/** Random signing key generated once per process start. Never exposed. */
const signingKey = randomBytes(32);

/**
 * Generate an HMAC token for the current hour.
 * Call from a server component and pass to `<OrkifyErrorCapture token={...} />`.
 */
export function getErrorToken(): string {
  const hourSlot = Math.floor(Date.now() / 3_600_000).toString();
  return createHmac('sha256', signingKey).update(hourSlot).digest('hex').slice(0, 32);
}

function isValidToken(token: string): boolean {
  if (token.length !== 32) return false;
  const tokenBuf = Buffer.from(token, 'utf8');
  const now = Math.floor(Date.now() / 3_600_000);
  // Accept current hour and previous hour (handles boundary crossing)
  for (const slot of [now, now - 1]) {
    const expected = Buffer.from(
      createHmac('sha256', signingKey).update(slot.toString()).digest('hex').slice(0, 32),
      'utf8'
    );
    if (timingSafeEqual(tokenBuf, expected)) return true;
  }
  return false;
}

// ── Rate Limiter ────────────────────────────────────────────────────────

const MAX_ERRORS_PER_WINDOW = 10;
const WINDOW_MS = 10_000;

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateLimits = new Map<string, RateBucket>();

/** Periodic cleanup to prevent unbounded Map growth. */
let cleanupTimer: null | ReturnType<typeof setInterval> = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateLimits) {
      if (bucket.resetAt <= now) rateLimits.delete(key);
    }
    if (rateLimits.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, 30_000);
  cleanupTimer.unref();
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateLimits.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    rateLimits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    ensureCleanupTimer();
    return false;
  }

  bucket.count++;
  return bucket.count > MAX_ERRORS_PER_WINDOW;
}

// ── Validation ──────────────────────────────────────────────────────────

const MAX_BODY_SIZE = 65_536; // 64 KB
const MAX_STACK_LINES = 100;

const browserErrorSchema = z.object({
  name: z.string().max(256),
  message: z.string().max(4096),
  stack: z.string().max(32_768),
  errorType: z.enum(['browser:error', 'browser:unhandledRejection']),
  url: z.string().max(2048),
  userAgent: z.string().max(512),
  timestamp: z.number(),
});

// ── Source Context Builder ──────────────────────────────────────────────

interface SourceContextFrame {
  file: string;
  line: number;
  column: number;
  pre: string[];
  target: string;
  post: string[];
}

function buildSourceContext(frames: StackFrame[]): SourceContextFrame[] {
  const result: SourceContextFrame[] = [];

  for (const frame of frames) {
    if (!existsSync(frame.file)) continue;

    try {
      const source = readFileSync(frame.file, 'utf8');
      const context = extractContext(source, frame.line);
      if (!context) continue;

      result.push({
        file: frame.file,
        line: frame.line,
        column: frame.column,
        pre: context.pre,
        target: context.target,
        post: context.post,
      });
    } catch {
      continue;
    }
  }

  return result;
}

// ── Request Handler ─────────────────────────────────────────────────────

function getClientIp(request: Request): string {
  // Cloudflare: most reliable, cannot be spoofed by the client
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  // Standard proxy headers
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return '127.0.0.1';
}

/**
 * Next.js API route handler for browser error reporting.
 *
 * Create `app/__orkify/errors/route.ts`:
 * ```ts
 * export { POST } from 'orkify/next/error-handler';
 * ```
 */
export async function POST(request: Request): Promise<Response> {
  try {
    // 1. Validate HMAC token
    const token = request.headers.get('x-orkify-token');
    if (!token || !isValidToken(token)) {
      return Response.json({ ok: false }, { status: 401 });
    }

    // 2. Check content length
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      return Response.json({ ok: false }, { status: 413 });
    }

    // 3. Validate origin
    // Behind reverse proxies (nginx, Cloudflare), Host may be the internal
    // address while Origin is the public domain. X-Forwarded-Host carries the
    // original Host header set by the proxy.
    const origin = request.headers.get('origin');
    const effectiveHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
    if (origin && effectiveHost) {
      try {
        const originHost = new URL(origin).host;
        // effectiveHost may include port (e.g. "example.com:443"), compare directly
        if (originHost !== effectiveHost) {
          return Response.json({ ok: false }, { status: 403 });
        }
      } catch {
        return Response.json({ ok: false }, { status: 403 });
      }
    }

    // 4. Rate limit
    const ip = getClientIp(request);
    if (isRateLimited(ip)) {
      return Response.json({ ok: false }, { status: 429 });
    }

    // 5. Parse and validate body
    const raw = await request.text();
    if (raw.length > MAX_BODY_SIZE) {
      return Response.json({ ok: false }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ ok: false }, { status: 400 });
    }

    const parsed = browserErrorSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ ok: false }, { status: 400 });
    }

    const data = parsed.data;

    // 6. Truncate stack to max lines
    const stackLines = data.stack.split('\n');
    const truncatedStack =
      stackLines.length > MAX_STACK_LINES
        ? stackLines.slice(0, MAX_STACK_LINES).join('\n')
        : data.stack;

    // 7. Parse browser stack → frames, map URLs to file paths
    const cwd = process.cwd();
    const frames = parseBrowserFrames(truncatedStack, cwd);

    // 8. Build source context from bundled files on disk
    const sourceContext = frames.length > 0 ? buildSourceContext(frames) : null;
    const topFrame = frames[0] ?? null;

    // 9. Relay to daemon via IPC
    if (typeof process.send === 'function') {
      process.send({
        __orkify: true,
        type: 'error',
        data: {
          errorType: data.errorType,
          name: data.name,
          message: data.message,
          stack: truncatedStack,
          fingerprint: '', // Daemon recomputes this
          sourceContext: sourceContext && sourceContext.length > 0 ? sourceContext : null,
          topFrame,
          diagnostics: null,
          timestamp: data.timestamp,
          nodeVersion: '',
          pid: 0,
          url: data.url,
          userAgent: data.userAgent,
        },
      });
    }

    return Response.json({ ok: true });
  } catch {
    // Never crash the app for error reporting
    return Response.json({ ok: true });
  }
}
