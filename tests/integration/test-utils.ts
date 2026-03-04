import { execSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

const BIN = join(process.cwd(), 'bin', 'orkify');

/**
 * Execute a orkify command and return the output
 */
export function orkify(args: string, timeout = 30000): string {
  try {
    return execSync(`node ${BIN} ${args}`, {
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'], // Capture stderr silently
    }).trim();
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string };
    return ((error.stdout || '') + (error.stderr || '')).trim();
  }
}

/**
 * Execute a orkify command with extra environment variables and return the output.
 */
export function orkifyWithEnv(args: string, env: Record<string, string>, timeout = 30000): string {
  try {
    return execSync(`node ${BIN} ${args}`, {
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    }).trim();
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string };
    return ((error.stdout || '') + (error.stderr || '')).trim();
  }
}

/**
 * Execute a orkify command and wait for output to contain expected text.
 * Resolves as soon as expected text appears in output (doesn't wait for process to exit).
 */
export async function orkifyWaitFor(
  args: string,
  expectedText: string,
  maxWait = 30000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [BIN, ...args.split(' ')], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        proc.kill();
        reject(new Error(`Timeout after ${maxWait}ms. Output: ${output}`));
      }
    }, maxWait);

    const checkAndResolve = () => {
      if (!resolved && output.includes(expectedText)) {
        resolved = true;
        clearTimeout(timer);
        proc.kill(); // Don't wait for process to exit
        resolve(output);
      }
    };

    proc.stdout?.on('data', (data) => {
      output += data.toString();
      checkAndResolve();
    });

    proc.stderr?.on('data', (data) => {
      output += data.toString();
      checkAndResolve();
    });

    proc.on('close', (code) => {
      if (!resolved) {
        clearTimeout(timer);
        reject(
          new Error(
            `Process exited (code ${code}) without expected text "${expectedText}". Got: ${output}`
          )
        );
      }
    });
  });
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTTP GET request helper
 */
export async function httpGet(url: string): Promise<{ status: number; body: string }> {
  try {
    const response = await fetch(url);
    const body = await response.text();
    return { status: response.status, body };
  } catch {
    return { status: 0, body: '' };
  }
}

/**
 * Wait until a process shows as "online" in orkify list.
 * Polls at ~100ms intervals for fast detection.
 */
export async function waitForProcessOnline(name: string, maxWait = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const list = orkify('list');
    // Check if process name is listed and shows "online" status
    // We need to be careful to match the specific process, not just any online process
    const lines = list.split('\n');
    for (const line of lines) {
      if (line.includes(name) && line.includes('online')) {
        return;
      }
    }
    await sleep(100);
  }
  throw new Error(`Process "${name}" not online after ${maxWait}ms`);
}

/**
 * Wait until cluster workers are online.
 * Can filter by process name and optionally verify HTTP endpoint.
 */
export async function waitForWorkersOnline(
  nameOrWorkers: number | string,
  expectedWorkersOrPort?: number,
  portOrMaxWait?: number,
  maxWait = 30000
): Promise<void> {
  // Support both signatures:
  // waitForWorkersOnline(name, expectedWorkers, maxWait?)
  // waitForWorkersOnline(expectedWorkers, port?, maxWait?)
  let name: string | undefined;
  let expectedWorkers: number;
  let port: number | undefined;
  let timeout: number;

  if (typeof nameOrWorkers === 'string') {
    // waitForWorkersOnline(name, expectedWorkers, maxWait?)
    name = nameOrWorkers;
    expectedWorkers = expectedWorkersOrPort ?? 1;
    port = undefined;
    timeout = portOrMaxWait ?? maxWait;
  } else {
    // waitForWorkersOnline(expectedWorkers, port?, maxWait?)
    name = undefined;
    expectedWorkers = nameOrWorkers;
    port = expectedWorkersOrPort;
    timeout = portOrMaxWait ?? maxWait;
  }

  const start = Date.now();
  while (Date.now() - start < timeout) {
    const list = orkify('list');

    // If name specified, check that process is in the list
    if (name && !list.includes(name)) {
      await sleep(50);
      continue;
    }

    // Count online workers (lines with both "worker" and "online")
    const lines = list.split('\n');
    const onlineWorkers = lines.filter(
      (line) => line.includes('worker') && line.includes('online')
    ).length;

    // Check if we have enough online workers
    if (onlineWorkers >= expectedWorkers) {
      // If port specified, also verify HTTP is responding
      if (port) {
        const { status } = await httpGet(`http://localhost:${port}/health`);
        if (status === 200) return;
      } else {
        return;
      }
    }
    await sleep(50);
  }
  throw new Error(`Workers not ready after ${timeout}ms`);
}

/**
 * Wait until cluster is fully ready with HTTP health check.
 * More strict than waitForWorkersOnline - requires HTTP to respond.
 */
export async function waitForClusterReady(
  expectedWorkers: number,
  port: number,
  maxWait = 30000,
  healthPath = '/health'
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const list = orkify('list');
    // Count online workers (lines with both "worker" and "online")
    const lines = list.split('\n');
    const onlineWorkers = lines.filter(
      (line) => line.includes('worker') && line.includes('online')
    ).length;

    if (onlineWorkers >= expectedWorkers) {
      const { status } = await httpGet(`http://localhost:${port}${healthPath}`);
      if (status === 200) {
        return;
      }
    }
    await sleep(100);
  }
  throw new Error(`Cluster not ready after ${maxWait}ms`);
}

