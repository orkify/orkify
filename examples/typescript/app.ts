// TypeScript HTTP server example for ORKIFY
//
// Usage:
//   orkify up examples/typescript/app.ts -n my-ts-app
//   orkify up examples/typescript/app.ts -n my-ts-cluster -w 4
//
// Requires Node.js 22.18+ (native type stripping — no build step needed).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

interface HealthResponse {
  status: 'ok' | 'error';
  worker: string;
  process: string;
  pid: number;
  uptime: number;
}

const PORT: number = Number(process.env.PORT) || 3000;
const WORKER_ID: string = process.env.ORKIFY_WORKER_ID || '0';
const PROCESS_NAME: string = process.env.ORKIFY_PROCESS_NAME || 'app';

function buildHealthResponse(): HealthResponse {
  return {
    status: 'ok',
    worker: WORKER_ID,
    process: PROCESS_NAME,
    pid: process.pid,
    uptime: process.uptime(),
  };
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  console.log(`[Worker ${WORKER_ID}] ${req.method} ${req.url}`);

  if (req.url === '/health') {
    const health: HealthResponse = buildHealthResponse();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Hello from ${PROCESS_NAME} worker ${WORKER_ID} (PID: ${process.pid})\n`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log(`[Worker ${WORKER_ID}] Received SIGTERM, shutting down gracefully...`);

  server.close(() => {
    console.log(`[Worker ${WORKER_ID}] Server closed`);
    process.exit(0);
  });

  // Force close after timeout
  setTimeout(() => {
    console.log(`[Worker ${WORKER_ID}] Forcing shutdown`);
    process.exit(0);
  }, 5000);
});

server.listen(PORT, () => {
  console.log(`[Worker ${WORKER_ID}] Server listening on port ${PORT}`);
});
