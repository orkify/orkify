import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  httpGet,
  orkify,
  waitForProcessOnline,
  waitForProcessRemoved,
  waitForProcessRestart,
} from './test-utils.js';

describe('Watch Mode', () => {
  const appName = 'test-watch';
  let tempDir: string;
  let scriptPath: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-watch-test-')));
    scriptPath = join(tempDir, 'app.js');

    // Create a simple app that responds with a version
    writeFileSync(
      scriptPath,
      `
        const http = require('http');
        const VERSION = 'v1';
        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ version: VERSION, pid: process.pid }));
        });
        server.listen(3001, () => {

        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts with --watch flag', async () => {
    const output = orkify(`up ${scriptPath} -n ${appName} --watch --cwd ${tempDir}`);
    expect(output).toContain(`Process "${appName}" started`);

    // Wait for process to be online
    await waitForProcessOnline(appName);
    const { status, body } = await httpGet('http://localhost:3001/');
    expect(status).toBe(200);
    expect(body).toContain('"version":"v1"');
  }, 15000);

  it('restarts when file changes', async () => {
    // Get initial PID
    const { body: before } = await httpGet('http://localhost:3001/');
    const pidBefore = JSON.parse(before).pid;

    // Modify the file (append to trigger change detection)
    appendFileSync(scriptPath, '\n// modified');

    // Rewrite with new version
    writeFileSync(
      scriptPath,
      `
        const http = require('http');
        const VERSION = 'v2';
        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ version: VERSION, pid: process.pid }));
        });
        server.listen(3001, () => {

        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );

    // Wait for watch to detect change and restart
    const { body: after } = await waitForProcessRestart('http://localhost:3001/', pidBefore);
    expect(after).toContain('"version":"v2"');

    const pidAfter = JSON.parse(after).pid;
    expect(pidAfter).not.toBe(pidBefore);
  });
});

describe('Watch Paths Option', () => {
  const appName = 'test-watch-paths';
  let tempDir: string;
  let scriptPath: string;
  let watchDir: string;
  let watchFile: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-watchpaths-test-')));
    scriptPath = join(tempDir, 'app.js');
    watchDir = join(tempDir, 'watched');
    watchFile = join(watchDir, 'config.json');

    // Create watched directory
    mkdirSync(watchDir, { recursive: true });
    writeFileSync(watchFile, JSON.stringify({ version: 1 }));

    writeFileSync(
      scriptPath,
      `
        const http = require('http');
        const fs = require('fs');
        const configPath = '${watchFile.replace(/\\/g, '\\\\')}';
        let config = JSON.parse(fs.readFileSync(configPath));

        const server = http.createServer((req, res) => {
          // Re-read config on each request
          config = JSON.parse(fs.readFileSync(configPath));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ pid: process.pid, version: config.version }));
        });
        server.listen(3025, () => {

        });
        process.on('SIGTERM', () => server.close(() => process.exit(0)));
      `
    );
  });

  afterAll(() => {
    orkify(`delete ${appName}`);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('watches specific paths with --watch-paths', async () => {
    // Start with watch on specific directory
    const output = orkify(`up ${scriptPath} -n ${appName} --watch --watch-paths ${watchDir}`);
    expect(output).toContain('started');

    await waitForProcessOnline(appName);

    // Get initial PID
    const { body: before } = await httpGet('http://localhost:3025/');
    const pidBefore = JSON.parse(before).pid;

    // Modify the watched file
    writeFileSync(watchFile, JSON.stringify({ version: 2 }));

    // Wait for watch to detect and restart
    const { body: after } = await waitForProcessRestart('http://localhost:3025/', pidBefore);
    const data = JSON.parse(after);
    expect(data.version).toBe(2);
    expect(data.pid).not.toBe(pidBefore);
  }, 20000);

  it('watches multiple paths with --watch-paths', async () => {
    // Clean up and create new structure
    orkify(`delete ${appName}`);
    await waitForProcessRemoved(appName);

    // Create a second watch directory
    const watchDir2 = join(tempDir, 'watched2');
    mkdirSync(watchDir2, { recursive: true });
    const watchFile2 = join(watchDir2, 'extra.json');
    writeFileSync(watchFile2, JSON.stringify({ extra: 1 }));

    // Reset main config
    writeFileSync(watchFile, JSON.stringify({ version: 10 }));

    // Start with multiple watch paths
    const output = orkify(
      `up ${scriptPath} -n ${appName} --watch --watch-paths ${watchDir} ${watchDir2}`
    );
    expect(output).toContain('started');

    await waitForProcessOnline(appName);

    // Get initial PID
    const { body: before } = await httpGet('http://localhost:3025/');
    const pidBefore = JSON.parse(before).pid;

    // Modify the SECOND watched directory (not the main one)
    writeFileSync(watchFile2, JSON.stringify({ extra: 2 }));

    // Wait for watch to detect and restart
    const { body: after } = await waitForProcessRestart('http://localhost:3025/', pidBefore);
    const afterData = JSON.parse(after);
    expect(afterData.pid).not.toBe(pidBefore);
  }, 20000);
});
