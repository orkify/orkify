import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXAMPLES, ORKIFY_HOME } from './setup.js';
import {
  httpGet,
  orkify,
  orkifyWithEnv,
  waitForDaemonKilled,
  waitForHttpReady,
  waitForProcessOnline,
  waitForProcessRemoved,
  waitForProcessStopped,
} from './test-utils.js';

describe('Fork Mode', () => {
  const appName = 'test-fork';

  afterAll(() => {
    orkify(`delete ${appName}`);
  });

  it('starts a process', () => {
    const output = orkifyWithEnv(`up ${EXAMPLES}/basic/app.js -n ${appName}`, { PORT: '4000' });
    expect(output).toContain(`Process "${appName}" started`);
    expect(output).toContain('Mode: fork');
  });

  it('lists running process', async () => {
    await waitForProcessOnline(appName);
    const output = orkify('list');
    expect(output).toContain(appName);
    expect(output).toContain('online');
    expect(output).toContain('fork');
  });

  it('process responds to HTTP requests', async () => {
    await waitForProcessOnline(appName, 4000);
    const { status, body } = await httpGet('http://localhost:4000/health');
    expect(status).toBe(200);
    expect(body).toContain('"status":"ok"');
  });

  it('restarts process', () => {
    const output = orkify(`restart ${appName}`);
    expect(output).toContain('restarted');
  });

  it('stops process', async () => {
    const output = orkify(`down ${appName}`);
    expect(output).toContain('stopped');

    await waitForProcessStopped(appName);
    const { status } = await httpGet('http://localhost:4000/health');
    expect(status).toBe(0);
  });

  it('shows stopped status after stop (not stuck on stopping)', async () => {
    // Restart the stopped process
    orkify(`restart ${appName}`);
    await waitForProcessOnline(appName);

    // Verify it's online
    let list = orkify('list');
    expect(list).toContain('online');

    // Stop it
    orkify(`down ${appName}`);
    await waitForProcessStopped(appName);

    // Status should be "stopped", not "stopping"
    list = orkify('list');
    expect(list).toContain('stopped');
    expect(list).not.toContain('stopping');
  });

  it('uses fork mode when -w 1 is specified (not cluster)', async () => {
    // Clean up first
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    // Start with explicit -w 1
    const output = orkifyWithEnv(`up ${EXAMPLES}/basic/app.js -n ${appName} -w 1`, {
      PORT: '4000',
    });

    // Should use fork mode, not cluster mode
    expect(output).toContain('Mode: fork');
    expect(output).not.toContain('cluster');

    await waitForProcessOnline(appName);

    // List should show fork mode, no workers
    const list = orkify('list');
    expect(list).toContain('fork');
    expect(list).not.toContain('cluster');
    expect(list).not.toContain('worker 0');
    expect(list).not.toContain('worker 1');
  }, 10000);
});

describe('State Persistence', () => {
  const appName = 'test-persist';

  it('saves process state', async () => {
    orkifyWithEnv(`up ${EXAMPLES}/basic/app.js -n ${appName}`, { PORT: '4000' });
    await waitForProcessOnline(appName);

    const output = orkify('snap');
    expect(output).toContain('saved');
    expect(existsSync(join(ORKIFY_HOME, 'snapshot.yml'))).toBe(true);
  });

  it('restores after daemon kill', async () => {
    orkify('kill');
    await waitForDaemonKilled();

    const output = orkify('restore');
    expect(output).toContain('Restored');
    expect(output).toContain(appName);

    // Wait for HTTP server to actually be ready, not just process marked as "online"
    await waitForHttpReady('http://localhost:4000/health', 10000);
    const { status } = await httpGet('http://localhost:4000/health');
    expect(status).toBe(200);
  });

  it('cleans up', () => {
    orkify(`delete ${appName}`);
    const output = orkify('list');
    expect(output).not.toContain(appName);
  });
});
