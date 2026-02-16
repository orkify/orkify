// Socket.IO test server for sticky session e2e tests
// This server tracks which worker handles each connection

import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/cluster-adapter';
import { setupWorker } from '@socket.io/sticky';

const WORKER_ID = process.env.ORKIFY_WORKER_ID || '0';
const IS_CLUSTER = process.env.ORKIFY_CLUSTER_MODE === 'true';
const IS_STICKY = process.env.ORKIFY_STICKY === 'true';

// In sticky mode, workers should NOT bind to the sticky port
// They receive connections via IPC from the primary's sticky balancer
const WORKER_PORT = process.env.ORKIFY_WORKER_PORT;
const PORT = IS_STICKY && WORKER_PORT ? parseInt(WORKER_PORT, 10) : process.env.PORT || 3003;

const httpServer = createServer((req, res) => {
  // Parse URL to handle query strings (e.g., /health?sticky_id=xxx)
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', worker: WORKER_ID }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

const io = new Server(httpServer, {
  cors: { origin: '*' },
});

// Set up cluster adapter if in cluster mode
if (IS_CLUSTER) {
  io.adapter(createAdapter());
  if (IS_STICKY) {
    setupWorker(io);
  }
}

io.on('connection', (socket) => {
  console.log(`[Worker ${WORKER_ID}] Connection: ${socket.id}`);

  // Immediately tell client which worker they're connected to
  socket.emit('worker-id', WORKER_ID);

  socket.on('ping', (callback) => {
    callback({ worker: WORKER_ID, pid: process.pid });
  });

  socket.on('disconnect', () => {
    console.log(`[Worker ${WORKER_ID}] Disconnect: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Worker ${WORKER_ID}] Listening on port ${PORT} (sticky=${IS_STICKY})`);
});

process.on('SIGTERM', () => {
  console.log(`[Worker ${WORKER_ID}] Shutting down...`);
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000);
});
