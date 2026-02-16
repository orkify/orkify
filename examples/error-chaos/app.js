// Error chaos example for ORKIFY
//
// A realistic HTTP server that does background CPU work (simulating real
// request processing) while exposing endpoints to trigger various errors.
// Useful for testing error capture, grouping, and the dashboard Errors page.
//
// Between crashes you'll see normal CPU/memory metrics in the dashboard,
// just like a real production service that occasionally throws.
//
// Usage:
//   orkify up examples/error-chaos/app.js -n chaos
//   orkify up examples/error-chaos/app.js -n chaos-cluster -w 4
//
// Endpoints:
//   GET /                          — Status page with links to all triggers
//   GET /throw                     — Throw a random uncaught exception
//   GET /reject                    — Trigger a random unhandled promise rejection
//   GET /throw?type=TypeError      — Throw a specific error type
//   GET /throw?message=custom+msg  — Throw with a specific message
//   GET /random                    — 50/50 chance of throw or rejection
//   GET /delayed?ms=2000           — Throw after a delay (default 1s)
//   GET /health                    — Health check (always succeeds)

import { createServer } from 'node:http';

const PORT = process.env.PORT || 4100;
const WORKER_ID = process.env.ORKIFY_WORKER_ID || '0';
const PROCESS_NAME = process.env.ORKIFY_PROCESS_NAME || 'chaos';

// ---------------------------------------------------------------------------
// Background CPU work — simulates real request processing / cron jobs.
// Produces visible, fluctuating CPU load in the metrics dashboard.
// ---------------------------------------------------------------------------
let requestsHandled = 0;

function backgroundWork() {
  // Busy spin for 5-40ms (simulates parsing, template rendering, etc.)
  const busyMs = 5 + Math.random() * 35;
  const end = Date.now() + busyMs;
  while (Date.now() < end) {
    Math.random() * Math.random();
  }
  // Idle for 50-300ms before the next burst
  const gapMs = 50 + Math.random() * 250;
  setTimeout(backgroundWork, gapMs);
}

backgroundWork();

// ---------------------------------------------------------------------------
// Continuous log output — simulates real app logging so the log ring buffer
// has content when an error is captured (visible in "Last Logs" on the
// error detail page). Also useful for testing future log collection.
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
    // Occasionally write to stderr like a real app would
    if (Math.random() < 0.1) {
      console.warn(`[Worker ${WORKER_ID}] WARN: ${msg}`);
    } else {
      console.log(`[Worker ${WORKER_ID}] ${msg}`);
    }
    scheduleLog();
  }, delay);
}

scheduleLog();

// Allocate a small, growing buffer to show memory usage in metrics
const buffers = [];
setInterval(() => {
  if (buffers.length < 20) {
    buffers.push(Buffer.alloc(64 * 1024, Math.random())); // 64 KB
  } else {
    // Replace random entry to keep memory roughly stable
    buffers[Math.floor(Math.random() * buffers.length)] = Buffer.alloc(64 * 1024, Math.random());
  }
}, 3000);

// ---------------------------------------------------------------------------
// Error templates — each produces a realistic-looking error with a proper
// stack trace originating from this file (not just "at Server.<anonymous>").
// ---------------------------------------------------------------------------
function fetchUserProfile(userId) {
  // Simulates a null result from a database lookup
  const user = null;
  return user.profile; // TypeError: Cannot read properties of null
}

function parseConfigFile(path) {
  JSON.parse('{"port": 3000, broken'); // SyntaxError: Unexpected token
}

function validateInput(data) {
  if (!data || typeof data !== 'object') {
    throw new TypeError(`Expected object, got ${typeof data}`);
  }
}

function connectToDatabase() {
  throw new Error('ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:5432');
}

function readConfigFile() {
  throw new Error('ENOENT: no such file or directory, open "/etc/app/config.json"');
}

function callExternalApi() {
  throw new Error('Request failed with status code 503 — upstream timeout');
}

