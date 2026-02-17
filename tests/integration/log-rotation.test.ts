import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orkify, sleep, waitForProcessOnline } from './test-utils.js';

describe('Log Rotation', () => {
  const appName = 'test-log-rotation';
  let tempDir: string;
  let scriptPath: string;
  const logsDir = join(homedir(), '.orkify', 'logs');

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-logrot-test-')));
    scriptPath = join(tempDir, 'app.js');

    // Create an app that generates log output on demand
    writeFileSync(
      scriptPath,
      `
        const http = require('http');
        const server = http.createServer((req, res) => {
          if (req.url === '/generate') {
            // Write a large chunk to stdout to trigger rotation
            const chunk = 'X'.repeat(512) + '\\n';
            for (let i = 0; i < 5; i++) {
              process.stdout.write(chunk);
            }
            res.writeHead(200);
            res.end('generated');
            return;
          }
          res.writeHead(200);
          res.end('ok');
        });
        server.listen(3048, () => {
          if (process.send) process.send('ready');
        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rotates log files when size threshold is exceeded', async () => {
    // Start process with small rotation size to trigger rotation quickly
    orkify(`up ${scriptPath} -n ${appName} --log-max-size 1024 --log-max-files 3`);
    await waitForProcessOnline(appName);

    // Generate enough output to exceed the 1024 byte threshold
    for (let i = 0; i < 5; i++) {
      await fetch('http://localhost:3048/generate');
      await sleep(100);
    }

    // Wait for rotation and compression to complete
    await sleep(1500);

    // Check that the current log file exists
    const currentLog = join(logsDir, `${appName}.stdout.log`);
    expect(existsSync(currentLog)).toBe(true);

    // Check for rotated archives
    const files = readdirSync(logsDir);
    const gzArchives = files.filter(
      (f) => f.startsWith(`${appName}.stdout.log-`) && f.endsWith('.gz')
    );

    expect(gzArchives.length).toBeGreaterThan(0);

    // Verify the .gz file is valid gzip
    const firstArchive = join(logsDir, gzArchives[0]);
    const chunks: Buffer[] = [];
    await pipeline(
      createReadStream(firstArchive),
      createGunzip(),
      new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
      })
    );
    const content = Buffer.concat(chunks).toString();
    expect(content.length).toBeGreaterThan(0);

    // Current file should be smaller than max size (freshly rotated)
    const currentSize = readFileSync(currentLog).length;
    // Allow some margin — writes can happen between rotation check and new file open
    expect(currentSize).toBeLessThan(10 * 1024);
  }, 30000);

  it('orkify logs still works after rotation', () => {
    const logs = orkify(`logs ${appName} --lines 10`);
    // Should still return output without errors
    expect(logs).not.toContain('Error');
  });

  it('orkify flush truncates logs and removes archives', async () => {
    // Verify archives exist first
    const filesBefore = readdirSync(logsDir);
    const archivesBefore = filesBefore.filter(
      (f) => f.startsWith(`${appName}.stdout.log-`) && f.endsWith('.gz')
    );
    expect(archivesBefore.length).toBeGreaterThan(0);

    // Run flush
    const result = orkify(`flush ${appName}`);
    expect(result).toContain('flushed');

    // Archives should be removed
    const filesAfter = readdirSync(logsDir);
    const archivesAfter = filesAfter.filter(
      (f) => f.startsWith(`${appName}.stdout.log-`) && f.endsWith('.gz')
    );
    expect(archivesAfter.length).toBe(0);

    // Current log file should be empty
    const currentLog = join(logsDir, `${appName}.stdout.log`);
    if (existsSync(currentLog)) {
      const content = readFileSync(currentLog, 'utf8');
      expect(content.length).toBe(0);
    }
  }, 15000);

  it('logs are captured after restart', async () => {
    // Restart the process — this exercises the setupLogStreams() re-creation path
    const restartOutput = orkify(`restart ${appName}`);
    expect(restartOutput).toContain('restarted');

    await waitForProcessOnline(appName);

    // Generate log output after restart
    for (let i = 0; i < 3; i++) {
      await fetch('http://localhost:3048/generate');
      await sleep(100);
    }
    await sleep(500);

    // Verify the log file has new content written after the restart
    const currentLog = join(logsDir, `${appName}.stdout.log`);
    expect(existsSync(currentLog)).toBe(true);
    const content = readFileSync(currentLog, 'utf8');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('X');
  }, 30000);
});
