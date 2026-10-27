import { closeSync, openSync, unlinkSync, writeSync } from 'node:fs';

/**
 * Create `path` exclusively (O_EXCL) and write our PID into it. Returns the
 * open fd. If the write fails (e.g. ENOSPC on a full disk) the half-created
 * file is removed rather than left behind empty, the fd is closed, and the
 * error propagates. Throws EEXIST when the file already exists.
 */
export function createPidFile(path: string): number {
  const fd = openSync(path, 'wx');
  try {
    writeSync(fd, String(process.pid));
    return fd;
  } catch (err) {
    closeSync(fd);
    try {
      unlinkSync(path);
    } catch {
      // already gone
    }
    throw err;
  }
}
