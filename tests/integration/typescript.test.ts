import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  httpGet,
  orkify,
  orkifyWithEnv,
  waitForProcessOnline,
  waitForProcessRemoved,
  waitForWorkersOnline,
} from './test-utils.js';

const TS_APP = `
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

interface HealthResponse {
  status: string;
  pid: number;
  worker: string;
  typescript: boolean;
}

const PORT: number = parseInt(process.env.PORT || '3000', 10);
const WORKER_ID: string = process.env.ORKIFY_WORKER_ID || '0';

function buildHealth(): HealthResponse {
  return {
    status: 'ok',
    pid: process.pid,
    worker: WORKER_ID,
    typescript: true,
  };
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const health: HealthResponse = buildHealth();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(health));
});

server.listen(PORT, () => {
  console.log(\`TypeScript app listening on port \${PORT}\`);
});
`;

describe('TypeScript support', () => {
  const appDir = join(tmpdir(), `orkify-ts-test-${process.pid}`);
  const appFile = join(appDir, 'app.ts');
  const PORT_FORK = '4200';
  const PORT_CLUSTER = '4201';
  const forkName = 'test-ts-fork';
  const clusterName = 'test-ts-cluster';

  beforeAll(() => {
    mkdirSync(appDir, { recursive: true });
    writeFileSync(appFile, TS_APP);
  });

  afterAll(() => {
    try {
      orkify(`delete ${forkName}`);
    } catch {
      /* cleanup */
    }
    try {
      orkify(`delete ${clusterName}`);
    } catch {
      /* cleanup */
    }
    rmSync(appDir, { recursive: true, force: true });
  });

  it('runs a .ts file in fork mode', async () => {
    const output = orkifyWithEnv(`up ${appFile} -n ${forkName}`, { PORT: PORT_FORK });
    expect(output).toContain(`Process "${forkName}" started`);
    expect(output).toContain('Mode: fork');

    await waitForProcessOnline(forkName);

    const { status, body } = await httpGet(`http://localhost:${PORT_FORK}/`);
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(data.typescript).toBe(true);
    expect(data.status).toBe('ok');
  });

  it('runs a .ts file in cluster mode', async () => {
    const output = orkifyWithEnv(`up ${appFile} -n ${clusterName} -w 2`, { PORT: PORT_CLUSTER });
    expect(output).toContain(`Process "${clusterName}" started`);
    expect(output).toContain('Mode: cluster');

    await waitForWorkersOnline(clusterName, 2);

    const { status, body } = await httpGet(`http://localhost:${PORT_CLUSTER}/`);
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(data.typescript).toBe(true);
    expect(data.status).toBe('ok');
  });

  it('cleans up', async () => {
    orkify(`delete ${forkName}`);
    orkify(`delete ${clusterName}`);
    await waitForProcessRemoved(forkName);
    await waitForProcessRemoved(clusterName);
    const list = orkify('list');
    expect(list).not.toContain(forkName);
    expect(list).not.toContain(clusterName);
  });
});
