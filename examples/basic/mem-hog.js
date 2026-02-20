const http = require('http');

// Grow memory continuously — 5 MB every 200ms
const chunks = [];
setInterval(() => chunks.push(Buffer.alloc(5 * 1024 * 1024)), 200);

const server = http.createServer((req, res) => res.end('ok'));
server.listen(0, () => {
  if (process.send) process.send('ready');
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
