import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_WINDOWS, spawnOrkify } from './setup.js';
import {
  httpGet,
  orkify,
  sleep,
  waitForDaemonKilled,
  waitForHttpReady,
  waitForPidFileRemoved,
} from './test-utils.js';

describe('Run Command (Foreground/Container Mode)', () => {
  let tempDir: string;
  let scriptPath: string;
  let clusterScriptPath: string;
  let hangingScriptPath: string;

  beforeAll(async () => {
    // Kill any background daemon left running by previous test files.
    // Wait for PID file too — orkify run needs it gone to acquire the lock.
    orkify('kill');
    await waitForDaemonKilled();
    await waitForPidFileRemoved();

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

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 5000);
    });

    // Wait for IPC socket cleanup
    await waitForDaemonKilled();

    const { status: afterStatus } = await httpGet('http://localhost:3014/');
    expect(afterStatus).toBe(0);
  }, 20000);

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

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 8000);
    });

    await waitForDaemonKilled();
  }, 25000);

  it('forwards SIGTERM to child process', async () => {
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-sigterm'], {
      stdio: 'pipe',
      detached: false,
    });

    await waitForHttpReady('http://localhost:3014/');

    proc.kill('SIGTERM');

    const exitCode = await new Promise<null | number>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 5000);
    });

    await waitForDaemonKilled();

    // Should exit cleanly (0 for graceful shutdown)
    expect(exitCode === 0 || exitCode === null).toBe(true);
  }, 15000);

  it('forwards SIGINT to child process', async () => {
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-sigint'], {
      stdio: 'pipe',
      detached: false,
    });

    await waitForHttpReady('http://localhost:3014/');

    proc.kill('SIGINT');

    const exitCode = await new Promise<null | number>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 5000);
    });

    await waitForDaemonKilled();

    // Should exit cleanly (0 for graceful shutdown)
    expect(exitCode === 0 || exitCode === null).toBe(true);
  }, 15000);

  it('forwards SIGHUP to child process', async () => {
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-sighup'], {
      stdio: 'pipe',
      detached: false,
    });

    await waitForHttpReady('http://localhost:3014/');

    proc.kill('SIGHUP');

    const exitCode = await new Promise<null | number>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 5000);
    });

    await waitForDaemonKilled();

    // Should exit (0 for graceful shutdown)
    expect(exitCode === 0 || exitCode === null).toBe(true);
  }, 15000);

  it('suppresses startup messages with --silent flag', async () => {
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-silent', '--silent'], {
      stdio: 'pipe',
      detached: false,
    });

    let output = '';
    proc.stdout?.on('data', (d: Buffer) => (output += d.toString()));
    proc.stderr?.on('data', (d: Buffer) => (output += d.toString()));

    await waitForHttpReady('http://localhost:3014/');

    // With --silent, orkify should not print startup messages
    expect(output).not.toContain('[orkify] Starting');
    expect(output).not.toContain('[orkify] Cluster');

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 5000);
    });

    await waitForDaemonKilled();
  }, 20000);

  it('prints startup messages without --silent flag', async () => {
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-verbose'], {
      stdio: 'pipe',
      detached: false,
    });

    let output = '';
    proc.stdout?.on('data', (d: Buffer) => (output += d.toString()));
    proc.stderr?.on('data', (d: Buffer) => (output += d.toString()));

    await waitForHttpReady('http://localhost:3014/');

    // Without --silent, orkify should print startup messages
    expect(output).toContain('[orkify] Starting test-verbose');

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 5000);
    });

    await waitForDaemonKilled();
  }, 20000);

  it('force kills with SIGKILL after --kill-timeout expires', async () => {
    const proc = spawnOrkify(
      ['run', hangingScriptPath, '-n', 'test-kill-timeout', '--kill-timeout', '1000'],
      {
        stdio: 'pipe',
        detached: false,
      }
    );

    await waitForHttpReady('http://localhost:3016/');

    // Verify it's running
    const { status } = await httpGet('http://localhost:3016/');
    expect(status).toBe(200);

    const startTime = Date.now();
    proc.kill('SIGTERM');

    const exitCode = await new Promise<null | number>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 15000);
    });

    const elapsed = Date.now() - startTime;

    await waitForDaemonKilled();

    // Force kill behavior differs by platform:
    // - Linux/macOS: SIGTERM triggers graceful shutdown, managed process gets SIGTERM,
    //   then SIGKILL after kill-timeout. Exit code is 0 (graceful shutdown).
    // - Windows: TerminateProcess is used immediately
    if (IS_WINDOWS) {
      expect(elapsed).toBeLessThan(10000);
      expect(exitCode === null || exitCode === 0 || exitCode === 1).toBe(true);
    } else {
      // Should take at least kill-timeout to force kill the hanging child
      expect(elapsed).toBeGreaterThan(900);
      expect(elapsed).toBeLessThan(10000);
      // Foreground mode exits with 0 on SIGTERM (graceful shutdown path)
      expect(exitCode === 0 || exitCode === null).toBe(true);
    }
  }, 25000);

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

    const exitCode = await new Promise<null | number>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 10000);
    });

    await waitForDaemonKilled();

    expect(exitCode).toBe(42);
  }, 15000);

  it('cluster mode terminates all workers on SIGTERM', async () => {
    const proc = spawnOrkify(['run', clusterScriptPath, '-n', 'test-cluster-term', '-w', '2'], {
      stdio: 'pipe',
      detached: false,
    });

    await waitForHttpReady('http://localhost:3015/');

    // Verify cluster is running
    const { status } = await httpGet('http://localhost:3015/');
    expect(status).toBe(200);

    proc.kill('SIGTERM');

    const exitCode = await new Promise<null | number>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 10000);
    });

    await waitForDaemonKilled();

    // Should exit gracefully
    expect(exitCode === 0 || exitCode === null).toBe(true);

    // Server should no longer respond
    await sleep(100);
    const { status: afterStatus } = await httpGet('http://localhost:3015/');
    expect(afterStatus).toBe(0);
  }, 30000);

  it('does not require a separate daemon process', async () => {
    // Kill any existing daemon first
    orkify('kill');
    await waitForDaemonKilled();

    // orkify run should work without a separate daemon — it IS the daemon
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
      setTimeout(resolve, 5000);
    });

    await waitForDaemonKilled();
  }, 20000);

  it('makes orkify list work via IPC', async () => {
    const proc = spawnOrkify(['run', scriptPath, '-n', 'test-list'], {
      stdio: 'pipe',
      detached: false,
    });

    await waitForHttpReady('http://localhost:3014/');

    // orkify list should work because run starts an IPC server
    const listOutput = orkify('list');
    expect(listOutput).toContain('test-list');
    expect(listOutput).toContain('online');

    proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      setTimeout(resolve, 5000);
    });

    await waitForDaemonKilled();
  }, 20000);

  it('exits when primary process exits (exit code 0)', async () => {
    const exitScript = join(tempDir, 'exit-zero.js');
    writeFileSync(
      exitScript,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('ok');
      });
      server.listen(3017, () => {
        console.log('Ready');
        // Exit cleanly after 1 second
        setTimeout(() => {
          server.close(() => process.exit(0));
        }, 1000);
      });
    `
    );

    const proc = spawnOrkify(['run', exitScript, '-n', 'test-exit-zero', '--silent'], {
      stdio: 'pipe',
      detached: false,
    });

    const exitCode = await new Promise<null | number>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 10000);
    });

    await waitForDaemonKilled();

    expect(exitCode).toBe(0);
  }, 15000);

  it('two orkify run instances conflict', async () => {
    const proc1 = spawnOrkify(['run', scriptPath, '-n', 'test-conflict-1', '--silent'], {
      stdio: 'pipe',
      detached: false,
    });

    await waitForHttpReady('http://localhost:3014/');

    // Second instance should fail
    let proc2Output = '';
    const proc2 = spawnOrkify(['run', scriptPath, '-n', 'test-conflict-2', '--silent'], {
      stdio: 'pipe',
      detached: false,
    });
    proc2.stdout?.on('data', (d: Buffer) => (proc2Output += d.toString()));
    proc2.stderr?.on('data', (d: Buffer) => (proc2Output += d.toString()));

    const exitCode2 = await new Promise<null | number>((resolve) => {
      proc2.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 5000);
    });

    // Second instance should exit with error
    expect(exitCode2).toBe(1);
    expect(proc2Output).toContain('already running');

    // Clean up first instance
    proc1.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      proc1.on('exit', () => resolve());
      setTimeout(resolve, 5000);
    });

    await waitForDaemonKilled();
  }, 20000);

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
      setTimeout(resolve, 5000);
    });

    await waitForDaemonKilled();

    // Windows holds directory handles briefly after process exit
    if (IS_WINDOWS) await sleep(500);

    try {
      rmSync(cwdTempDir, { recursive: true, force: true });
    } catch (err) {
      console.warn('Failed to clean up temp dir (expected on Windows):', err);
    }
  }, 20000);

  it('restarts process with --max-restarts', async () => {
    // Create a script that crashes after 500ms
    const crashScript = join(tempDir, 'crash-app.js');
    writeFileSync(
      crashScript,
      `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pid: process.pid }));
      });
      server.listen(3018, () => {
        console.log('Started, will crash in 500ms');
        setTimeout(() => {
          process.exit(1);
        }, 500);
      });
    `
    );

    const proc = spawnOrkify(
      ['run', crashScript, '-n', 'test-restarts', '--max-restarts', '2', '--silent'],
      {
        stdio: 'pipe',
        detached: false,
      }
    );

    // Should eventually exit after max restarts are exhausted
    const exitCode = await new Promise<null | number>((resolve) => {
      proc.on('exit', (code) => resolve(code));
      setTimeout(() => resolve(null), 30000);
    });

    await waitForDaemonKilled();

    // Process should have exited with code 1 (propagated from child)
    expect(exitCode).toBe(1);
  }, 35000);
});
