// Basic HTTP server example for ORKIFY
import { createServer } from 'node:http';

const PORT = process.env.PORT || 3000;
const WORKER_ID = process.env.ORKIFY_WORKER_ID || '0';
const PROCESS_NAME = process.env.ORKIFY_PROCESS_NAME || 'app';

const server = createServer((req, res) => {
  console.log(`[Worker ${WORKER_ID}] ${req.method} ${req.url}`);

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        worker: WORKER_ID,
        process: PROCESS_NAME,
        pid: process.pid,
        uptime: process.uptime(),
      })
    );
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