/**
 * Wait until a process shows as "stopped" in orkify list.
 */
export async function waitForProcessStopped(name: string, maxWait = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const list = orkify('list');
    const lines = list.split('\n');
    for (const line of lines) {
      if (line.includes(name) && line.includes('stopped')) {
        return;
      }
    }
    await sleep(100);
  }
  throw new Error(`Process "${name}" not stopped after ${maxWait}ms`);
}

/**
 * Wait until a process is removed from orkify list.
 */
export async function waitForProcessRemoved(name: string, maxWait = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const list = orkify('list');
    if (!list.includes(name)) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Process "${name}" still in list after ${maxWait}ms`);
}

/**
 * Wait until the daemon is killed (socket/pipe removed AND process dead).
 * Note: Can't use orkify list because that would auto-start the daemon.
 */
export async function waitForDaemonKilled(maxWait = 5000): Promise<void> {
  const start = Date.now();

  // Read daemon PID before waiting — we'll verify it's dead after the
  // socket/pipe disappears to avoid races on Windows where the pipe closes
  // before the process fully exits.
  let daemonPid: null | number = null;
  const pidFile = join(homedir(), '.orkify', 'daemon.pid');
  try {
    daemonPid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (Number.isNaN(daemonPid)) daemonPid = null;
  } catch {
    // No PID file — daemon may already be gone
  }

  if (process.platform === 'win32') {
    // On Windows, check if the Named Pipe still exists
    const username = userInfo().username;
    const pipeName = `orkify-${username}`;
    while (Date.now() - start < maxWait) {
      try {
        const pipes = readdirSync('\\\\.\\pipe');
        if (!pipes.includes(pipeName)) {
          break;
        }
      } catch {
        // Pipe directory not readable, assume daemon is gone
        break;
      }
      await sleep(50);
    }
    if (Date.now() - start >= maxWait) {
      throw new Error(`Daemon pipe still exists after ${maxWait}ms`);
    }
  } else {
    // On Unix, check if the socket file still exists
    const socketPath = join(homedir(), '.orkify', 'orkify.sock');
    while (Date.now() - start < maxWait) {
      if (!existsSync(socketPath)) {
        break;
      }
      await sleep(50);
    }
    if (Date.now() - start >= maxWait) {
      throw new Error(`Daemon socket still exists after ${maxWait}ms`);
    }
  }

  // Also wait for the daemon process to fully exit — on Windows the pipe
  // can disappear before the process finishes cleanup.
  if (daemonPid) {
    const remaining = maxWait - (Date.now() - start);
    if (remaining > 0) {
      await waitForPidDead(daemonPid, remaining);
    }
  }
}

/**
 * Wait until a specific process is no longer alive.
 * Uses `kill -0` to check without sending a signal.
 */
export async function waitForPidDead(pid: number, maxWait = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      process.kill(pid, 0);
      // Process still alive, keep waiting
    } catch {
      // Process is dead
      return;
    }
    await sleep(50);
  }
  throw new Error(`PID ${pid} still alive after ${maxWait}ms`);
}

/**
 * Wait until the daemon is ready to accept commands after a kill/restart.
 * Runs `orkify list` in a retry loop until it succeeds without error.
 */
export async function waitForDaemonReady(maxWait = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const output = orkify('list');
    // A working daemon returns table output (contains │) or "No processes"
    if (output.includes('│') || output.toLowerCase().includes('no processes')) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Daemon not ready after ${maxWait}ms`);
}

/**
 * Wait until an HTTP endpoint responds with 200.
 * Useful for foreground/run mode tests where we can't use orkify list.
 */
export async function waitForHttpReady(url: string, maxWait = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet
    }
    await sleep(50);
  }
  throw new Error(`HTTP endpoint ${url} not ready after ${maxWait}ms`);
}

/**
 * Wait until a process restarts (PID changes) by polling an HTTP endpoint.
 * Useful for watch mode tests where we need to detect file-triggered restarts.
 */
export async function waitForProcessRestart(
  url: string,
  initialPid: number,
  maxWait = 10000
): Promise<{ pid: number; body: string }> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.text();
        const data = JSON.parse(body);
        const currentPid = data.pid;
        if (currentPid && currentPid !== initialPid) {
          return { pid: currentPid, body };
        }
      }
    } catch {
      // Process might be restarting, keep polling
    }
    await sleep(50);
  }
  throw new Error(`Process did not restart (PID change) after ${maxWait}ms`);
}

/**
 * Disconnect a Socket.IO client and wait for the disconnect to complete.
 */
export async function disconnectSocket(
  client: {
    disconnect: () => void;
    on: (event: string, cb: () => void) => void;
    connected: boolean;
  },
  timeout = 1000
): Promise<void> {
  if (!client.connected) {
    return;
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeout);
    client.on('disconnect', () => {
      clearTimeout(timer);
      resolve();
    });
    client.disconnect();
  });
}
