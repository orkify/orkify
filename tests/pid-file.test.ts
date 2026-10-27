import { closeSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({ failWrite: null as NodeJS.ErrnoException | null }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeSync: ((...args: Parameters<typeof actual.writeSync>) => {
      if (fsState.failWrite) throw fsState.failWrite;
      return actual.writeSync(...args);
    }) as typeof actual.writeSync,
  };
});

const { createPidFile } = await import('../src/pid-file.js');

describe('createPidFile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orkify-pidfile-'));
  let n = 0;
  const fresh = () => join(dir, `lock-${n++}`);

  afterEach(() => {
    fsState.failWrite = null;
  });

  it('creates the file with our PID', () => {
    const path = fresh();
    closeSync(createPidFile(path));
    expect(readFileSync(path, 'utf-8')).toBe(String(process.pid));
  });

  it('throws EEXIST and leaves an existing file untouched', () => {
    const path = fresh();
    writeFileSync(path, '4242');
    expect(() => createPidFile(path)).toThrow(expect.objectContaining({ code: 'EEXIST' }));
    expect(readFileSync(path, 'utf-8')).toBe('4242');
  });

  it('removes the half-created file when the PID write fails (full disk)', () => {
    const path = fresh();
    fsState.failWrite = Object.assign(new Error('ENOSPC: no space left on device'), {
      code: 'ENOSPC',
    });

    expect(() => createPidFile(path)).toThrow(expect.objectContaining({ code: 'ENOSPC' }));
    // No empty lock left behind to confuse the next start.
    expect(existsSync(path)).toBe(false);
  });
});
