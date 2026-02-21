import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { readdir, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

export class RotatingWriter {
  private fd: number;
  private bytesWritten: number;
  private lastRotationDate: string;
  private rotating = false;
  private compressionChain: Promise<void> = Promise.resolve();
  readonly filePath: string;
  private readonly maxSize: number;
  private readonly maxFiles: number;
  private readonly maxAge: number;

  // Cache todayString() — only recompute once per second
  private cachedDateString: string;
  private cachedDateAt = 0;

  constructor(filePath: string, maxSize: number, maxFiles: number, maxAge = 0) {
    this.filePath = filePath;
    this.maxSize = maxSize;
    this.maxFiles = maxFiles;
    this.maxAge = maxAge;

    // Ensure parent directory exists (handles restarts after dir deletion)
    mkdirSync(dirname(filePath), { recursive: true });

    // Seed bytesWritten from existing file
    try {
      this.bytesWritten = statSync(filePath).size;
    } catch {
      this.bytesWritten = 0;
    }

    this.cachedDateString = this.computeDateString();
    this.cachedDateAt = Date.now();
    this.lastRotationDate = this.cachedDateString;
    // Open file descriptor in append mode (creates file if it doesn't exist)
    this.fd = openSync(filePath, 'a');
  }

  write(data: string): void {
    try {
      writeSync(this.fd, data);
    } catch (err) {
      // Self-heal a closed fd (e.g., from a failed rotation on a full disk)
      if ((err as NodeJS.ErrnoException).code === 'EBADF') {
        try {
          mkdirSync(dirname(this.filePath), { recursive: true });
          this.fd = openSync(this.filePath, 'a');
          writeSync(this.fd, data);
        } catch {
          return;
        }
      } else {
        console.error(`Log write error (${this.filePath}):`, (err as Error).message);
        return;
      }
    }
    this.bytesWritten += Buffer.byteLength(data);

    if (this.maxFiles > 0 && !this.rotating) {
      const today = this.todayString();
      if (this.bytesWritten >= this.maxSize || today !== this.lastRotationDate) {
        this.rotate();
      }
    }
  }

  private rotate(): void {
    try {
      this.rotating = true;
      const now = new Date();
      const timestamp = this.formatTimestamp(now);
      const rotatedPath = `${this.filePath}-${timestamp}`;

      // Close the current fd so all data is flushed to the inode
      closeSync(this.fd);

      // Rename the file — the data stays with the inode
      renameSync(this.filePath, rotatedPath);

      // Open a new fd at the original path
      this.fd = openSync(this.filePath, 'a');

      this.bytesWritten = 0;
      this.lastRotationDate = this.todayString();
      this.rotating = false;

      // Chain compressions so they run sequentially and drain() awaits all of them
      this.compressionChain = this.compressionChain
        .then(() => this.compressAndPrune(rotatedPath))
        .catch((err) => {
          console.error(`Log compression error (${rotatedPath}):`, (err as Error).message);
        });
    } catch (err) {
      this.rotating = false;
      console.error(`Log rotation error (${this.filePath}):`, (err as Error).message);
      // Try to re-open fd if it was closed
      try {
        this.fd = openSync(this.filePath, 'a');
      } catch {
        // Nothing more we can do
      }
    }
  }

  private async compressAndPrune(uncompressedPath: string): Promise<void> {
    // Skip if already compressed by a previous call's prune step.
    // Without this guard, createWriteStream truncates the valid .gz to 0 bytes
    // before createReadStream fails with ENOENT, corrupting the archive.
    if (existsSync(uncompressedPath)) {
      const gzPath = `${uncompressedPath}.gz`;
      try {
        await pipeline(createReadStream(uncompressedPath), createGzip(), createWriteStream(gzPath));
        unlinkSync(uncompressedPath);
      } catch (err) {
        console.error(`Log compression error (${uncompressedPath}):`, (err as Error).message);
        // Leave uncompressed file — bare files are cleaned up on next prune cycle
      }
    }

    // Prune old archives and bare files left by failed compressions
    try {
      const dir = dirname(this.filePath);
      const base = basename(this.filePath);
      const files = await readdir(dir);

      // Compress bare timestamped files left by failed/interrupted compressions.
      // If a .gz already exists for the same timestamp (corrupt from crash), replace it.
      const bareFiles = files.filter((f) => f.startsWith(`${base}-`) && !f.endsWith('.gz'));
      for (const bare of bareFiles) {
        const barePath = join(dir, bare);
        if (!existsSync(barePath)) continue;
        const bareGzPath = `${barePath}.gz`;
        try {
          await pipeline(createReadStream(barePath), createGzip(), createWriteStream(bareGzPath));
          await unlink(barePath);
        } catch {
          // If compression fails, delete the bare file to prevent infinite retries
          try {
            await unlink(barePath);
          } catch {
            // Ignore
          }
        }
      }

      // Prune .gz archives by age and count
      const archives = files.filter((f) => f.startsWith(`${base}-`) && f.endsWith('.gz')).sort();

      // Delete archives older than maxAge
      if (this.maxAge > 0) {
        const cutoff = Date.now() - this.maxAge;
        for (let i = archives.length - 1; i >= 0; i--) {
          const ts = this.parseArchiveTimestamp(archives[i], base);
          if (ts > 0 && ts < cutoff) {
            try {
              await unlink(join(dir, archives[i]));
              archives.splice(i, 1);
            } catch {
              // Ignore
            }
          }
        }
      }

      // Delete oldest archives if count exceeds maxFiles
      while (archives.length > this.maxFiles) {
        const oldest = archives.shift() as string;
        try {
          await unlink(join(dir, oldest));
        } catch {
          // Ignore individual delete errors
        }
      }
    } catch {
      // Ignore prune errors
    }
  }

  async flush(): Promise<void> {
    // Wait for any in-flight compression to finish before cleaning up
    await this.compressionChain;

    try {
      closeSync(this.fd);
    } catch {
      // fd may already be closed
    }

    try {
      truncateSync(this.filePath, 0);
    } catch {
      // File may not exist
    }

    // Remove all rotated files (compressed and bare)
    const dir = dirname(this.filePath);
    const base = basename(this.filePath);
    try {
      const files = readdirSync(dir);
      for (const f of files) {
        if (f.startsWith(`${base}-`)) {
          try {
            unlinkSync(join(dir, f));
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore
    }

    this.fd = openSync(this.filePath, 'a');
    this.bytesWritten = 0;
  }

  end(): void {
    try {
      closeSync(this.fd);
    } catch {
      // fd may already be closed
    }
  }

  /** Wait for all pending compressions to complete. */
  async drain(): Promise<void> {
    await this.compressionChain;
  }

  private todayString(): string {
    const now = Date.now();
    // Recompute at most once per second
    if (now - this.cachedDateAt >= 1000) {
      this.cachedDateString = this.computeDateString();
      this.cachedDateAt = now;
    }
    return this.cachedDateString;
  }

  private computeDateString(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  /** Parse epoch ms from archive filename like `app.stdout.log-20260217T143052.123.gz` */
  private parseArchiveTimestamp(filename: string, base: string): number {
    // Extract timestamp portion: after `{base}-` and before `.gz`
    const prefix = `${base}-`;
    if (!filename.startsWith(prefix) || !filename.endsWith('.gz')) return 0;
    const ts = filename.slice(prefix.length, -3); // remove prefix and .gz
    // Format: YYYYMMDDTHHMMSS.mmm
    const match = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{3}))?$/);
    if (!match) return 0;
    const [, y, mo, d, h, mi, s, ms] = match;
    return new Date(+y, +mo - 1, +d, +h, +mi, +s, +(ms || 0)).getTime();
  }

  private formatTimestamp(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const sec = String(date.getSeconds()).padStart(2, '0');
    const milli = String(date.getMilliseconds()).padStart(3, '0');
    return `${y}${m}${d}T${h}${min}${sec}.${milli}`;
  }
}
