import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ORKIFY_CONFIG_FILE } from '../../src/constants.js';
import { createTarball } from '../../src/deploy/tarball.js';
import { httpGet, orkify, sleep, waitForHttpReady, waitForProcessOnline } from './test-utils.js';

const PORT = '4200';
const APP_NAME = 'deploy-test';

function makeAppJs(version: string): string {
  return `
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  if (req.url === '/version') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('${version}');
    return;
  }
  res.writeHead(200);
  res.end('hello ${version}');
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

server.listen(${PORT});
`;
}

function makeOrkifyYml(): string {
  return `version: 1
deploy:
  install: echo ok
processes:
  - name: ${APP_NAME}
    script: app.js
    workerCount: 1
    cwd: .
    execMode: fork
    watch: false
    env: {}
    nodeArgs: []
    args: []
    killTimeout: 5000
    maxRestarts: 10
    minUptime: 1000
    restartDelay: 100
    sticky: false
`;
}

describe('Deploy Local E2E', () => {
  const tempDirs: string[] = [];

  function createProjectDir(version: string): string {
    const dir = mkdtempSync(join(tmpdir(), `orkify-deploy-e2e-${version}-`));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'deploy-test', version: '1.0.0' })
    );
    writeFileSync(join(dir, 'app.js'), makeAppJs(version));
    writeFileSync(join(dir, ORKIFY_CONFIG_FILE), makeOrkifyYml());
    return dir;
  }

  afterAll(() => {
    orkify(`delete ${APP_NAME}`);
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts v1 app', async () => {
    const v1Dir = createProjectDir('v1');
    const output = orkify(`up ${join(v1Dir, 'app.js')} -n ${APP_NAME}`);
    expect(output).toContain(`Process "${APP_NAME}" started`);

    await waitForProcessOnline(APP_NAME);
    await waitForHttpReady(`http://localhost:${PORT}/version`);

    const { status, body } = await httpGet(`http://localhost:${PORT}/version`);
    expect(status).toBe(200);
    expect(body).toBe('v1');
  });

  it('deploys v2 via deploy local and replaces v1', async () => {
    // Create v2 project and tarball
    const v2Dir = createProjectDir('v2');
    const tarPath = await createTarball(v2Dir);

    // Deploy v2
    const output = orkify(`deploy local "${tarPath}"`, 60000);
    expect(output).toContain('Deploy complete');

    // Wait for the new version to come up
    await sleep(2000);
    await waitForHttpReady(`http://localhost:${PORT}/version`);

    // Verify v2 is running
    const { status, body } = await httpGet(`http://localhost:${PORT}/version`);
    expect(status).toBe(200);
    expect(body).toBe('v2');

    rmSync(tarPath);
  }, 60000);

  it('deploys v3 to confirm repeated deploys work', async () => {
    const v3Dir = createProjectDir('v3');
    const tarPath = await createTarball(v3Dir);

    const output = orkify(`deploy local "${tarPath}"`, 60000);
    expect(output).toContain('Deploy complete');

    await sleep(2000);
    await waitForHttpReady(`http://localhost:${PORT}/version`);

    const { status, body } = await httpGet(`http://localhost:${PORT}/version`);
    expect(status).toBe(200);
    expect(body).toBe('v3');

    rmSync(tarPath);
  }, 60000);
});
