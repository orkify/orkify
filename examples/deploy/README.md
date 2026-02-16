# Deploy Example

A Next.js app that demonstrates the orkify deploy workflow and doubles as an error-chaos testing tool. Features a live dashboard with stats polling, error trigger buttons, and an activity log.

## Local testing

```bash
# Install and build
npm install
npm run build

# Start with orkify
orkify up server.mjs -n deploy-example --port 3050

# Or run directly
node server.mjs

# Open http://localhost:3050
```

## Features

- **Live dashboard** — stats cards (requests, memory, uptime, build time) polled every 2s
- **Error triggers** — buttons to fire uncaught exceptions, unhandled rejections, random, and delayed errors
- **Error types** — TypeError (null access), TypeError (bad input), SyntaxError, ECONNREFUSED, ENOENT, upstream 503
- **Background work** — CPU simulation, log generation, memory allocation (visible in orkify metrics)
- **Health check** — `GET /api/health` for deploy verification
- **Custom server** — `server.mjs` wraps Next.js for `process.send('ready')` and graceful shutdown

## API endpoints

| Endpoint      | Method | Description                                               |
| ------------- | ------ | --------------------------------------------------------- |
| `/api/health` | GET    | Health check (status, version, pid, uptime)               |
| `/api/stats`  | GET    | Runtime stats (requests, memory, build info)              |
| `/api/chaos`  | POST   | Trigger errors — body: `{ action, type, message, delay }` |

### Chaos actions

```bash
# Uncaught exception (random error template)
curl -X POST http://localhost:3050/api/chaos -H 'Content-Type: application/json' -d '{"action":"throw"}'

# Unhandled rejection
curl -X POST http://localhost:3050/api/chaos -H 'Content-Type: application/json' -d '{"action":"reject"}'

# Specific error type
curl -X POST http://localhost:3050/api/chaos -H 'Content-Type: application/json' -d '{"action":"throw","type":"TypeError"}'

# Delayed throw
curl -X POST http://localhost:3050/api/chaos -H 'Content-Type: application/json' -d '{"action":"delayed","delay":2000}'
```

## Deploy workflow

```bash
# 1. Upload artifact
orkify deploy upload --api-key orkify_xxx

# 2. Go to dashboard → Deploys → select artifact → Deploy

# 3. The agent will:
#    - Download the artifact
#    - Run `npm ci`
#    - Run `npm run build` (stamps build-info.json + next build)
#    - Reload with server.mjs
#    - Monitor for crashes (15s window)
#    - Check /api/health
#    - Report success or auto-rollback
```

## Deploy config

```json
{
  "orkify": {
    "deploy": {
      "install": "npm ci",
      "build": "npm run build",
      "entry": "server.mjs",
      "workers": 1,
      "healthCheck": "/api/health",
      "crashWindow": 15
    }
  }
}
```
