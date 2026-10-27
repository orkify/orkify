import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ORKIFY_HOME } from './setup.js';
import { orkify } from './test-utils.js';

/**
 * A daemon that dies mid-write (e.g. disk full) can leave EMPTY lock / PID
 * files behind. The next start must treat them as stale and come up — not
 * wait on a lock holder that doesn't exist.
 */
describe('stale empty lock files', () => {
  afterAll(() => {
    try {
      orkify('kill');
    } catch {
      /* cleanup */
    }
  });

  it('starts the daemon over an empty daemon.lock and daemon.pid', () => {
    try {
      orkify('kill');
    } catch {
      /* no daemon running */
    }

    writeFileSync(join(ORKIFY_HOME, 'daemon.lock'), '');
    writeFileSync(join(ORKIFY_HOME, 'daemon.pid'), '');

    // Auto-starts the daemon; throws if startup fails.
    orkify('list');

    const pid = parseInt(readFileSync(join(ORKIFY_HOME, 'daemon.pid'), 'utf-8').trim(), 10);
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).not.toThrow();
    // The client's startup lock is released once the daemon is up.
    expect(existsSync(join(ORKIFY_HOME, 'daemon.lock'))).toBe(false);
  }, 30000);
});
