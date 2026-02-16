import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_WINDOWS, spawnOrkify } from './setup.js';
import { httpGet, sleep, waitForDaemonKilled, waitForHttpReady, orkify } from './test-utils.js';

describe('Run Command (Foreground/Container Mode)', () => {
  let tempDir: string;
  let scriptPath: string;
  let clusterScriptPath: string;
  let hangingScriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-run-test-')));
    scriptPath = join(tempDir, 'app.js');
    clusterScriptPath = join(tempDir, 'cluster-app.js');
    hangingScriptPath = join(tempDir, 'hanging-app.js');

    // Standard app that handles signals properly
    writeFileSync(
      scriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          pid: process.pid,
          env: {
            processName: process.env.ORKIFY_PROCESS_NAME,
            workerId: process.env.ORKIFY_WORKER_ID,
            clusterMode: process.env.ORKIFY_CLUSTER_MODE,
          }
        }));
      });
      server.listen(3014, () => {
        console.log('Server ready on 3014');

      });
      process.on('SIGTERM', () => {
        console.log('Received SIGTERM');
        server.close(() => process.exit(0));
      });
      process.on('SIGINT', () => {
        console.log('Received SIGINT');
        server.close(() => process.exit(0));
      });
      process.on('SIGHUP', () => {
        console.log('Received SIGHUP');
        server.close(() => process.exit(0));
      });
    `
    );

    // Cluster mode app
    writeFileSync(
      clusterScriptPath,
      `
      const http = require('http');
      const workerId = process.env.ORKIFY_WORKER_ID || '0';
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          worker: workerId,
          pid: process.pid,
          clusterMode: process.env.ORKIFY_CLUSTER_MODE,
        }));
      });
      server.listen(3015, () => {
        console.log('Worker ' + workerId + ' ready on 3015');

      });
      process.on('SIGTERM', () => {
        console.log('Worker ' + workerId + ' received SIGTERM');
        server.close(() => process.exit(0));
      });
    `
    );

    // App that ignores SIGTERM (to test kill timeout)
    writeFileSync(
      hangingScriptPath,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('hanging app');
      });
      server.listen(3016, () => {
        console.log('Hanging app ready');

      });
      // Intentionally ignore SIGTERM to test kill timeout
      process.on('SIGTERM', () => {
        console.log('SIGTERM ignored, not shutting down');
        // Don't exit!
      });
    `
    );
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs process in foreground (fork mode)', async () => {
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-run'], {
      stdio: 'pipe',
      detached: false,
    });

    await waitForHttpReady('http://localhost:3014/');

    const { status, body } = await httpGet('http://localhost:3014/');
    expect(status).toBe(200);

    const data = JSON.parse(body);
    expect(data.env.processName).toBe('test-run');
    expect(data.env.workerId).toBe('0');
    expect(data.env.clusterMode).toBe('false');

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 3000);
    });

    const { status: afterStatus } = await httpGet('http://localhost:3014/');
    expect(afterStatus).toBe(0);
  }, 15000);

  it('runs process in foreground (cluster mode)', async () => {
    const proc = spawnOrkify(['run', clusterScriptPath, '-n', 'test-run-cluster', '-w', '2'], {
      stdio: 'pipe',
      detached: false,
    });

    await waitForHttpReady('http://localhost:3015/');

    const { status, body } = await httpGet('http://localhost:3015/');
    expect(status).toBe(200);

    const data = JSON.parse(body);
    expect(data.clusterMode).toBe('true');
    expect(['0', '1']).toContain(data.worker);

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 5000);
    });
  }, 20000);

  it('forwards SIGTERM to child process', async () => {
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-sigterm'], {
      stdio: 'pipe',
      detached: false,
    });

    let output = '';
    proc.stdout?.on('data', (d) => (output += d.toString()));
    proc.stderr?.on('data', (d) => (output += d.toString()));

    await waitForHttpReady('http://localhost:3014/');

    proc.kill('SIGTERM');

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 5000);
    });

    // Should exit cleanly (0 if handled gracefully, or 143 for SIGTERM)
    expect(exitCode === 0 || exitCode === 143 || exitCode === null).toBe(true);
  }, 15000);

  it('forwards SIGINT to child process', async () => {
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-sigint'], {
      stdio: 'pipe',
      detached: false,
    });

    await waitForHttpReady('http://localhost:3014/');

    proc.kill('SIGINT');

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 5000);
    });

    // Should exit cleanly (0 if handled, or 130 for SIGINT)
    expect(exitCode === 0 || exitCode === 130 || exitCode === null).toBe(true);
  }, 15000);

  it('forwards SIGHUP to child process', async () => {
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-sighup'], {
      stdio: 'pipe',
      detached: false,
    });

    await waitForHttpReady('http://localhost:3014/');

    proc.kill('SIGHUP');

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 5000);
    });

    // Should exit (0 if handled, or 129 for SIGHUP)
    expect(exitCode === 0 || exitCode === 129 || exitCode === null).toBe(true);
  }, 15000);

  it('suppresses output with --silent flag', async () => {
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-silent', '--silent'], {
      stdio: 'pipe',
      detached: false,
    });

    let output = '';
    proc.stdout?.on('data', (d) => (output += d.toString()));
    proc.stderr?.on('data', (d) => (output += d.toString()));

    await waitForHttpReady('http://localhost:3014/');

    // With --silent, orkify should not print startup messages
    // (but the app's own console.log will still appear)
    expect(output).not.toContain('[orkify] Starting');
    expect(output).not.toContain('[orkify] Cluster');

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 3000);
    });
  }, 15000);

  it('prints startup messages without --silent flag', async () => {
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-verbose'], {
      stdio: 'pipe',
      detached: false,
    });

    let output = '';
    proc.stdout?.on('data', (d) => (output += d.toString()));
    proc.stderr?.on('data', (d) => (output += d.toString()));

    await waitForHttpReady('http://localhost:3014/');

    // Without --silent, orkify should print startup messages
    expect(output).toContain('[orkify] Starting test-verbose');

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 3000);
    });
  }, 15000);

  it('force kills with SIGKILL after --kill-timeout expires', async () => {
    const proc = spawnOrkify(
      ['run', hangingScriptPath, '-n', 'test-kill-timeout', '--kill-timeout', '1000'],
      {
        stdio: 'pipe',
        detached: false,
      }
    );

    let output = '';
    proc.stdout?.on('data', (d) => (output += d.toString()));
    proc.stderr?.on('data', (d) => (output += d.toString()));

    await waitForHttpReady('http://localhost:3016/');

    // Verify it's running
    const { status } = await httpGet('http://localhost:3016/');
    expect(status).toBe(200);

    const startTime = Date.now();
    proc.kill('SIGTERM');

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 10000);
    });

    const elapsed = Date.now() - startTime;

    // Force kill behavior differs by platform:
    // - Linux/macOS: SIGTERM is sent, then SIGKILL after timeout (~1000ms)
    //   Exit code is 137 (128 + 9 for SIGKILL)
    // - Windows: No SIGKILL signal exists; TerminateProcess is used immediately
    //   Exit code is null (killed) or 1, and termination is near-instant
    if (IS_WINDOWS) {
      // Windows terminates immediately with TerminateProcess
      expect(elapsed).toBeLessThan(5000);
      // Exit code is null when killed externally, or 1 for error exit
      expect(exitCode === null || exitCode === 1).toBe(true);
    } else {
      // Unix waits for kill-timeout then sends SIGKILL
      expect(elapsed).toBeGreaterThan(900);
      expect(elapsed).toBeLessThan(5000);
      expect(exitCode).toBe(137);
    }
  }, 20000);

  it('preserves child exit code', async () => {
    // Create a script that exits with a specific code
    const exitCodeScript = join(tempDir, 'exit-code.js');
    writeFileSync(
      exitCodeScript,
      `
      console.log('About to exit with code 42');
      process.exit(42);
    `
    );

    const proc = spawnOrkify(['run', exitCodeScript, '-n', 'test-exit-code', '--silent'], {
      stdio: 'pipe',
      detached: false,
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 5000);
    });

    expect(exitCode).toBe(42);
  }, 10000);

  it('cluster mode terminates all workers on SIGTERM', async () => {
    const proc = spawnOrkify(['run', clusterScriptPath, '-n', 'test-cluster-term', '-w', '2'], {
      stdio: 'pipe',
      detached: false,
    });

    let output = '';
    proc.stdout?.on('data', (d) => (output += d.toString()));
    proc.stderr?.on('data', (d) => (output += d.toString()));

    await waitForHttpReady('http://localhost:3015/');

    // Verify cluster is running
    const { status } = await httpGet('http://localhost:3015/');
    expect(status).toBe(200);

    proc.kill('SIGTERM');

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 8000);
    });

    // Should exit (0 for graceful or 143 for SIGTERM)
    expect(exitCode === 0 || exitCode === 143 || exitCode === null).toBe(true);

    // Server should no longer respond
    await sleep(100);
    const { status: afterStatus } = await httpGet('http://localhost:3015/');
    expect(afterStatus).toBe(0);
  }, 25000);

  it('does not require daemon for run command', async () => {
    // Kill any existing daemon
    orkify('kill');
    await waitForDaemonKilled();

    // Run should work without daemon
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-no-daemon', '--silent'], {
      stdio: 'pipe',
      detached: false,
    });

    await waitForHttpReady('http://localhost:3014/');

    const { status } = await httpGet('http://localhost:3014/');
    expect(status).toBe(200);

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 3000);
    });
  }, 15000);

  it('respects --cwd option in run command', async () => {
    const cwdTempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-run-cwd-')));
    const cwdScript = join(cwdTempDir, 'cwd-app.js');
    const dataFile = join(cwdTempDir, 'data.txt');

    // Create a data file in the temp dir
    writeFileSync(dataFile, 'CWD_TEST_DATA');

    // Create script that reads from cwd
    writeFileSync(
      cwdScript,
      `
      const http = require('http');
      const fs = require('fs');
      const path = require('path');

      const server = http.createServer((req, res) => {
        const cwd = process.cwd();
        let data = 'not found';
        try {
          data = fs.readFileSync(path.join(cwd, 'data.txt'), 'utf8');
        } catch (e) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cwd, data }));
      });

      server.listen(3030, () => {

      });

      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `
    );

    const proc = spawnOrkify(['run', cwdScript, '-n', 'test-run-cwd', '--cwd', cwdTempDir], {
      stdio: 'pipe',
      detached: false,
    });

    await waitForHttpReady('http://localhost:3030/');

    const { status, body } = await httpGet('http://localhost:3030/');
    expect(status).toBe(200);

    const result = JSON.parse(body);
    expect(result.cwd).toBe(cwdTempDir);
    expect(result.data).toBe('CWD_TEST_DATA');

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 3000);
    });

    // Windows holds directory handles briefly after process exit
    if (IS_WINDOWS) await sleep(500);

    try {
      rmSync(cwdTempDir, { recursive: true, force: true });
    } catch (err) {
      console.warn('Failed to clean up temp dir (expected on Windows):', err);
    }
  }, 15000);
});