const ERROR_TEMPLATES = [
  {
    name: 'TypeError (null access)',
    make: () => fetchUserProfile(42),
  },
  {
    name: 'TypeError (bad input)',
    make: () => validateInput(undefined),
  },
  {
    name: 'SyntaxError (bad JSON)',
    make: () => parseConfigFile('/etc/app/config.json'),
  },
  {
    name: 'Error (ECONNREFUSED)',
    make: () => connectToDatabase(),
  },
  {
    name: 'Error (ENOENT)',
    make: () => readConfigFile(),
  },
  {
    name: 'Error (upstream 503)',
    make: () => callExternalApi(),
  },
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function triggerThrow(type, message) {
  if (message) {
    const ErrorCtor = globalThis[type] || Error;
    throw new ErrorCtor(message);
  }

  if (type) {
    const match = ERROR_TEMPLATES.find((t) => t.name.startsWith(type));
    if (match) {
      match.make();
      return;
    }
    throw new (globalThis[type] || Error)(`Triggered ${type} via /throw?type=${type}`);
  }

  pickRandom(ERROR_TEMPLATES).make();
}

function triggerReject(type, message) {
  // Use Promise.resolve().then() so the rejection originates from a proper
  // async context with a meaningful stack trace.
  Promise.resolve().then(() => triggerThrow(type, message));
}

function buildHtmlPage() {
  const uptimeSec = Math.floor(process.uptime());
  const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
  return `<!DOCTYPE html>
<html>
<head>
  <title>ORKIFY Error Chaos</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; }
    a { display: block; margin: 0.5rem 0; color: #2563eb; }
    .stats { display: flex; gap: 1rem; margin: 1rem 0; flex-wrap: wrap; }
    .stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.75rem 1rem; min-width: 100px; }
    .stat-value { font-size: 1.25rem; font-weight: 700; }
    .stat-label { font-size: 0.75rem; color: #64748b; }
    .info { color: #666; font-size: 0.875rem; margin-top: 2rem; }
    code { background: #f1f5f9; padding: 0.125rem 0.375rem; border-radius: 4px; font-size: 0.875rem; }
  </style>
</head>
<body>
  <h1>Error Chaos — Worker ${WORKER_ID} (PID ${process.pid})</h1>

  <div class="stats">
    <div class="stat"><div class="stat-value">${requestsHandled}</div><div class="stat-label">Requests</div></div>
    <div class="stat"><div class="stat-value">${uptimeSec}s</div><div class="stat-label">Uptime</div></div>
    <div class="stat"><div class="stat-value">${memMB} MB</div><div class="stat-label">Heap</div></div>
  </div>

  <p>Click a link to trigger an error in this worker:</p>

  <h3>Uncaught Exceptions</h3>
  <a href="/throw">Random uncaught exception</a>
  <a href="/throw?type=TypeError">TypeError (null access or bad input)</a>
  <a href="/throw?type=SyntaxError">SyntaxError (bad JSON config)</a>
  <a href="/throw?type=Error">Generic Error (connection / file / upstream)</a>
  <a href="/throw?message=Custom+error+message">Custom message</a>

  <h3>Unhandled Rejections</h3>
  <a href="/reject">Random unhandled rejection</a>
  <a href="/reject?type=TypeError">TypeError rejection</a>
  <a href="/reject?type=Error&message=Async+operation+timed+out">Custom async failure</a>

  <h3>Other</h3>
  <a href="/random">Random (50/50 throw or reject)</a>
  <a href="/delayed?ms=2000">Delayed throw (2s)</a>
  <a href="/health">Health check (no error)</a>

  <p class="info">
    Process: <code>${PROCESS_NAME}</code> &middot;
    Worker: <code>${WORKER_ID}</code> &middot;
    PID: <code>${process.pid}</code>
  </p>
</body>
</html>`;
}

const server = createServer((req, res) => {
  requestsHandled++;

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const type = url.searchParams.get('type') || undefined;
  const message = url.searchParams.get('message') || undefined;

  console.log(`[Worker ${WORKER_ID}] ${req.method} ${pathname} (req #${requestsHandled})`);

  switch (pathname) {
    case '/health':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          worker: WORKER_ID,
          pid: process.pid,
          uptime: Math.floor(process.uptime()),
          requests: requestsHandled,
          heapMB: +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1),
        })
      );
      return;

    case '/throw':
      // Send response before crashing so the browser gets feedback
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`Triggering uncaught exception in worker ${WORKER_ID}...\n`);
      setImmediate(() => triggerThrow(type, message));
      return;

    case '/reject':
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`Triggering unhandled rejection in worker ${WORKER_ID}...\n`);
      setImmediate(() => triggerReject(type, message));
      return;

    case '/random':
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      if (Math.random() < 0.5) {
        res.end(`Triggering uncaught exception in worker ${WORKER_ID}...\n`);
        setImmediate(() => triggerThrow(type, message));
      } else {
        res.end(`Triggering unhandled rejection in worker ${WORKER_ID}...\n`);
        setImmediate(() => triggerReject(type, message));
      }
      return;

    case '/delayed': {
      const ms = parseInt(url.searchParams.get('ms') || '1000', 10);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`Will throw in ${ms}ms in worker ${WORKER_ID}...\n`);
      setTimeout(() => triggerThrow(type, message), ms);
      return;
    }

    default:
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(buildHtmlPage());
  }
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
});

server.listen(PORT, () => {
  console.log(`[Worker ${WORKER_ID}] Error chaos app on port ${PORT} (PID: ${process.pid})`);
});
