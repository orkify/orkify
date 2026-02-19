import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RotatingWriter } from '../../src/daemon/RotatingWriter.js';

describe('RotatingWriter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-rw-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function logPath(name = 'app'): string {
    return join(tempDir, `${name}.stdout.log`);
  }

  function listArchives(name = 'app'): string[] {
    const prefix = `${name}.stdout.log-`;
    return readdirSync(tempDir)
      .filter((f) => f.startsWith(prefix))
      .sort();
  }

  async function readGzipContent(gzPath: string): Promise<string> {
    const chunks: Buffer[] = [];
    await pipeline(
      createReadStream(gzPath),
      createGunzip(),
      new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
      })
    );
    return Buffer.concat(chunks).toString();
  }

  it('writes data to file correctly', () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 1024 * 1024, 5);

    writer.write('hello\n');
    writer.write('world\n');
    writer.end();

    const content = readFileSync(filePath, 'utf8');
    expect(content).toBe('hello\nworld\n');
  });

  it('seeds bytesWritten from existing file on construction', async () => {
    const filePath = logPath();
    writeFileSync(filePath, 'existing data that is 30 bytes');

    // maxSize is 50 — so the file is already 30 bytes towards limit
    const writer = new RotatingWriter(filePath, 50, 5);

    // Write 25 more bytes — total exceeds 50, should trigger rotation
    writer.write('abcdefghijklmnopqrstuvwxy');

    await writer.drain();
    writer.end();

    // The old content should be in a rotated file
    const archives = listArchives();
    expect(archives.length).toBeGreaterThanOrEqual(1);
  });

  it('rotates when maxSize exceeded', async () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 100, 5);

    // Write more than 100 bytes
    const bigLine = 'x'.repeat(120) + '\n';
    writer.write(bigLine);

    await writer.drain();
    writer.end();

    const archives = listArchives();
    expect(archives.length).toBeGreaterThanOrEqual(1);
  });

  it('creates timestamped .gz archive after rotation', async () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 50, 5);

    writer.write('x'.repeat(60));

    await writer.drain();
    writer.end();

    const gzArchives = listArchives().filter((f) => f.endsWith('.gz'));
    expect(gzArchives.length).toBe(1);

    // Verify it's valid gzip and contains original content
    const content = await readGzipContent(join(tempDir, gzArchives[0]));
    expect(content).toBe('x'.repeat(60));
  });

  it('multiple rotations produce chronologically ordered archives', async () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 50, 10);

    // Trigger multiple rotations with small delays to get unique timestamps
    for (let i = 0; i < 3; i++) {
      writer.write('y'.repeat(60));
      await writer.drain();
    }

    writer.end();

    const archives = listArchives().filter((f) => f.endsWith('.gz'));
    expect(archives.length).toBeGreaterThanOrEqual(2);

    // Verify lexicographic order is chronological
    for (let i = 1; i < archives.length; i++) {
      expect(archives[i] > archives[i - 1]).toBe(true);
    }
  });

  it('prunes oldest archives when count exceeds maxFiles', async () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 30, 2);

    // Trigger 4 rotations, but maxFiles=2 so only 2 archives should remain
    for (let i = 0; i < 4; i++) {
      writer.write('z'.repeat(40));
      await writer.drain();
    }

    writer.end();

    const gzArchives = listArchives().filter((f) => f.endsWith('.gz'));
    expect(gzArchives.length).toBeLessThanOrEqual(2);
  });

  it('resets bytesWritten after rotation', async () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 50, 5);

    // Write enough to trigger rotation
    writer.write('a'.repeat(60));
    await writer.drain();

    // Write a small amount — should go to the new file
    writer.write('small\n');
    writer.end();

    const content = readFileSync(filePath, 'utf8');
    // The current file should only contain the post-rotation write
    expect(content).toBe('small\n');
  });

  it('new writes go to fresh file after rotation', async () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 50, 5);

    writer.write('x'.repeat(60));
    await writer.drain();

    writer.write('after-rotation\n');
    writer.end();

    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('after-rotation');
    // Should NOT contain the pre-rotation data
    expect(content.length).toBeLessThan(60);
  });

  it('flush() truncates current file and removes all archives', async () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 50, 5);

    // Create some rotated archives
    writer.write('x'.repeat(60));
    await writer.drain();
    writer.write('y'.repeat(60));
    await writer.drain();

    // Verify archives exist
    expect(listArchives().length).toBeGreaterThan(0);

    await writer.flush();

    // Current file should be empty
    const content = readFileSync(filePath, 'utf8');
    expect(content).toBe('');

    // All archives should be removed
    expect(listArchives().length).toBe(0);

    // Should still be writable after flush
    writer.write('post-flush\n');
    writer.end();
    const postContent = readFileSync(filePath, 'utf8');
    expect(postContent).toBe('post-flush\n');
  });

  it('maxFiles=0 disables rotation entirely', () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 50, 0);

    // Write way more than maxSize
    writer.write('x'.repeat(200));
    writer.end();

    // No archives should be created
    expect(listArchives().length).toBe(0);

    // All data should be in the current file
    const content = readFileSync(filePath, 'utf8');
    expect(content).toBe('x'.repeat(200));
  });

  it('end() closes stream gracefully', () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 1024, 5);

    writer.write('test\n');
    writer.end();

    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toBe('test\n');
  });

  it('rotation errors do not throw or crash', async () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 50, 5);

    // Should not throw even if internal state gets confused
    expect(() => {
      writer.write('x'.repeat(60));
    }).not.toThrow();

    await writer.drain();
    writer.end();
  });

  it('prunes bare files left by failed compressions', async () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 50, 5);

    // Trigger a rotation to create a .gz archive
    writer.write('x'.repeat(60));
    await writer.drain();

    // Simulate a failed compression leftover: a bare timestamped file with no .gz
    const bareFile = `${filePath}-20260101T120000.000`;
    writeFileSync(bareFile, 'stale data from failed compression');

    // Trigger another rotation — prune should clean up the bare file
    writer.write('y'.repeat(60));
    await writer.drain();

    writer.end();

    // The bare file should have been deleted
    expect(existsSync(bareFile)).toBe(false);

    // .gz archives should still exist
    const gzArchives = listArchives().filter((f) => f.endsWith('.gz'));
    expect(gzArchives.length).toBeGreaterThanOrEqual(1);
  });

  it('does not prune unrelated files in the same directory', async () => {
    const filePath = logPath();
    const writer = new RotatingWriter(filePath, 50, 2);

    // Create an unrelated file in the same directory
    const unrelatedFile = join(tempDir, 'other-process.stdout.log');
    writeFileSync(unrelatedFile, 'unrelated');

    // Also create a file that looks similar but belongs to a different process
    const similarFile = join(tempDir, 'app.stderr.log-20260101T120000.000.gz');
    writeFileSync(similarFile, 'different stream');

    // Trigger several rotations to force pruning
    for (let i = 0; i < 4; i++) {
      writer.write('z'.repeat(60));
      await writer.drain();
    }

    writer.end();

    // Unrelated files should still exist
    expect(existsSync(unrelatedFile)).toBe(true);
    expect(existsSync(similarFile)).toBe(true);
  });

  describe('error resilience', () => {
    it('write() self-heals after closed file descriptor', () => {
      const filePath = logPath();
      const writer = new RotatingWriter(filePath, 1024, 5);
      writer.write('before\n');
      writer.end(); // closes fd

      // write() should detect EBADF, re-open the fd, and retry the write
      expect(() => writer.write('after-heal\n')).not.toThrow();
      writer.end();

      // Both writes should be in the file (self-heal re-opened the fd)
      const content = readFileSync(filePath, 'utf8');
      expect(content).toBe('before\nafter-heal\n');
    });

    it('write() self-heals when log directory was deleted', () => {
      const filePath = logPath();
      const writer = new RotatingWriter(filePath, 1024, 5);
      writer.write('before\n');
      writer.end();

      // Delete the entire directory — simulates external cleanup
      rmSync(tempDir, { recursive: true, force: true });

      // write() should re-create the directory, re-open the fd, and write
      expect(() => writer.write('recovered\n')).not.toThrow();
      writer.end();

      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf8');
      expect(content).toBe('recovered\n');
    });

    it('constructor creates parent directory if it does not exist', () => {
      const nestedDir = join(tempDir, 'deep', 'nested', 'logs');
      const filePath = join(nestedDir, 'app.stdout.log');

      // Directory doesn't exist — constructor should create it
      const writer = new RotatingWriter(filePath, 1024, 5);
      writer.write('works\n');
      writer.end();

      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf8');
      expect(content).toBe('works\n');
    });

    it('end() can be called multiple times without throwing', () => {
      const filePath = logPath();
      const writer = new RotatingWriter(filePath, 1024, 5);
      writer.write('data\n');

      writer.end();
      expect(() => writer.end()).not.toThrow();
      expect(() => writer.end()).not.toThrow();
    });

    it('flush() recovers after end() closed the file descriptor', async () => {
      const filePath = logPath();
      const writer = new RotatingWriter(filePath, 50, 5);

      // Create an archive
      writer.write('x'.repeat(60));
      await writer.drain();

      writer.end(); // close fd

      // flush() should handle the closed fd gracefully and re-open
      await writer.flush();

      // Should be writable again after flush re-opens the fd
      writer.write('recovered\n');
      writer.end();

      const content = readFileSync(filePath, 'utf8');
      expect(content).toBe('recovered\n');
    });

    it('bare file content is preserved when compressed during prune', async () => {
      const filePath = logPath();
      const writer = new RotatingWriter(filePath, 50, 100);

      // Trigger a rotation
      writer.write('x'.repeat(60));
      await writer.drain();

      // Simulate a bare file left by a daemon crash mid-rotation
      const bareFile = `${filePath}-20260101T120000.000`;
      writeFileSync(bareFile, 'recovered crash data');

      // Trigger another rotation so prune runs
      writer.write('y'.repeat(60));
      await writer.drain();
      writer.end();

      // Bare file should be gone
      expect(existsSync(bareFile)).toBe(false);

      // A .gz should have been created from it with the original content preserved
      const gzPath = `${bareFile}.gz`;
      expect(existsSync(gzPath)).toBe(true);
      const content = await readGzipContent(gzPath);
      expect(content).toBe('recovered crash data');
    });
  });

  describe('daily rotation', () => {
    it('rotates on first write of a new day', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-02-17T23:59:59.000'));
        const filePath = logPath();
        // Large maxSize so only the daily trigger fires, not the size trigger
        const writer = new RotatingWriter(filePath, 1024 * 1024, 5);

        writer.write('day1\n');

        // Cross midnight — advance past the 1-second cache window
        vi.advanceTimersByTime(2000);

        // This write triggers daily rotation — the data is written first,
        // then rotation happens (same semantics as size-based rotation)
        writer.write('trigger\n');

        // Post-rotation write goes to the new file
        writer.write('new-day\n');

        // Switch to real timers so async I/O in drain() completes
        vi.useRealTimers();
        await writer.drain();
        writer.end();

        // day1 + trigger should be in a rotated archive
        const archives = listArchives();
        expect(archives.length).toBeGreaterThanOrEqual(1);

        // Current file should only have the post-rotation write
        const content = readFileSync(filePath, 'utf8');
        expect(content).toBe('new-day\n');
      } finally {
        vi.useRealTimers();
      }
    });

    it('refreshes date cache after 1 second', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-02-17T12:00:00.000'));
        const filePath = logPath();
        const writer = new RotatingWriter(filePath, 1024 * 1024, 5);

        writer.write('first\n');

        // Advance past the 1-second cache window (covers lines 229-230)
        vi.advanceTimersByTime(1500);

        // This write exercises the cache refresh branch in todayString()
        writer.write('second\n');
        writer.end();

        const content = readFileSync(filePath, 'utf8');
        expect(content).toBe('first\nsecond\n');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('age-based pruning', () => {
    it('prunes archives older than maxAge', async () => {
      const filePath = logPath();
      // maxAge = 1ms — everything is immediately "old"
      const writer = new RotatingWriter(filePath, 30, 100, 1);

      // Trigger a rotation
      writer.write('x'.repeat(40));
      await writer.drain();

      // Wait a tiny bit so the archive timestamp is older than 1ms
      await new Promise((r) => setTimeout(r, 10));

      // Trigger another rotation — compressAndPrune should delete the aged-out archive
      writer.write('y'.repeat(40));
      await writer.drain();

      writer.end();

      // With maxAge=1ms, the first archive should have been pruned by the second rotation
      const gzArchives = listArchives().filter((f) => f.endsWith('.gz'));
      expect(gzArchives.length).toBeLessThanOrEqual(1);
    });

    it('keeps recent archives when maxAge is large', async () => {
      const filePath = logPath();
      // maxAge = 1 hour — nothing should be pruned
      const writer = new RotatingWriter(filePath, 30, 100, 60 * 60 * 1000);

      for (let i = 0; i < 3; i++) {
        writer.write('z'.repeat(40));
        await writer.drain();
      }

      writer.end();

      // All archives should still exist
      const gzArchives = listArchives().filter((f) => f.endsWith('.gz'));
      expect(gzArchives.length).toBeGreaterThanOrEqual(2);
    });

    it('maxAge=0 disables age-based pruning', async () => {
      const filePath = logPath();
      // maxAge = 0, maxFiles = 100 — no age pruning, no count pruning
      const writer = new RotatingWriter(filePath, 30, 100, 0);

      for (let i = 0; i < 3; i++) {
        writer.write('a'.repeat(40));
        await writer.drain();
      }

      writer.end();

      const gzArchives = listArchives().filter((f) => f.endsWith('.gz'));
      expect(gzArchives.length).toBeGreaterThanOrEqual(2);
    });

    it('age pruning and count pruning work together', async () => {
      const filePath = logPath();
      // maxAge = 1ms (prune everything old), maxFiles = 1 (keep at most 1)
      const writer = new RotatingWriter(filePath, 30, 1, 1);

      writer.write('x'.repeat(40));
      await writer.drain();

      await new Promise((r) => setTimeout(r, 10));

      writer.write('y'.repeat(40));
      await writer.drain();

      await new Promise((r) => setTimeout(r, 10));

      writer.write('z'.repeat(40));
      await writer.drain();

      writer.end();

      // With maxAge=1ms and maxFiles=1, at most 1 archive should remain
      const gzArchives = listArchives().filter((f) => f.endsWith('.gz'));
      expect(gzArchives.length).toBeLessThanOrEqual(1);
    });
  });
});
