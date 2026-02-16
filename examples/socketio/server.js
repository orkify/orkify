// Socket.IO server example with sticky sessions for ORKIFY
//
// Usage:
//   orkify up examples/socketio/server.js -w 4 --sticky
//
// This example demonstrates:
// - Socket.IO with multiple workers
// - Sticky sessions (connections always route to the same worker)
// - Graceful shutdown with connection draining

import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { setupWorker } from '@socket.io/sticky';
import { createAdapter } from '@socket.io/cluster-adapter';

const PORT = process.env.PORT || 3000;
const WORKER_ID = process.env.ORKIFY_WORKER_ID || '0';
const PROCESS_NAME = process.env.ORKIFY_PROCESS_NAME || 'socketio-app';
const IS_CLUSTER = process.env.ORKIFY_CLUSTER_MODE === 'true';

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        worker: WORKER_ID,
        pid: process.pid,
      })
    );
    return;
  }

  // Serve a simple client page
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>Socket.IO Test</title>
  <script src="/socket.io/socket.io.js"></script>
</head>
<body>
  <h1>Socket.IO Sticky Session Test</h1>
  <div id="status">Connecting...</div>
  <div id="messages"></div>
  <script>
    const socket = io();
    const statusEl = document.getElementById('status');
    const messagesEl = document.getElementById('messages');

    socket.on('connect', () => {
      statusEl.innerHTML = 'Connected! Socket ID: ' + socket.id;
    });

    socket.on('worker-info', (data) => {
      const msg = document.createElement('div');
      msg.textContent = 'Worker: ' + data.workerId + ', PID: ' + data.pid;
      messagesEl.appendChild(msg);
    });

    socket.on('ping', (data) => {
      const msg = document.createElement('div');
      msg.textContent = 'Ping from worker ' + data.workerId + ' at ' + new Date(data.timestamp).toLocaleTimeString();
      messagesEl.appendChild(msg);
    });

    socket.on('disconnect', () => {
      statusEl.innerHTML = 'Disconnected';
    });
  </script>
</body>
</html>
    `);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

// Set up cluster adapter if in cluster mode
if (IS_CLUSTER) {
  io.adapter(createAdapter());
  setupWorker(io);
}

// Track connections
const connections = new Set();

io.on('connection', (socket) => {
  console.log(`[Worker ${WORKER_ID}] New connection: ${socket.id}`);
  connections.add(socket);

  // Send worker info to client
  socket.emit('worker-info', {
    workerId: WORKER_ID,
    pid: process.pid,
    socketId: socket.id,
  });

  socket.on('disconnect', () => {
    console.log(`[Worker ${WORKER_ID}] Disconnected: ${socket.id}`);
    connections.delete(socket);
  });
});

// Periodic ping to demonstrate sticky sessions
setInterval(() => {
  io.emit('ping', {
    workerId: WORKER_ID,
    timestamp: Date.now(),
  });
}, 5000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(
    `[Worker ${WORKER_ID}] Received SIGTERM, draining ${connections.size} connections...`
  );

  // Stop accepting new connections
  httpServer.close(() => {
    console.log(`[Worker ${WORKER_ID}] HTTP server closed`);
  });

  // Close all socket connections gracefully
  for (const socket of connections) {
    socket.disconnect(true);
  }

  // Give some time for connections to close
  setTimeout(() => {
    console.log(`[Worker ${WORKER_ID}] Exiting`);
    process.exit(0);
  }, 2000);
});

httpServer.listen(PORT, () => {
  console.log(`[Worker ${WORKER_ID}] Socket.IO server listening on port ${PORT}`);
});
