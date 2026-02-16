// Custom Next.js server for orkify deploy example
//
// Wraps Next.js in a standard http.createServer() so we can:
//   - Let orkify auto-detect when the server starts listening
//   - Handle SIGTERM for graceful shutdown
//   - Run background work (CPU sim, log generation, memory allocation)
//   - Track request count and expose stats via globalThis.__app

import { createServer } from 'node:http';
import { parse } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import next from 'next';

const PORT = process.env.PORT || 3050;
const WORKER_ID = process.env.ORKIFY_WORKER_ID || '0';
const PROCESS_NAME = process.env.ORKIFY_PROCESS_NAME || 'deploy-example';
const dev = process.env.NODE_ENV !== 'production';

// Load build info if available
let buildInfo = { version: 'dev', builtAt: 'n/a', node: process.version };
const buildInfoPath = new URL('./build-info.json', import.meta.url).pathname;
if (existsSync(buildInfoPath)) {
  try {
    buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf-8'));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Shared app state — accessible from Next.js API routes via globalThis.__app
// ---------------------------------------------------------------------------
const startedAt = Date.now();

globalThis.__app = {
  requestCount: 0,
  startedAt,
  buildInfo,
  workerId: WORKER_ID,
  processName: PROCESS_NAME,
};

// ---------------------------------------------------------------------------
// Background CPU work — simulates real request processing / cron jobs.
// Produces visible, fluctuating CPU load in the metrics dashboard.
// ---------------------------------------------------------------------------
function backgroundWork() {
  const busyMs = 5 + Math.random() * 35;
  const end = Date.now() + busyMs;
  while (Date.now() < end) {
    Math.random() * Math.random();
  }
  const gapMs = 50 + Math.random() * 250;
  setTimeout(backgroundWork, gapMs);
}

backgroundWork();

// ---------------------------------------------------------------------------
// Continuous log output — simulates real app logging so the log ring buffer
// has content when an error is captured.
// ---------------------------------------------------------------------------
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const LOG_GENERATORS = [
  () => `Processing incoming request`,
  () => `Cache ${Math.random() > 0.3 ? 'hit' : 'miss'} for session ${randomInt(1000, 9999)}`,
  () => `Query executed in ${randomInt(1, 120)}ms — ${randomInt(1, 50)} rows`,
  () => `Sending response ${Math.random() > 0.1 ? 200 : 304}`,
  () => `Background job: cleaning ${randomInt(0, 15)} expired sessions`,
  () => `Webhook delivery queued for event #${randomInt(10000, 99999)}`,
  () => `Rate limiter: ${randomInt(10, 95)}/100 requests used`,
  () => `Connection pool: ${randomInt(1, 8)}/${randomInt(8, 15)} active`,
  () => `Scheduled task: compacted ${randomInt(100, 5000)} log entries`,
  () => `User ${randomInt(100, 999)} authenticated via OAuth`,
  () => `WebSocket: ${randomInt(1, 30)} active connections`,
  () => `Metrics snapshot: cpu=${randomInt(1, 80)}% mem=${randomInt(20, 200)}MB`,
];

function scheduleLog() {
  const delay = 1500 + Math.random() * 3000;
  setTimeout(() => {
    const gen = LOG_GENERATORS[Math.floor(Math.random() * LOG_GENERATORS.length)];
    const msg = gen();
    if (Math.random() < 0.1) {
      console.warn(`[w${WORKER_ID}] WARN: ${msg}`);
    } else {
      console.log(`[w${WORKER_ID}] ${msg}`);
    }
    scheduleLog();
  }, delay);
}

scheduleLog();

// ---------------------------------------------------------------------------
// Memory allocation — shows memory usage in metrics
// ---------------------------------------------------------------------------
const buffers = [];
setInterval(() => {
  if (buffers.length < 20) {
    buffers.push(Buffer.alloc(64 * 1024, Math.random()));
  } else {
    buffers[Math.floor(Math.random() * buffers.length)] = Buffer.alloc(64 * 1024, Math.random());
  }
}, 3000);

// ---------------------------------------------------------------------------
// Next.js server
// ---------------------------------------------------------------------------
const app = next({ dev, dir: import.meta.dirname });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => {
  globalThis.__app.requestCount++;
  const parsedUrl = parse(req.url, true);
  handle(req, res, parsedUrl);
});

process.on('SIGTERM', () => {
  console.log(`[w${WORKER_ID}] Shutting down (${globalThis.__app.requestCount} requests served)`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
});

server.listen(PORT, () => {
  console.log(`[w${WORKER_ID}] Listening on :${PORT} (v${buildInfo.version}, PID ${process.pid})`);
});
