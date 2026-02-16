import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orkify, httpGet, waitForProcessOnline } from './test-utils.js';

describe('Logs Streaming', () => {
  const appName = 'test-logs';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-logs-test-')));
    scriptPath = join(tempDir, 'app.js');

    // Create an app that logs periodically
    writeFileSync(
      scriptPath,
      `
        const http = require('http');

        console.log('App starting...');
        console.log('Unique marker: LOG_TEST_12345');

        const server = http.createServer((req, res) => {
          console.log('Request received:', req.url);
          res.writeHead(200);
          res.end('ok');
        });

        server.listen(3009, () => {
          console.log('Server listening on 3009');

        });

        process.on('SIGTERM', () => {
          console.log('Shutting down...');
          server.close(() => process.exit(0));
        });
      `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('streams logs from running process', async () => {
    orkify(`up ${scriptPath} -n ${appName}`);
    await waitForProcessOnline(appName);

    // Make a request to generate log output
    await httpGet('http://localhost:3009/test');

    // Get logs (non-streaming, just recent)
    const logs = orkify(`logs ${appName} --lines 50`);

    // Should contain our log messages
    expect(logs).toContain('LOG_TEST_12345');
  }, 15000);

  it('shows logs from all processes when no name specified', async () => {
    // Create a second process to test "show all"
    const script2 = join(tempDir, 'app2.js');
    writeFileSync(
      script2,
      `
        const http = require('http');
        console.log('SECOND_APP_MARKER');
        const server = http.createServer((req, res) => {
          res.writeHead(200);
          res.end('ok');
        });
        server.listen(3021, () => {

        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );

    orkify(`up ${script2} -n ${appName}-2`);
    await waitForProcessOnline(`${appName}-2`);

    // Get all logs (no process name specified)
    const logs = orkify('logs --lines 100');

    // Should contain logs from both processes
    expect(logs).toContain('LOG_TEST_12345');
    expect(logs).toContain('SECOND_APP_MARKER');

    orkify(`delete ${appName}-2`);
  }, 20000);

  it('filters stdout-only with --out flag', async () => {
    // Generate some stderr output
    const errScript = join(tempDir, 'err-app.js');
    writeFileSync(
      errScript,
      `
        console.log('STDOUT_ONLY_MARKER');
        console.error('STDERR_ONLY_MARKER');
        const http = require('http');
        const server = http.createServer((req, res) => {
          res.writeHead(200);
          res.end('ok');
        });
        server.listen(3022, () => {

        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );

    orkify(`up ${errScript} -n ${appName}-err`);
    await waitForProcessOnline(`${appName}-err`);

    // Get stdout-only logs
    const outLogs = orkify(`logs ${appName}-err --out --lines 50`);

    // Should contain stdout marker
    expect(outLogs).toContain('STDOUT_ONLY_MARKER');
    // Should NOT contain stderr marker (it's in a different file)
    expect(outLogs).not.toContain('STDERR_ONLY_MARKER');

    orkify(`delete ${appName}-err`);
  }, 15000);

  it('filters stderr-only with --err flag', async () => {
    // Create app that outputs to stderr
    const errOnlyScript = join(tempDir, 'stderr-app.js');
    writeFileSync(
      errOnlyScript,
      `
        console.log('STDOUT_CHECK');
        console.error('STDERR_CHECK');
        const http = require('http');
        const server = http.createServer((req, res) => {
          res.writeHead(200);
          res.end('ok');
        });
        server.listen(3023, () => {

        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );

    orkify(`up ${errOnlyScript} -n ${appName}-stderr`);
    await waitForProcessOnline(`${appName}-stderr`);

    // Get stderr-only logs
    const errLogs = orkify(`logs ${appName}-stderr --err --lines 50`);

    // Should contain stderr marker
    expect(errLogs).toContain('STDERR_CHECK');
    // Should NOT contain stdout marker
    expect(errLogs).not.toContain('STDOUT_CHECK');

    orkify(`delete ${appName}-stderr`);
  }, 15000);
});
