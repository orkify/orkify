import { createServer } from 'node:http';

const server = createServer((req, res) => {
  res.writeHead(200);
  res.end(`pid=${process.pid}\n`);
});

process.on('SIGTERM', () => {
  // Simulate a real app: close connections, flush buffers, etc.
  // 2s shutdown delay is typical for apps with active connections.
  console.log(`[${process.pid}] SIGTERM received, graceful shutdown in 2s...`);
  setTimeout(() => server.close(() => process.exit(0)), 2000);
});

server.listen(0, () => {
  console.log(`Worker ready (pid ${process.pid})`);
});
