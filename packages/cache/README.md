<h1><img src="../../assets/icon.png" alt="" width="36" align="center" /> @orkify/cache</h1>

[![Beta](https://img.shields.io/badge/status-beta-yellow)](https://github.com/orkify/orkify)
[![CI](https://github.com/orkify/orkify/actions/workflows/ci.yml/badge.svg)](https://github.com/orkify/orkify/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@orkify/cache)](https://www.npmjs.com/package/@orkify/cache)
[![Node](https://img.shields.io/node/v/@orkify/cache)](https://nodejs.org/)
[![License](https://img.shields.io/npm/l/@orkify/cache)](https://github.com/orkify/orkify/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-%E2%89%A55.9-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Framework-agnostic shared cache for [orkify](https://orkify.com)-managed Node.js processes & clusters. On a single server, reads are faster than localhost Redis — they're synchronous Map lookups with no network round trip, no serialization, and no async overhead.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Sync vs Async Reads](#sync-vs-async-reads)
- [Configuration](#configuration)
- [How It Works](#how-it-works)
- [Tag-Based Invalidation](#tag-based-invalidation)
- [Cluster Mode Details](#cluster-mode-details)
- [Persistence](#persistence)
- [Eviction](#eviction)
- [Validation](#validation)
- [Requirements](#requirements)
- [License](#license)

## Installation

```bash
npm install @orkify/cache
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

## Sync vs Async Reads

`get()` reads from memory only — always sync, zero overhead. `getAsync()` checks memory first, then falls back to disk if file-backed mode is enabled. Without file-backed mode, `getAsync()` is identical to `get()` (just wrapped in a resolved promise, no disk I/O).

```typescript
cache.set('key', 'value'); // stored in memory
cache.get('key'); // sync — in-memory only
await cache.getAsync('key'); // async — memory first, disk fallback

// In async handlers, prefer getAsync to catch cold entries:
app.get('/api/user/:id', async (req, res) => {
  const key = `user:${req.params.id}`;
  let user = await cache.getAsync<User>(key);

  if (!user) {
    user = await db.users.findById(req.params.id);
    cache.set(key, user, { ttl: 300, tags: [`org:${user.orgId}`] });
  }

  res.json(user);
});
```

## Configuration

Optional — call `cache.configure()` before the first use, or defaults apply:

```typescript
import { cache } from '@orkify/cache';

cache.configure({
  maxEntries: 50_000, // default: 10,000
  defaultTtl: 300, // default: no expiry (seconds)
  maxMemorySize: 100 * 1024 * 1024, // default: 64 MB per worker
  maxValueSize: 2 << 20, // default: 1 MB
  fileBacked: true, // default: true — evicted entries spill to disk
});
```

| Option          | Default                 | Description                                                                    |
| --------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `maxEntries`    | `10,000`                | Maximum entries before LRU eviction kicks in                                   |
| `defaultTtl`    | `undefined` (no expiry) | Default TTL in seconds for entries without an explicit `ttl`                   |
| `fileBacked`    | `true`                  | Persist evicted entries to disk, survive restarts, read via `getAsync()`       |
| `maxMemorySize` | `67,108,864` (64 MB)    | Memory limit in bytes per worker for LRU eviction                              |
| `maxValueSize`  | `1,048,576` (1 MB)      | Maximum byte size of a single serialized value                                 |
| `tags`          | `undefined`             | String tags for `set()` — used with `invalidateTag()` for grouped invalidation |

The cache is file-backed by default — evicted entries spill to disk and the cache survives restarts. The sync `get()` path is unaffected (pure Map lookup, zero disk I/O). Disk reads only happen on `getAsync()` for entries not in memory. To disable the disk layer: `cache.configure({ fileBacked: false })`.

## How It Works

| Mode                       | Behavior                                                |
| -------------------------- | ------------------------------------------------------- |
| `npm run dev` (standalone) | Local cache + disk cold layer, no IPC                   |
| `orkify up -w 1` (fork)    | Local cache + disk cold layer, no IPC                   |
| `orkify up -w 4` (cluster) | Broadcast cache — writes sync via IPC, reads stay local |
| `orkify run` (foreground)  | Local cache + disk cold layer, no IPC                   |

The API is identical in every mode. In standalone or fork mode, it degrades gracefully to a plain local cache — no errors, no code changes needed. You can use `@orkify/cache` during local development with `node app.js` or `npm run dev` and it works as a regular Map. Deploy with `orkify up -w 4` and the same code now syncs across workers automatically.

## Tag-Based Invalidation

Tags let you group cache entries for bulk invalidation. A key can have multiple tags, and `invalidateTag()` deletes all entries with that tag across all workers:

```typescript
// Tag entries when setting them
cache.set('config:proj1:hostA', configA, { ttl: 300, tags: ['project:proj1'] });
cache.set('config:proj1:hostB', configB, { ttl: 300, tags: ['project:proj1'] });

// Later, invalidate everything for that project
cache.invalidateTag('project:proj1'); // deletes both keys, syncs across workers
```

Use cases:

- **Grouped config**: Invalidate all cached config for a project when settings change
- **User sessions**: Invalidate all cached data for a user on logout
- **Deployment**: Clear all cached data for a service on deploy

Tags are strings. A key can have multiple tags (`tags: ['project:1', 'org:5']`), and invalidating either tag deletes the key. Tags are preserved across daemon restarts and survive `orkify reload`.

### Tag Timestamps

Every `invalidateTag()` call records when the tag was last invalidated. Query it with `getTagExpiration()`:

```typescript
cache.invalidateTag('project:proj1');

// Returns the most recent invalidation timestamp (epoch ms) across the given tags
cache.getTagExpiration(['project:proj1']); // e.g. 1709510400000
cache.getTagExpiration(['unknown-tag']); // 0 (never invalidated)

// Multiple tags — returns the max timestamp
cache.getTagExpiration(['project:proj1', 'org:5']); // highest of the two
```

Use `updateTagTimestamp()` to record a timestamp without deleting entries — useful for stale-while-revalidate patterns where entries stay alive but are marked for background refresh:

```typescript
cache.updateTagTimestamp('group'); // records Date.now()
cache.updateTagTimestamp('group', futureTimestamp); // explicit timestamp
```

Tag timestamps sync across workers via IPC, persist across daemon restarts, and survive `orkify reload`.

## Cluster Mode Details

In cluster mode (`orkify up -w 4`), the cache uses orkify's built-in IPC:

1. Worker A calls `cache.set('key', value)` → stores locally (optimistic) + sends to primary
2. Primary stores the value, computes `expiresAt`, broadcasts to **all** workers
3. Every worker (including A) applies the update — all converge to the same state

The primary serializes writes, so concurrent sets to the same key always resolve to a consistent last-write-wins value. New workers joining (on spawn or reload) receive a full cache snapshot immediately so they start warm.

### Consistency Model

The cache is **eventually consistent**. Other workers may read a stale value for one IPC round trip after a write. For most use cases (session data, rendered pages, API responses) this is fine. If you need strict consistency, use a database.

## Persistence

In cluster mode, the cache persists across daemon restarts and stays in memory across `orkify reload`. No configuration needed.

- **`orkify reload`** — the primary stays alive, new workers receive the cache via IPC snapshot. No disk I/O, no data loss.
- **`orkify daemon-reload`** / **`orkify kill`** — the cache is written to `~/.@orkify/cache/<name>.json` before the daemon exits. The new primary restores it on startup, so workers start warm.
- **Worker crash** — the replacement worker gets a snapshot from the primary immediately.
- **`orkify down`** — the cache is **not** persisted. Stopping a process is an explicit action — restoring potentially stale data (old sessions, revoked tokens, expired API responses) on a later `orkify up` would cause more problems than it solves.
- **`orkify kill --force`** — the cache is **not** persisted. Force kill sends SIGKILL with no graceful shutdown.
- **Daemon crash** — the cache is **not** persisted. Crash recovery restores process configs but the cache starts empty.

| Scenario               | Cache behavior                                          |
| ---------------------- | ------------------------------------------------------- |
| `orkify reload`        | Warm — workers get snapshot from primary, zero downtime |
| `orkify daemon-reload` | Persisted to disk, restored on new daemon startup       |
| `orkify kill`          | Persisted to disk, restored on next daemon startup      |
| `orkify kill --force`  | Cache lost (SIGKILL, no graceful shutdown)              |
| Worker crash           | Replacement gets snapshot from primary                  |
| `orkify down`          | Cache starts empty (clean slate)                        |
| Daemon crash           | Cache starts empty (crash recovery doesn't persist)     |

Cache files are stored per process at `~/.@orkify/cache/` as JSON. Tags and V8 types (Map, Set, Date, etc.) are preserved correctly across restarts.

In standalone/fork mode, the cache persists to `~/.@orkify/cache/<name>/` by default and survives restarts. Use `getAsync()` to access cold entries that may be on disk. With `fileBacked: false`, the cache lives only in memory.

The disk layer (on by default) works as follows:

- Entries evicted from memory spill to disk automatically (`~/.@orkify/cache/<name>/entries/`)
- On shutdown (`orkify kill`), remaining in-memory entries are flushed to disk
- On startup, only the disk index is loaded — entries promote lazily to memory on access via `getAsync()`
- Disk entries have their own TTL and tag expiration checks — stale entries are cleaned up on read and by periodic sweeps

In **cluster mode**, the primary process owns the disk layer (reads and writes). Workers can read directly from disk files for fast cold reads without IPC. Writes still go through IPC to the primary.

In **fork/standalone mode**, the single process owns the disk layer directly. On graceful shutdown, all in-memory entries are flushed to disk synchronously so the cache survives restarts.

## Eviction

- **Entry-count LRU**: When `maxEntries` is reached, the least recently accessed entry is evicted on the next write
- **Byte-based LRU**: Evicts by total memory usage (default 64 MB per worker) in addition to entry count
- **TTL expiry**: Expired entries are cleaned up lazily on read and by a background sweep every 60 seconds
- **Disk persistence**: Evicted entries persist on disk (by default) and are promoted back to memory on access via `getAsync()`
- **Value size limit**: `set()` rejects values exceeding `maxValueSize` (default 1 MB) with a descriptive error

## Validation

`set()` validates values before storing:

```typescript
// Throws — exceeds size limit
cache.set('huge', 'x'.repeat(2_000_000)); // Error: exceeds max 1048576 bytes

// Throws — invalid TTL
cache.set('key', 'value', { ttl: -1 }); // Error: ttl must be positive

// Throws — functions and symbols are not serializable
cache.set('fn', () => {}); // Error
```

Values can be any structured-cloneable type: plain objects, arrays, strings, numbers, booleans, `null`, `Map`, `Set`, `Date`, `RegExp`, `Error`, `ArrayBuffer`, and `TypedArray`. JSON-serializable values use JSON internally; complex types (Map, Set, Date, etc.) automatically use V8 serialization. Only functions and symbols are rejected.

## Requirements

- Node.js 22+
- Must run under [orkify](https://github.com/orkify/orkify) for cluster mode features

## License

Apache-2.0
