import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BIN } from './setup.js';
import { orkify, sleep, waitForDaemonKilled } from './test-utils.js';

describe('startup-lock', () => {
  const DAEMON_LOG = join(homedir(), '.orkify', 'daemon.log');

  afterAll(() => {
    orkify('down all');
    orkify('delete all');
    orkify('kill');
  });

  it('concurrent CLI invocations spawn only one daemon', async () => {
    // Kill any existing daemon
    orkify('kill');
    await waitForDaemonKilled();

    // Record current log length to only check new entries
    let logOffset = 0;
    try {
      logOffset = readFileSync(DAEMON_LOG, 'utf-8').length;
    } catch {
      // No log file yet
    }

    // Spawn two CLI commands simultaneously — both will try to auto-start the daemon
    const p1 = spawn('node', [BIN, 'list'], { stdio: 'pipe' });
    const p2 = spawn('node', [BIN, 'list'], { stdio: 'pipe' });

    // Wait for both to complete
    await Promise.all([
      new Promise<void>((resolve) => p1.on('close', () => resolve())),
      new Promise<void>((resolve) => p2.on('close', () => resolve())),
    ]);

    // Give daemon a moment to write log
    await sleep(500);

    // Read new log entries
    const fullLog = readFileSync(DAEMON_LOG, 'utf-8');
    const newEntries = fullLog.slice(logOffset);

    // Count "daemon started" lines — should be exactly 1
    const startedLines = newEntries
      .split('\n')
      .filter((line) => line.includes('ORKIFY daemon started'));
    expect(startedLines.length).toBe(1);
  }, 30000);
});
