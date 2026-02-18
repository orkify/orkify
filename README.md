<h1><img src="assets/icon.png" alt="" width="36" align="center" /> orkify</h1>

Modern JS process orchestration and deployment for your own infrastructure.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Options for `up` and `run`](#options-for-up-and-run)
- [Cluster Mode](#cluster-mode)
- [Zero-Downtime Reload](#zero-downtime-reload)
- [Worker Readiness](#worker-readiness)
- [Graceful Shutdown](#graceful-shutdown)
- [Socket.IO / WebSocket Support](#socketio--websocket-support)
- [Log Rotation](#log-rotation)
- [Environment Files](#environment-files)
- [Snapshot File](#snapshot-file)
- [Boot Persistence](#boot-persistence)
- [Container Mode](#container-mode)
- [Deployment](#deployment)
- [MCP Integration](#mcp-integration)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [License](#license)

## Features

- **Cluster Mode** - Run multiple workers sharing the same port using Node's cluster module
- **Cross-Platform Load Balancing** - True round-robin distribution across all workers on Linux, macOS, and Windows
- **Zero-Downtime Reload** - Rolling restarts that replace workers one-by-one with no dropped requests
- **WebSocket Sticky Sessions** - Built-in session affinity for Socket.IO and WebSocket connections
- **Process Persistence** - Save running processes and restore them after reboot
- **Auto-Restart** - Automatically restart crashed processes with configurable limits
- **File Watching** - Reload on file changes during development
- **Log Rotation** - Automatic log rotation with gzip compression and configurable retention
- **Deployment** - Local and remote deploy with automatic rollback
- **Native TypeScript** - Run `.ts` files directly with no build step (Node.js 22.18+)
- **Modern Stack** - Pure ESM, TypeScript, Node.js 22.18+
- **MCP Integration** - Built-in Model Context Protocol server for AI tool integration

## Installation

```bash
npm install
npm run build
```

## Quick Start

```bash
# Start a single process (daemon mode)
orkify up app.js

# TypeScript works out of the box — no build step
orkify up app.ts

# Start with one worker per CPU core
orkify up app.js -w 0

# Start with 4 clustered workers
orkify up app.js -w 4

# Start with a custom name
orkify up app.js -n my-api -w 4

# Enable file watching for development
orkify up app.js --watch

# Enable sticky sessions for Socket.IO
orkify up server.js -w 4 --sticky --port 3000

# Run in foreground (for containers like Docker/Kubernetes)
orkify run app.js -w 4
```

## Commands

| Command                          | Description                                      |
| -------------------------------- | ------------------------------------------------ |
| `orkify up <script>`             | Start a process (daemon mode)                    |
| `orkify down <name\|id\|all>`    | Stop process(es)                                 |
| `orkify run <script>`            | Run in foreground (for containers)               |
| `orkify restart <name\|id\|all>` | Hard restart (stop + start)                      |
| `orkify reload <name\|id\|all>`  | Zero-downtime rolling reload                     |
| `orkify list`                    | List all processes with status                   |
| `orkify list -v`                 | Verbose list (includes PIDs)                     |
| `orkify list --all-users`        | List processes from all users (requires sudo)    |
| `orkify logs [name]`             | View logs (-f to follow, -n lines, --err/--out)  |
| `orkify delete <name\|id\|all>`  | Stop and remove from process list                |
| `orkify flush [name\|id\|all]`   | Truncate logs and remove rotated archives        |
| `orkify snap [file] [--no-env]`  | Snapshot current process list                    |
| `orkify restore [file]`          | Restore previously saved processes (--no-remote) |
| `orkify kill`                    | Stop the daemon                                  |
| `orkify daemon-reload`           | Reload daemon code (snap → kill → restore)       |
| `orkify deploy pack [dir]`       | Create a deploy tarball                          |
| `orkify deploy local <tarball>`  | Deploy from a local tarball                      |
| `orkify deploy upload [dir]`     | Upload a build artifact for deployment           |
| `orkify mcp`                     | Start MCP server for AI tools                    |

## Options for `up` and `run`

```
-n, --name <name>         Process name
-w, --workers <number>  Number of workers (0 = CPU cores, -1 = CPUs-1)
--watch                   Watch for file changes and reload (up only)
--watch-paths <paths...>  Specific paths to watch (up only)
--cwd <path>              Working directory
--node-args="<args>"      Arguments passed to Node.js (quoted)
--args="<args>"           Arguments passed to your script (quoted)
--kill-timeout <ms>       Graceful shutdown timeout (default: 5000)
--max-restarts <count>    Max restart attempts (default: 10)
--min-uptime <ms>         Min uptime before restart counts (default: 1000)
--restart-delay <ms>      Delay between restarts (default: 100)
--sticky                  Enable sticky sessions for WebSocket/Socket.IO
--port <port>             Port for sticky routing (defaults to PORT env)
--reload-retries <count>  Retries per worker slot during reload (0-3, default: 3)
--health-check <path>     Health check endpoint (e.g. /health, requires --port)
--log-max-size <size>     Max log file size before rotation (default: 100M)
--log-max-files <count>   Rotated log files to keep (default: 90, 0 = no rotation)
--log-max-age <days>      Delete rotated logs older than N days (default: 90, 0 = no limit)
```

## Cluster Mode

When you specify `-w <workers>` with more than 1 worker, ORKIFY runs your app in cluster mode:

```bash
orkify up server.js -w 4
```

This spawns a primary process that manages 4 worker processes. All workers share the same port - Node's cluster module handles the load balancing automatically.

```
┌──────┬──────────┬─────────┬───┬───┬────────┬──────┬──────────┬────────┐
│ id   │ name     │ mode    │ ↺ │ ✘ │ status │ cpu  │ mem      │ uptime │
├──────┼──────────┼─────────┼───┼───┼────────┼──────┼──────────┼────────┤
│ 0    │ server   │ cluster │ 0 │ 0 │ online │ 0.0% │ 192.1 MB │ -      │
│ │    ├──────────┼─────────┼───┼───┼────────┼──────┼──────────┼────────┤
│ ├─ 0 │ worker 0 │         │ 0 │ 0 │ online │ 0.0% │ 48.2 MB  │ 5m     │
│ │    ├──────────┼─────────┼───┼───┼────────┼──────┼──────────┼────────┤
│ ├─ 1 │ worker 1 │         │ 0 │ 0 │ online │ 0.0% │ 47.9 MB  │ 5m     │
│ │    ├──────────┼─────────┼───┼───┼────────┼──────┼──────────┼────────┤
│ ├─ 2 │ worker 2 │         │ 0 │ 0 │ online │ 0.0% │ 48.1 MB  │ 5m     │
│ │    ├──────────┼─────────┼───┼───┼────────┼──────┼──────────┼────────┤
│ └─ 3 │ worker 3 │         │ 0 │ 0 │ online │ 0.0% │ 48.0 MB  │ 5m     │
└──────┴──────────┴─────────┴───┴───┴────────┴──────┴──────────┴────────┘
```

## Zero-Downtime Reload

The `reload` command performs a rolling restart:

1. Spawn a new worker
2. Wait for it to signal ready
3. Gracefully stop the old worker
4. Repeat for each worker

```bash
orkify reload my-api
```

During reload, there's always at least one worker handling requests - no downtime.

### Reload Failure Handling

Each worker slot gets up to N retries during reload (default 3, max 3, configurable with `--reload-retries`):

```bash
# Disable retries (immediate failure on first timeout)
orkify up app.js -w 4 --reload-retries 0

# Use 1 retry per slot
orkify up app.js -w 4 --reload-retries 1
```

If a new worker fails to become ready after all retries:

- The **old worker is kept alive** (no process loss)
- The worker is marked as **stale** — shown as `online (stale)` in `orkify list`
- Remaining worker slots are **aborted** to prevent cascading failures

Fix the issue and reload again — a successful reload clears all stale flags.

## Worker Readiness

orkify auto-detects when cluster workers start listening on a port via Node's `cluster` `listening` event — no extra code needed. If your app calls `server.listen()`, workers are automatically marked as `online`.

For background workers or queue consumers that **don't bind a port**, signal ready manually:

```javascript
// Only needed for apps that don't call server.listen()
if (process.send) {
  process.send('ready');
}
```

Both signals are equivalent — whichever arrives first marks the worker as `online`. If neither arrives within 30 seconds, the worker is marked as `errored`.

### Health Check Readiness

When `--health-check` is set (e.g. `--health-check /health`), orkify performs an HTTP readiness check **after** a worker signals ready but **before** declaring it online:

```bash
orkify up server.js -w 4 --port 3000 --health-check /health
```

The flow:

1. Worker signals ready (listening event or `process.send('ready')`)
2. orkify hits `http://localhost:{port}{healthCheck}` — retries up to 3 times with 1s delay
3. If 2xx response → worker is declared online (old worker can be stopped during reload)
4. If all retries fail → worker is treated as failed

This applies to **all reloads**, not just deploys. If `--health-check` is set but `--port` is not, the health check is skipped.

## Graceful Shutdown

Handle SIGTERM to gracefully drain connections:

```javascript
process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
```

## Socket.IO / WebSocket Support

For WebSocket applications, use the `--sticky` flag to ensure connections from the same client always route to the same worker:

```bash
orkify up socket-server.js -w 4 --sticky --port 3000
```

This extracts session IDs from Socket.IO handshakes and consistently routes connections to the same worker based on a hash of the session ID.

## Log Rotation

orkify automatically rotates process logs to prevent unbounded disk growth. Logs are written to `~/.orkify/logs/` and rotated when a file exceeds the size threshold or on the first write of a new day.

### How It Works

1. When a log file exceeds `--log-max-size` (default: 100 MB) or a new calendar day starts, orkify rotates the file
2. The rotated file is compressed with gzip in the background (typically ~90% compression)
3. Archives older than `--log-max-age` days are deleted
4. If the archive count still exceeds `--log-max-files`, the oldest are pruned

### Defaults

| Setting           | Default | Description                               |
| ----------------- | ------- | ----------------------------------------- |
| `--log-max-size`  | `100M`  | Rotate when file exceeds 100 MB           |
| `--log-max-files` | `90`    | Keep up to 90 rotated archives per stream |
| `--log-max-age`   | `90`    | Delete archives older than 90 days        |

With defaults, each process uses at most ~200 MB of log storage: one 100 MB active file + up to 90 compressed archives (~1 MB each).

### File Layout

```
~/.orkify/logs/
  myapp.stdout.log                            # active (current writes)
  myapp.stdout.log-20260215T091200.123.gz     # rotated + compressed
  myapp.stdout.log-20260216T143052.456.gz
  myapp.stderr.log                            # active stderr
  myapp.stderr.log-20260217T080000.789.gz
```

### Configuration

```bash
# Custom rotation settings
orkify up app.js --log-max-size 50M --log-max-files 30 --log-max-age 30

# Disable rotation (logs grow unbounded)
orkify up app.js --log-max-files 0

# Size accepts K, M, G suffixes
orkify up app.js --log-max-size 500K
orkify up app.js --log-max-size 1G
```

### Viewing Logs

```bash
# View last 100 lines (default)
orkify logs my-api

# View last 500 lines
orkify logs my-api -n 500

# Follow log output (stream new logs)
orkify logs my-api -f

# Show only stdout or stderr
orkify logs my-api --out
orkify logs my-api --err
```

### Flushing Logs

Truncate active log files and remove all rotated archives:

```bash
# Flush logs for all processes
orkify flush

# Flush logs for a specific process
orkify flush my-api
```

## Environment Files

ORKIFY supports loading environment variables from `.env` files using Node.js native `--env-file` flag (Node 20.6+). Pass it via `--node-args`:

```bash
# Daemon mode
orkify up app.js -w 4 --node-args="--env-file=.env"

# Foreground mode
orkify run app.js -w 4 --node-args="--env-file=.env"

# Multiple node args
orkify up app.js --node-args="--env-file=.env --max-old-space-size=4096"
```

The env file format:

```bash
# .env
DATABASE_URL=postgres://localhost:5432/mydb
API_KEY=secret-key-123
NODE_ENV=production
```

Environment variables are passed to both the primary process and all workers in cluster mode.

### Keeping Secrets Out of State

By default `orkify snap` persists the full process environment (including `process.env` inherited values like `PATH`, `HOME`, API keys, etc.) into `~/.orkify/snapshot.yml`. Use `--no-env` to omit environment variables from the snapshot:

```bash
# Start with env loaded from .env file
orkify up app.js -n my-api -w 4 --node-args="--env-file=.env"

# Save without baking env vars into snapshot.yml
orkify snap --no-env

# Snap to a custom file for use as a declarative config
orkify snap config/processes.yml
```

Processes restored via `orkify restore` after a `--no-env` snap will inherit the daemon's own environment. Combined with `--node-args "--env-file .env"`, secrets stay in your `.env` file and are never duplicated into the snapshot.

## Snapshot File

`orkify snap` writes a YAML file to `~/.orkify/snapshot.yml` by default. `orkify restore` reads from the same path.

```bash
# Save and restore — most common usage
orkify snap
orkify restore

# Custom file paths
orkify snap config/processes.yml
orkify restore config/processes.yml
```

### Restore behavior

When you run `orkify restore`, the behavior depends on whether an API key and deploy metadata are present:

1. **With `ORKIFY_API_KEY` + active deploy** — orkify first tries to restore from the remote deploy API. If the remote call fails, it falls back to the local snapshot file automatically.
2. **Without API key or deploy** — orkify goes straight to the local snapshot file (`~/.orkify/snapshot.yml`).
3. **`--no-remote`** — skips the remote deploy check entirely, always uses the local snapshot.

```bash
# Restore from remote deploy (if configured), otherwise snapshot
orkify restore

# Always use local snapshot, ignore remote deploy
orkify restore --no-remote
```

The file is plain YAML so you can hand-edit it and use it as a declarative config. Here's what it looks like:

```yaml
version: 1
processes:
  - name: 'my-api'
    script: '/app/dist/server.js'
    cwd: '/app'
    workerCount: 4
    execMode: 'cluster'
    watch: false
    env:
      NODE_ENV: 'production'
    nodeArgs:
      - '--max-old-space-size=4096'
    args: []
    killTimeout: 5000
    maxRestarts: 10
    minUptime: 1000
    restartDelay: 100
    sticky: false
    port: 3000
```

**Required fields:**

| Field       | Description                                               |
| ----------- | --------------------------------------------------------- |
| `processes` | Array of process configs                                  |
| `script`    | Path to the entry script (absolute, or relative to `cwd`) |

**Optional fields:**

| Field           | Default            | Description                                              |
| --------------- | ------------------ | -------------------------------------------------------- |
| `version`       | `1`                | Schema version                                           |
| `name`          | basename of script | Process name                                             |
| `cwd`           | daemon working dir | Working directory                                        |
| `workerCount`   | `1`                | Number of workers (1 = fork mode, >1 = cluster)          |
| `execMode`      | from `workerCount` | `"fork"` or `"cluster"`                                  |
| `watch`         | `false`            | Watch for file changes                                   |
| `watchPaths`    | —                  | Specific paths to watch                                  |
| `env`           | —                  | Environment variables                                    |
| `nodeArgs`      | —                  | Node.js CLI flags (e.g. `["--inspect"]`)                 |
| `args`          | —                  | Script arguments                                         |
| `killTimeout`   | `5000`             | Graceful shutdown timeout in ms                          |
| `maxRestarts`   | `10`               | Max auto-restart attempts                                |
| `minUptime`     | `1000`             | Min uptime before a restart counts toward the limit (ms) |
| `restartDelay`  | `100`              | Delay between restarts in ms                             |
| `sticky`        | `false`            | Enable sticky sessions for WebSocket/Socket.IO           |
| `port`          | —                  | Port for sticky session routing                          |
| `reloadRetries` | `3`                | Retries per worker slot during reload (0-3)              |
| `healthCheck`   | —                  | Health check endpoint path (e.g. `/health`)              |
| `logMaxSize`    | `104857600`        | Max log file size in bytes before rotation (100 MB)      |
| `logMaxFiles`   | `90`               | Max rotated log files to keep (0 = no rotation)          |
| `logMaxAge`     | `7776000000`       | Max age of rotated logs in ms (90 days, 0 = no limit)    |

A minimal config:

```yaml
version: 1
processes:
  - script: /app/dist/server.js
```

All string values are double-quoted in the generated file to prevent YAML type coercion (e.g. `"3000"` stays a string, not an integer). If you hand-edit the file, unquoted env values like `PORT: 3000` or `DEBUG: true` are automatically coerced back to strings when loaded. Quoting is still recommended to avoid surprises (e.g. `1.0` parses as `1`).

## Boot Persistence

To automatically restore processes after a server reboot, use the provided systemd service template.

```bash
# Find your orkify binary path
which orkify

# Copy the template unit (shipped with the npm package)
sudo cp $(npm root -g)/orkify/boot/systemd/orkify@.service /etc/systemd/system/

# If your orkify binary is not at /usr/local/bin/orkify, edit the unit file:
#   sudo systemctl edit orkify@  →  override ExecStart/ExecStop paths

# Enable for your user
sudo systemctl daemon-reload
sudo systemctl enable orkify@$(whoami)
```

The `@` template runs as the user you specify after the `@`. Replace `$(whoami)` with any username:

```bash
# Run as the "deploy" user
sudo systemctl enable orkify@deploy

# Run as "app"
sudo systemctl enable orkify@app
```

On boot the service calls `orkify restore` to bring back all snapshotted processes, and `orkify kill` on stop. Each user has their own isolated process list under `~/.orkify/`.

Make sure to snapshot your processes so there is something to restore:

```bash
orkify snap
```

To start immediately without rebooting:

```bash
sudo systemctl start orkify@$(whoami)
```

## Container Mode

Use `orkify run` for Docker, Kubernetes, or any container environment where you need the process in the foreground.

### Why `run` instead of `up`?

| Mode          | Command      | Use Case                                    |
| ------------- | ------------ | ------------------------------------------- |
| **Daemon**    | `orkify up`  | Development, servers, long-running services |
| **Container** | `orkify run` | Docker, Kubernetes, any PID 1 scenario      |

In containers, processes run as PID 1 and must handle signals directly. The `run` command:

- Runs in the foreground (no daemon)
- Properly forwards SIGTERM/SIGINT to child processes
- Exits with correct exit codes for orchestrators
- Supports graceful shutdown with configurable timeout

### Single Instance (Fork Mode)

Best for most containers where the orchestrator handles scaling:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm install && npm run build

CMD ["orkify", "run", "app.js", "--silent"]
```

```yaml
# docker-compose.yml
services:
  api:
    build: .
    deploy:
      replicas: 4 # Let Docker/K8s handle scaling
```

### Cluster Mode (Multi-Core Containers)

For containers with multiple CPUs where you want in-process clustering:

```dockerfile
CMD ["orkify", "run", "app.js", "-w", "4", "--silent"]
```

```yaml
# kubernetes deployment
spec:
  containers:
    - name: api
      command: ['orkify', 'run', 'app.js', '-w', '4', '--silent']
      resources:
        limits:
          cpu: '4' # Match -w count to CPU limit
```

### Socket.IO in Containers

```dockerfile
CMD ["orkify", "run", "server.js", "-w", "4", "--sticky", "--port", "3000", "--silent"]
```

### Container Options

The `run` command supports the same core options as `up`:

```
-n, --name <name>         Process name
-w, --workers <number>    Number of workers (cluster mode)
--cwd <path>              Working directory
--node-args="<args>"      Arguments passed to Node.js (quoted)
--args="<args>"           Arguments passed to your script (quoted)
--sticky                  Enable sticky sessions for Socket.IO
--port <port>             Port for sticky session routing
--kill-timeout <ms>       Graceful shutdown timeout (default: 5000)
--reload-retries <count>  Retries per worker slot during reload (0-3, default: 3)
--silent                  Suppress startup messages (cleaner container logs)
```

### Signal Handling

The `run` command properly handles container signals:

```
Container Orchestrator
        │
        │ SIGTERM (graceful stop)
        ▼
┌─────────────────┐
│   orkify run    │
│                 │──► Forwards SIGTERM to child
│  kill-timeout   │──► Waits up to --kill-timeout ms
│                 │──► SIGKILL if timeout exceeded
└────────┬────────┘
         │
         ▼
   Exit code 0 (graceful) or 143 (SIGTERM) or 137 (SIGKILL)
```

1. **SIGTERM/SIGINT/SIGHUP** → Forwarded to child process(es)
2. **Graceful shutdown** → Waits for `--kill-timeout` ms (default: 5000)
3. **SIGKILL fallback** → Force kills if child doesn't exit in time
4. **Exit codes** → Preserves child exit code (or 128 + signal number)

### Quick Reference

| Scenario               | Command                                                |
| ---------------------- | ------------------------------------------------------ |
| Simple container       | `orkify run app.js --silent`                           |
| Multi-core container   | `orkify run app.js -w 4 --silent`                      |
| Socket.IO in container | `orkify run app.js -w 4 --sticky --port 3000 --silent` |
| Development (verbose)  | `orkify run app.js`                                    |
| Long graceful shutdown | `orkify run app.js --kill-timeout 30000 --silent`      |

## Deployment

orkify includes built-in deployment with automatic rollback. Create a tarball of your project, deploy it locally or through [orkify.com](https://orkify.com), and orkify handles extract → install → build → symlink → reconcile → monitor.

### How It Works

1. **Pack** — `orkify deploy pack` creates a tarball of your project
2. **Deploy** — Deploy locally with `orkify deploy local`, or upload to [orkify.com](https://orkify.com) with `orkify deploy upload` and trigger from the dashboard
3. **Execute** — orkify extracts the artifact, runs install/build, and starts your app
4. **Monitor** — orkify watches for crashes after deploy and automatically rolls back if workers fail

### Deploy Quick Start

```bash
# First time: configure deploy settings (saved to orkify.yml)
orkify deploy upload --interactive

# Upload an artifact (defaults to current directory)
orkify deploy upload

# Upload from a specific directory
orkify deploy upload ./myapp

# Bump package.json patch version and upload (e.g. 1.0.0 → 1.0.1)
orkify deploy upload --npm-version-patch

# Explicit API key (alternative to ORKIFY_API_KEY env var)
orkify deploy upload --api-key orkify_xxx
```

#### Upload Options

| Flag                  | Description                                       |
| --------------------- | ------------------------------------------------- |
| `--interactive`       | Prompt for deploy settings (saved to orkify.yml)  |
| `--npm-version-patch` | Bump package.json patch version before upload     |
| `--api-key <key>`     | API key (alternative to `ORKIFY_API_KEY` env var) |
| `--api-host <url>`    | Override API host URL                             |

### Local Deploy

Deploy from a local tarball — useful for self-managed servers, air-gapped environments, and custom CI/CD pipelines.

```bash
# Create a deploy artifact
orkify deploy pack ./myapp --output myapp.tar.gz

# Copy to server and deploy
scp myapp.tar.gz server:~/
ssh server orkify deploy local myapp.tar.gz

# With environment variables
orkify deploy local myapp.tar.gz --env-file .env.production
```

### Deploy Configuration

Deploy configuration is stored in `orkify.yml` at your project root:

```yaml
version: 1

deploy:
  install: npm ci
  build: npm run build
  crashWindow: 30

processes:
  - name: api
    script: dist/server.js
    workerCount: 4
    sticky: true
    port: 3000
    healthCheck: /health
  - name: worker
    script: dist/worker.js
    workerCount: 2
```

The `deploy` section configures build/install steps. The `processes` section defines what gets started — the same format used by `orkify snap`.

### Deploy Options

| Field         | Description                                               |
| ------------- | --------------------------------------------------------- |
| `install`     | Install command (auto-detected: npm, yarn, pnpm, bun)     |
| `build`       | Build command (optional, runs after install)              |
| `crashWindow` | Seconds to monitor for crashes after deploy (default: 30) |

### Deploy Lifecycle

```
Pack → [Upload] → Extract → Install → Build → Reconcile → Monitor → Success
                                                                  │
                                                 Crash detected?  │
                                                                  ▼
                                                      Auto-rollback
```

On deploy (both local and remote), orkify **reconciles** running processes against the `processes` in `orkify.yml`:

- **New processes** are started
- **Unchanged processes** get a zero-downtime reload
- **Changed processes** (different script, worker count, etc.) are replaced
- **Removed processes** are stopped

The daemon keeps the previous release on disk. If workers crash within the monitoring window, orkify automatically rolls back to the previous version.

### orkify.com Platform

[orkify.com](https://orkify.com) is an optional paid companion that provides:

- **Deploy management** — Upload artifacts, trigger deploys, track rollout status
- **Real-time metrics** — CPU, memory, and event loop monitoring with historical data
- **Log streaming** — Centralized log aggregation from all your servers
- **Crash detection** — Automatic error capture with stack traces and context
- **Remote control** — Start, stop, restart, and reload processes from the dashboard
- **Secrets management** — Encrypted environment variables injected at deploy time
- **Multi-server** — Manage processes across all your servers from one dashboard

The CLI works standalone without orkify.com. Connect it by setting an API key:

```bash
ORKIFY_API_KEY=orkify_xxx orkify up app.js
```

## MCP Integration

ORKIFY includes a built-in [Model Context Protocol](https://modelcontextprotocol.io/) server, enabling AI assistants like Claude Code to manage your processes directly.

### Setup with Claude Code

Add to your Claude Code MCP settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "orkify": {
      "command": "orkify",
      "args": ["mcp"]
    }
  }
}
```

Or use the Claude Code `/mcp` command to add it interactively.

### Available MCP Tools

| Tool           | Description                                     |
| -------------- | ----------------------------------------------- |
| `up`           | Start a new process with optional configuration |
| `down`         | Stop process(es) by name, ID, or "all"          |
| `restart`      | Hard restart (stop + start)                     |
| `reload`       | Zero-downtime rolling reload                    |
| `delete`       | Stop and remove from process list               |
| `list`         | List all processes with status and metrics      |
| `listAllUsers` | List processes from all users (requires sudo)   |
| `logs`         | Get recent log lines from a process             |
| `snap`         | Snapshot process list for later restoration     |
| `restore`      | Restore previously saved processes              |
| `kill`         | Stop the ORKIFY daemon                          |

### Example Usage

Once configured, you can ask Claude to manage your processes:

- "Start my API server with 4 workers"
- "List all running processes"
- "Reload the web app with zero downtime"
- "Show me the logs for the worker process"
- "Stop all processes"

## Architecture

### Daemon Mode (`orkify up`)

```
┌─────────────────────────────────────────────────────────────┐
│                       CLI (orkify up)                       │
└─────────────────────────────┬───────────────────────────────┘
                              │ IPC (Unix Socket / Named Pipe)
┌─────────────────────────────▼───────────────────────────────┐
│                          Daemon                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                      Orchestrator                     │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│  ┌───────────────────────────▼───────────────────────────┐  │
│  │                    ManagedProcess                     │  │
│  │                                                       │  │
│  │  Fork Mode (-w 1):        Cluster Mode (-w N):        │  │
│  │  ┌─────────────┐          ┌─────────────────────┐     │  │
│  │  │   Child     │          │   ClusterWrapper    │     │  │
│  │  │   Process   │          │      (Primary)      │     │  │
│  │  └─────────────┘          │  ┌─────┐ ┌─────┐    │     │  │
│  │                           │  │ W1  │ │ W2  │    │     │  │
│  │                           │  └─────┘ └─────┘    │     │  │
│  │                           │  ┌─────┐ ┌─────┐    │     │  │
│  │                           │  │ W3  │ │ W4  │    │     │  │
│  │                           │  └─────┘ └─────┘    │     │  │
│  │                           └─────────────────────┘     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Container Mode (`orkify run`)

```
┌─────────────────────────────────────────────────────────────┐
│                    Container (PID 1)                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   orkify run                          │  │
│  │                                                       │  │
│  │  Fork Mode (-w 1):        Cluster Mode (-w N):        │  │
│  │  ┌─────────────┐          ┌─────────────────────┐     │  │
│  │  │   Child     │◄─SIGTERM │   ClusterWrapper    │     │  │
│  │  │   Process   │          │      (Primary)      │     │  │
│  │  └─────────────┘          │  ┌─────┐ ┌─────┐    │     │  │
│  │                           │  │ W1  │ │ W2  │◄─SIGTERM │  │
│  │                           │  └─────┘ └─────┘    │     │  │
│  │                           └─────────────────────┘     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Requirements

- Node.js 22.18.0 or higher
- **Cross-platform:** macOS, Linux, Windows (uses Unix sockets on macOS/Linux, Named Pipes on Windows)

## License

Apache License 2.0 - see [LICENSE](LICENSE) for details.
