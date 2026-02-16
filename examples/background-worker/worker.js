// Background worker example for ORKIFY
// Demonstrates process.send('ready') for apps that don't bind a port.
// HTTP servers don't need this — orkify auto-detects server.listen().

const WORKER_ID = process.env.ORKIFY_WORKER_ID || '0';
const PROCESS_NAME = process.env.ORKIFY_PROCESS_NAME || 'worker';

// Simulate connecting to a message queue
console.log(`[Worker ${WORKER_ID}] Connecting to job queue...`);

// Simulate async startup (e.g., connecting to Redis, RabbitMQ, etc.)
setTimeout(() => {
  console.log(`[Worker ${WORKER_ID}] Connected to job queue`);

  // Signal ready — required for non-HTTP workers since there's no port to detect
  if (process.send) {
    process.send('ready');
  }

  // Start processing jobs
  let jobCount = 0;
  const interval = setInterval(() => {
    jobCount++;
    console.log(`[Worker ${WORKER_ID}] Processed job #${jobCount}`);
  }, 2000);

  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    console.log(`[Worker ${WORKER_ID}] Received SIGTERM, finishing current job...`);
    clearInterval(interval);
    console.log(`[Worker ${WORKER_ID}] Processed ${jobCount} jobs total. Shutting down.`);
    process.exit(0);
  });
}, 500);
