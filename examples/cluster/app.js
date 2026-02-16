// Cluster mode example for ORKIFY
//
// Usage:
//   orkify up examples/cluster/app.js -w 4 -n my-cluster
//
// This example demonstrates:
// - Running multiple workers in cluster mode
// - Load balancing across workers
// - Zero-downtime reloads

import { createServer } from 'node:http';

const PORT = process.env.PORT || 3000;
const WORKER_ID = process.env.ORKIFY_WORKER_ID || '0';
const WORKER_COUNT = process.env.ORKIFY_WORKERS || '1';
const PROCESS_NAME = process.env.ORKIFY_PROCESS_NAME || 'cluster-app';

let requestCount = 0;

const server = createServer((req, res) => {
  requestCount++;
  const timestamp = new Date().toISOString();

  console.log(`[Worker ${WORKER_ID}] Request #${requestCount}: ${req.method} ${req.url}`);

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        worker: WORKER_ID,
        workers: WORKER_COUNT,
        pid: process.pid,
        requests: requestCount,
        uptime: process.uptime(),
      })
    );
    return;
  }

  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        worker: WORKER_ID,
        pid: process.pid,
        requests: requestCount,
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      })
    );
    return;
  }

  // Simulate some work
  const response = {
    message: `Hello from ${PROCESS_NAME}`,
    worker: WORKER_ID,
    pid: process.pid,
    request: requestCount,
    timestamp,
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response, null, 2));
});

// Handle graceful shutdown
let isShuttingDown = false;

process.on('SIGTERM', () => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Worker ${WORKER_ID}] Graceful shutdown initiated...`);
  console.log(`[Worker ${WORKER_ID}] Processed ${requestCount} requests total`);

  // Stop accepting new connections
  server.close(() => {
    console.log(`[Worker ${WORKER_ID}] All connections closed, exiting`);
    process.exit(0);
  });

  // Force exit after timeout
  setTimeout(() => {
    console.log(`[Worker ${WORKER_ID}] Forcing exit after timeout`);
    process.exit(0);
  }, 10000);
});

server.listen(PORT, () => {
  console.log(
    `[Worker ${WORKER_ID}/${WORKER_COUNT}] Cluster app listening on port ${PORT} (PID: ${process.pid})`
  );
});
