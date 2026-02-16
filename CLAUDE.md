# CLAUDE.md

This file provides context for Claude Code when working on this project.

## Project Overview

ORKIFY provides modern JS process orchestration and deployment for your own infrastructure. It provides cluster mode with proper port sharing, zero-downtime reloads, and built-in WebSocket/Socket.IO sticky session support.

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Module System**: Pure ESM
- **Node.js**: 22+ (minimum)
- **No config files**: All options via CLI flags

## Project Structure

```
orkify/
├── bin/orkify                    # CLI entry point (shebang script)
├── src/
│   ├── cli/
│   │   ├── index.ts            # Commander.js CLI setup
│   │   └── commands/           # Individual command files
│   ├── daemon/
│   │   ├── index.ts            # Daemon entry point
│   │   ├── Orchestrator.ts      # Main orchestrator
│   │   ├── ManagedProcess.ts   # Manages individual processes
│   │   ├── GracefulManager.ts  # Coordinates reloads
│   │   └── SocketIOManager.ts  # Connection tracking
│   ├── cluster/
│   │   ├── ClusterWrapper.ts   # Primary process for cluster mode
│   │   ├── Primary.ts          # Cluster primary utilities
│   │   ├── Worker.ts           # Worker utilities
│   │   └── StickyBalancer.ts   # Session-based routing
│   ├── ipc/
│   │   ├── DaemonClient.ts     # CLI → Daemon communication
│   │   ├── DaemonServer.ts     # Daemon IPC server
│   │   └── protocol.ts         # Message serialization
│   ├── state/
│   │   └── StateStore.ts       # Process persistence
│   ├── config/
│   │   └── schema.ts           # Zod validation schemas
│   ├── types/
│   │   └── index.ts            # TypeScript interfaces
│   └── constants.ts            # Paths, timeouts, defaults
└── examples/                   # Demo applications
```

## Build Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode compilation
npm run clean        # Remove dist/
```

## Linting & Testing

```bash
npm run lint         # Run ESLint
npm run lint:fix     # Auto-fix lint issues
npm run format       # Format with Prettier
npm run format:check # Check formatting
npm run knip         # Find dead code/dependencies
npm run test         # Run unit tests
npm run test:watch   # Run unit tests in watch mode
npm run test:coverage # Run unit tests with coverage
npm run test:e2e     # Run integration/e2e tests (requires build)
npm run typecheck    # TypeScript type check
npm run check        # Run all checks (typecheck + lint + knip + format + test with coverage)
npm run audit        # Security audit (fails on high/critical only)
```

## Git Hooks (Husky)

**Pre-commit:** Runs lint-staged (ESLint + Prettier on staged files)

**Commit-msg:** Validates commit message format (conventional commits)

## Pre-Commit Checks

**Always run `npm run check` before committing.** This runs typecheck + lint + knip + format check + tests with coverage. Do not commit if any check fails.

## Commit Message Format

Uses [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`

Examples:

```
feat: add zero-downtime reload
fix(cluster): handle worker crash gracefully
docs: update README with examples
chore: update dependencies
```

**Important:** Do NOT add `Co-Authored-By` or similar footers. Keep commits simple: a clear title and a brief summary of what was done.

## Key Architectural Decisions

### Daemon Architecture

- CLI and daemon are separate processes
- Cross-platform IPC via Node's `net` module:
  - Unix socket on macOS/Linux: `~/.orkify/orkify.sock`
  - Named Pipe on Windows: `\\.\pipe\orkify-{username}`
- Socket/pipe namespaced per user for multi-user support
- Daemon auto-starts when CLI needs it
- State persisted to `~/.orkify/snapshot.yml`

### Cluster Mode Implementation

- When workers > 1, ManagedProcess spawns `ClusterWrapper.ts`
- ClusterWrapper is the cluster primary, uses `cluster.fork()` for workers
- Workers share the port automatically via Node's cluster module
- Rolling reload: spawn new → wait ready → kill old → repeat

### Fork vs Cluster Mode

- **Fork mode** (workers=1): Direct child process via `fork()`
- **Cluster mode** (workers>1): ClusterWrapper primary + N workers

### IPC Protocol

- JSON messages delimited by newlines
- Request/response with UUID correlation
- Streaming support for logs

## Testing Manually

```bash
# Build first
npm run build

# Start a process (daemon mode)
./bin/orkify up examples/basic/app.js -n test

# Start clustered (daemon mode)
./bin/orkify up examples/cluster/app.js -n cluster -w 4

# Run in foreground (container mode)
./bin/orkify run examples/basic/app.js -n test

# Test zero-downtime reload
./bin/orkify reload cluster

# Check status
./bin/orkify list

# View logs
./bin/orkify logs test

# Clean up
./bin/orkify down all
./bin/orkify kill
```

## Important Files

| File                            | Purpose                                    |
| ------------------------------- | ------------------------------------------ |
| `src/daemon/Orchestrator.ts`    | Central orchestrator, handles all commands |
| `src/daemon/ManagedProcess.ts`  | Manages a single process (fork or cluster) |
| `src/cluster/ClusterWrapper.ts` | Cluster primary that manages workers       |
| `src/ipc/DaemonClient.ts`       | CLI-side IPC, auto-starts daemon           |
| `src/ipc/DaemonServer.ts`       | Daemon-side IPC server                     |

## Environment Variables Set for Managed Processes

| Variable              | Description                 |
| --------------------- | --------------------------- |
| `ORKIFY_PROCESS_ID`   | Process ID in ORKIFY        |
| `ORKIFY_PROCESS_NAME` | Process name                |
| `ORKIFY_WORKER_ID`    | Worker ID (0 for fork mode) |
| `ORKIFY_CLUSTER_MODE` | "true" if cluster mode      |
| `ORKIFY_WORKERS`      | Number of workers           |

## Signaling Ready

orkify auto-detects when cluster workers start listening on a port — no boilerplate needed. For apps that don't bind a port (background workers, queue consumers), signal manually:

```javascript
if (process.send) {
  process.send('ready');
}
```

Both signals (listening event and manual ready) are equivalent. If neither arrives within 30s, the worker is marked as errored.

## Reload Retry & Stale Workers

During a rolling reload (`orkify reload`), each worker slot gets up to N retries (0-3, default 3, configurable via `--reload-retries`). The per-slot flow is:

1. Spawn new worker
2. Wait for ready signal (30s timeout)
3. If timeout: kill new worker, retry from step 1
4. If all retries exhausted: keep old worker alive, mark it **stale**, abort remaining slots

Stale workers are shown as `online (stale)` in `orkify list`. A subsequent successful reload clears all stale flags.

Key implementation details:

- `ClusterWrapper.reload()` uses a try-finally to always reset `isReloading`
- `waitForReady()` rejects on timeout (instead of resolving) and cleans up its polling interval
- `reload:complete` IPC message includes per-slot results (`success` / `stale`)
- `ManagedProcess` propagates stale flags via `WorkerState.stale` and `getInfo()`
- The `--reload-retries` option is passed to ClusterWrapper via `ORKIFY_RELOAD_RETRIES` env var

## Common Issues

1. **Port already in use**: Another process is using the port. Stop it first.
2. **Daemon not responding**: Kill stale daemon with `orkify kill` or remove `~/.orkify/orkify.sock`
3. **Workers not showing**: Workers take a moment to spawn. Wait and run `orkify list` again.
