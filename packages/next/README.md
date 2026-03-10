# @orkify/next

[![npm](https://img.shields.io/npm/v/@orkify/next)](https://www.npmjs.com/package/@orkify/next)
[![Node](https://img.shields.io/node/v/orkify)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/orkify)](https://github.com/orkify/orkify/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-%E2%89%A55.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Next.js integration for [orkify](https://orkify.com) — cache handlers and browser error tracking.

## Installation

```bash
npm install @orkify/next @orkify/cache
```

## Cache Handlers

orkify replaces Next.js's default cache with a shared in-memory cache that works across cluster workers. Both handlers use `@orkify/cache` under the hood — tag invalidation (`revalidateTag()`) propagates across all workers automatically.

### Setup

```typescript
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable 'use cache' directives (required for Next.js 16)
  cacheComponents: true,

  // Next.js 16 'use cache' directives — backed by @orkify/cache
  cacheHandlers: {
    default: require.resolve('@orkify/next/use-cache'),
  },

  // ISR / route cache — backed by @orkify/cache
  cacheHandler: require.resolve('@orkify/next/isr-cache'),

  // Disable Next.js's built-in in-memory cache (orkify handles it)
  cacheMaxMemorySize: 0,

  // Version skew protection — auto-set by `orkify deploy`, optional for `orkify up/run`
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || undefined,
};

export default nextConfig;
```

### Handler Details

- **`@orkify/next/use-cache`** — handles `'use cache'` directives. Converts between Next.js's stream-based interface and orkify's synchronous cache. Implements staleness checks (hard expiry, revalidation window, soft tags).
- **`@orkify/next/isr-cache`** — handles ISR / route cache. Simpler adapter: get, set, tag-based revalidation.

Both work standalone (`npm run dev`) and in cluster mode — the cache detects the mode automatically.

### ISR Request Coalescing

In cluster mode, multiple workers may detect the same stale entry simultaneously. orkify coalesces these using a `__revalidating:{key}` flag so only one worker triggers the revalidation. The flag auto-expires after 30 seconds.

## Browser Error Tracking

Capture browser errors and route them through orkify's error pipeline. Errors appear on the dashboard alongside server errors — no additional services needed. Errors bundle with the regular telemetry flush — zero additional API calls.

### Setup

**1. Add the capture component** to your root layout:

```tsx
// app/layout.tsx
import { OrkifyErrorCapture } from '@orkify/next/error-capture';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <OrkifyErrorCapture />
      </body>
    </html>
  );
}
```

**2. Create the API route** at `app/orkify/errors/route.ts`:

```typescript
export { POST } from '@orkify/next/error-handler';
```

**3. Enable source maps** for source-mapped stacks on the dashboard:

```typescript
// next.config.ts — add to the config above
const nextConfig: NextConfig = {
  // ... cache handler config from above

  experimental: {
    serverSourceMaps: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.devtool = 'hidden-source-map';
    }
    return config;
  },
};
```

`hidden-source-map` produces `.map` files on disk without exposing them to browsers. orkify reads these files server-side to resolve minified stacks.

### Error Boundaries

Errors caught by React Error Boundaries (including Next.js `error.tsx`) don't bubble to `window.onerror`. Use `reportError()` to capture them:

```tsx
// app/error.tsx
'use client';
import { reportError } from '@orkify/next/error-capture';
import { useEffect } from 'react';

export default function ErrorPage({ error }: { error: Error }) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return <p>Something went wrong.</p>;
}
```

### What's Captured

- `window.onerror` — uncaught exceptions
- `unhandledrejection` — unhandled promise rejections
- Manual `reportError()` calls from error boundaries

Each error includes: name, message, stack trace, page URL, and browser info.

### Security

- **Origin validation**: Rejects cross-origin requests. Supports `X-Forwarded-Host` for reverse proxy setups.
- **Rate limiting**: Max 10 errors per 10 seconds per IP
- **Payload validation**: Zod schema, 64 KB body limit, 100 stack line cap
- **No data reflection**: Response is always `{ ok: true }` — never echoes input

### Stack Normalization

Firefox and Safari stacks are automatically normalized to V8 format (`at fn (file:line:col)`) before sending, so the entire downstream pipeline handles one format.

### How It Works

```
Browser → POST /orkify/errors → API route handler → process.send() → orkify daemon → dashboard
```

Errors flow through the same IPC path as server errors and bundle with the regular telemetry flush. Zero additional API calls.

For full details on security headers, version skew protection, and the server actions encryption key, see the [main orkify README](https://github.com/orkify/orkify#nextjs-support).

## Requirements

- Node.js 22+
- Next.js 15+ (16+ for `use cache`)
- Must run under [orkify](https://github.com/orkify/orkify) for error tracking to reach the dashboard

## License

Apache-2.0
