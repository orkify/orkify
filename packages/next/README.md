<h1><img src="../../assets/icon.png" alt="" width="36" align="center" /> @orkify/next</h1>

[![Beta](https://img.shields.io/badge/status-beta-yellow)](https://github.com/orkify/orkify)
[![CI](https://github.com/orkify/orkify/actions/workflows/ci.yml/badge.svg)](https://github.com/orkify/orkify/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@orkify/next)](https://www.npmjs.com/package/@orkify/next)
[![Node](https://img.shields.io/node/v/@orkify/next)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/@orkify/next)](https://github.com/orkify/orkify/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-%E2%89%A55.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Next.js integration for [orkify](https://orkify.com) — cache handlers and browser error tracking.

## Table of Contents

- [Installation](#installation)
- [Cache Handlers](#cache-handlers)
- [Build & Deploy](#build--deploy)
- [Browser Error Tracking](#browser-error-tracking)
- [Server Actions Encryption Key](#server-actions-encryption-key)
- [Security Header Stripping](#security-header-stripping)
- [Version Skew Protection](#version-skew-protection)
- [Requirements](#requirements)
- [License](#license)

## Installation

```bash
npm install @orkify/next
```

[![@orkify/cache](https://img.shields.io/npm/v/@orkify/cache?label=%40orkify%2Fcache)](https://www.npmjs.com/package/@orkify/cache) is installed automatically as a dependency.

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

## Build & Deploy

orkify deploys require `output: 'standalone'` in your Next.js config — this produces a self-contained build with all dependencies traced and bundled:

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  output: 'standalone',
  // ... rest of config
};
```

The standalone output doesn't include `public/` or `.next/static/`, so copy them after building. In your `orkify.yml`:

```yaml
deploy:
  install: npm ci
  build: >
    npm run build &&
    cp -r .next/static .next/standalone/.next/static &&
    cp -r public/. .next/standalone/public
processes:
  - name: app
    script: .next/standalone/server.js
    execMode: cluster
```

The entry point is `.next/standalone/server.js` — a minimal Node.js server that Next.js generates from the traced dependencies.

### Handler Details

- **`@orkify/next/use-cache`** — handles `'use cache'` directives. Converts between Next.js's stream-based interface and orkify's synchronous cache. Implements staleness checks (hard expiry, revalidation window, soft tags).
- **`@orkify/next/isr-cache`** — handles ISR / route cache. Simpler adapter: get, set, tag-based revalidation.

Both work standalone (`npm run dev`) and in cluster mode — the cache detects the mode automatically.

`revalidateTag()` calls in your Next.js app flow through orkify's cache, which broadcasts tag invalidations to all cluster workers via IPC:

```typescript
// app/actions.ts
'use server';
import { revalidateTag } from 'next/cache';

export async function refreshPosts() {
  revalidateTag('posts'); // invalidates across all workers
}
```

### ISR Request Coalescing

In cluster mode, multiple workers may detect the same stale cache entry simultaneously. Without coalescing, N workers trigger N parallel revalidations for the same page.

orkify uses the shared cache as a distributed lock. When a worker detects staleness, it sets a short-lived `__revalidating:{key}` flag. Other workers seeing this flag serve stale content instead of triggering their own revalidation. The lock auto-expires after 30 seconds and is cleared when the fresh entry is stored.

- Hard expiration: **not coalesced** (entry is genuinely expired, must be regenerated)
- Soft tag invalidation: **not coalesced** (explicit invalidation should always miss)
- Revalidation window: **coalesced** (stale-while-revalidate semantics)

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
  // Turbopack is default in Next.js 16; empty config silences the
  // "webpack config without turbopack config" error during builds.
  turbopack: {},
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

## Server Actions Encryption Key

Next.js encrypts Server Action payloads. If the key differs between cluster workers or across rolling reloads, Server Actions fail with cryptic decryption errors. orkify auto-generates a stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` when it detects a Next.js app:

- Generated once at process creation and stored in config
- Consistent across all cluster workers (shared via `config.env`)
- Survives reloads and daemon restarts (persisted in the snapshot file)
- Skipped if you provide your own key via `--env` or shell environment

## Security Header Stripping

orkify strips dangerous headers from external requests before they reach your app:

| Header                    | CVE                       | Risk                                       |
| ------------------------- | ------------------------- | ------------------------------------------ |
| `x-middleware-subrequest` | CVE-2025-29927 (CVSS 9.1) | Bypasses Next.js middleware authentication |
| `x-now-route-matches`     | CVE-2024-46982            | Cache poisoning via Vercel routing         |

Headers are preserved on loopback requests (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) since Next.js uses them internally. Active in fork mode, cluster mode, and run mode with no configuration needed.

## Version Skew Protection

During `orkify deploy`, old and new workers coexist briefly. If client-side bundle hashes changed, a user who loaded a page from an old worker may request assets that only exist in the new version.

orkify auto-sets `NEXT_DEPLOYMENT_ID` during deploy (format: `v{version}-{artifactSlice}`). Next.js uses this to tag asset URLs and handle version mismatches gracefully. If you set `NEXT_DEPLOYMENT_ID` in your secrets, orkify won't overwrite it.

## Requirements

- Node.js 22+
- Next.js 15+ (16+ for `use cache`)
- Must run under [![@orkify/cli](https://img.shields.io/npm/v/@orkify/cli?label=%40orkify%2Fcli)](https://www.npmjs.com/package/@orkify/cli) ([GitHub](https://github.com/orkify/orkify)) for error tracking to reach the dashboard

## License

Apache-2.0
