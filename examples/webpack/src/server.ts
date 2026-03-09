// Webpack example for orkify — bundled HTTP server with error triggers
//
// Usage:
//   cd examples/webpack && npm install && npm run build
//   orkify up dist/server.js -n webpack-example
//
// Endpoints:
//   GET /         — Status page
//   GET /throw    — Trigger an uncaught exception
//   GET /reject   — Trigger an unhandled rejection
//   GET /health   — Health check

import { createServer } from 'node:http';

const PORT = process.env.PORT || 4200;
const WORKER_ID = process.env.ORKIFY_WORKER_ID || '0';

// ---------------------------------------------------------------------------
// Error functions — these create stack traces through bundled code
// ---------------------------------------------------------------------------

function fetchUserProfile(userId: number) {
  const user = null as { profile: unknown } | null;
  return user!.profile;
}

function validateInput(data: unknown) {
  if (!data || typeof data !== 'object') {
    throw new TypeError(`Expected object, got ${typeof data}`);
  }
}

function connectToDatabase() {
  throw new Error('ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:5432');
}

function processRequest(path: string) {
  switch (path) {
    case '/throw':
      // Randomly pick an error
      const errors = [
        () => fetchUserProfile(42),
        () => validateInput(undefined),
        () => connectToDatabase(),
      ];
      errors[Math.floor(Math.random() * errors.length)]();
      break;
    case '/reject':
      Promise.resolve().then(() => {
        throw new Error('Unhandled async error from webpack bundle');
      });
      break;
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  switch (url.pathname) {
    case '/':
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <h1>Webpack Example</h1>
        <p>Worker ${WORKER_ID} · PID ${process.pid}</p>
        <ul>
          <li><a href="/throw">Trigger uncaught exception</a></li>
          <li><a href="/reject">Trigger unhandled rejection</a></li>
          <li><a href="/health">Health check</a></li>
        </ul>
      `);
      break;

    case '/throw':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, action: 'throw' }));
      setImmediate(() => processRequest('/throw'));
      break;

    case '/reject':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, action: 'reject' }));
      setImmediate(() => processRequest('/reject'));
      break;

    case '/health':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      break;

    default:
      res.writeHead(404);
      res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`[webpack-example] Worker ${WORKER_ID} listening on port ${PORT}`);
});
