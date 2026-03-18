# @orkify/cache

[![npm](https://img.shields.io/npm/v/@orkify/cli)](https://www.npmjs.com/package/@orkify/cli)
[![Node](https://img.shields.io/node/v/orkify)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/orkify)](https://github.com/orkify/orkify/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-%E2%89%A55.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Framework-agnostic shared cache for [orkify](https://orkify.com)-managed Node.js processes.

## Installation

The cache is bundled with the CLI. Install `@orkify/cli` and import from `@orkify/cli/cache`:

```bash
npm install @orkify/cli
```

## Usage

```typescript
import { cache } from '@orkify/cache';

// Set a value
cache.set('user:123', { name: 'Alice', role: 'admin' });

// Set with TTL (seconds) and tags
cache.set('post:456', postData, { ttl: 300, tags: ['posts', 'user:123'] });

// Get a value (synchronous, local memory)
const user = cache.get<User>('user:123');

// Get with async fallback (checks file-backed cold layer)
const post = await cache.getAsync<Post>('post:456');

// Check existence
cache.has('user:123');

// Delete + broadcast to all workers
cache.delete('user:123');

// Clear all entries + broadcast
cache.clear();

// Invalidate all entries with a tag + record timestamp
cache.invalidateTag('posts');

// Query when a tag was last invalidated
cache.getTagExpiration(['posts']);

// Record a timestamp without deleting entries (stale-while-revalidate)
cache.updateTagTimestamp('posts');

// Cache stats
const stats = cache.stats();
// { size, hits, misses, hitRate, totalBytes, diskSize }
```

`get()` reads from memory only — always sync, zero overhead. `getAsync()` checks memory first, then falls back to disk if file-backed mode is enabled.

## Configuration

Optional — call `cache.configure()` before the first use, or defaults apply:

```typescript
import { cache } from '@orkify/cache';

cache.configure({
  maxEntries: 50_000, // Default: 10,000
  defaultTtl: 300, // Default: undefined (no expiry, seconds)
  maxMemorySize: 128 * 1024 * 1024, // Default: 64 MB per worker
  maxValueSize: 2 << 20, // Default: 1 MB
  fileBacked: true, // Default: true — evicted entries spill to disk
});
```

| Option          | Default                 | Description                                                              |
| --------------- | ----------------------- | ------------------------------------------------------------------------ |
| `maxEntries`    | `10,000`                | Maximum entries before LRU eviction kicks in                             |
| `defaultTtl`    | `undefined` (no expiry) | Default TTL in seconds for entries without an explicit `ttl`             |
| `maxMemorySize` | `64 MB`                 | Maximum memory per worker before byte-based LRU eviction                 |
| `maxValueSize`  | `1 MB`                  | Maximum byte size of a single value (rejects larger with an error)       |
| `fileBacked`    | `true`                  | Persist evicted entries to disk, survive restarts, read via `getAsync()` |

## How It Works

| Mode                       | Behavior                                                |
| -------------------------- | ------------------------------------------------------- |
| `npm run dev` (standalone) | Local cache + disk cold layer, no IPC                   |
| `orkify up -w 1` (fork)    | Local cache + disk cold layer, no IPC                   |
| `orkify up -w 4` (cluster) | Broadcast cache — writes sync via IPC, reads stay local |
| `orkify run` (foreground)  | Local cache + disk cold layer, no IPC                   |

The API is identical in every mode. In standalone or fork mode, it degrades gracefully to a plain local cache — no errors, no code changes needed. Deploy with `orkify up -w 4` and the same code syncs across workers automatically.

## Features

- LRU eviction (entry-count and byte-based)
- TTL expiration
- Tag-based group invalidation with timestamps
- V8 serialization (supports Map, Set, Date, RegExp, Error, ArrayBuffer, TypedArray)
- Value validation — rejects functions, symbols, and oversized values with descriptive errors
- Two-tier architecture: hot memory layer + cold file-backed layer
- Cluster-safe: automatic IPC synchronization across workers
- Snapshots sent to new workers on spawn
- Eventual consistency: other workers may read stale values for one IPC round trip after a write

For full details on eviction, persistence lifecycle, and cluster behavior, see the [main orkify README](https://github.com/orkify/orkify#shared-cluster-cache).

## Requirements

- Node.js 22+
- Must run under [orkify](https://github.com/orkify/orkify) for cluster mode features

## License

Apache-2.0
