// CPU load example for ORKIFY
//
// Usage:
//   orkify up examples/cpu-load/app.js -n cpu-test
//
// Produces continuous, randomly varying CPU load
// visible in telemetry metrics.

import { createServer } from 'node:http';

const PORT = process.env.PORT || 4000;
const WORKER_ID = process.env.ORKIFY_WORKER_ID || '0';

// Do a short burst of CPU work, then schedule the next one.
// Random busy duration (5-50ms) and gap (10-200ms) creates
// fluctuating load that varies each 10s telemetry window.
function work() {
  const busyMs = 5 + Math.random() * 45;
  const end = Date.now() + busyMs;
  while (Date.now() < end) {
    Math.random() * Math.random();
  }
  const gapMs = 10 + Math.random() * 190;
  setTimeout(work, gapMs);
}

work();

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ worker: WORKER_ID, pid: process.pid }));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
});

server.listen(PORT, () => {
  console.log(`[Worker ${WORKER_ID}] CPU load app on port ${PORT} (PID: ${process.pid})`);
});
