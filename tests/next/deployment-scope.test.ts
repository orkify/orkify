import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextCacheEntry } from '../../packages/next/src/types.js';
import { CacheClient } from '../../packages/cache/src/CacheClient.js';
import {
  _resetDeploymentScope,
  deploymentScope,
  ENTRY_MAX_TTL,
} from '../../packages/next/src/scope.js';
import { bufferToStream } from '../../packages/next/src/stream.js';

let testClient: CacheClient;

vi.mock('@orkify/cache', () => ({
  cache: new Proxy(
    {},
    {
      get(_t, prop) {
        const v = Reflect.get(testClient, prop);
        return typeof v === 'function' ? v.bind(testClient) : v;
      },
    }
  ),
}));

const { default: IsrHandler } = await import('../../packages/next/src/isr-cache.js');
const { default: useCache } = await import('../../packages/next/src/use-cache.js');

const entry = (over: Partial<NextCacheEntry> = {}): NextCacheEntry => ({
  value: bufferToStream(Buffer.from('page')),
  tags: [],
  stale: 0,
  timestamp: Date.now(),
  expire: 0,
  revalidate: 0,
  ...over,
});

/** Simulate a new deploy: new id, fresh module-level memo. */
function deploy(id: string | undefined) {
  if (id === undefined) vi.stubEnv('NEXT_DEPLOYMENT_ID', '');
  else vi.stubEnv('NEXT_DEPLOYMENT_ID', id);
  _resetDeploymentScope();
}

describe('deployment-scoped Next cache', () => {
  beforeEach(() => {
    testClient = new CacheClient();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    _resetDeploymentScope();
  });

  it('a new deployment never sees the previous deployment’s ISR pages', async () => {
    const isr = new IsrHandler();
    deploy('v1-aaaa-1');
    await isr.set('/about', { kind: 'APP_PAGE', html: 'old build' });
    expect(await isr.get('/about')).not.toBeNull();

    deploy('v1-aaaa-2'); // same artifact redeployed → new id
    expect(await isr.get('/about')).toBeNull();
  });

  it('a new deployment never sees the previous deployment’s "use cache" entries', async () => {
    deploy('d1');
    await useCache.set('k', Promise.resolve(entry()));
    expect(await useCache.get('k', [])).toBeDefined();

    deploy('d2');
    expect(await useCache.get('k', [])).toBeUndefined();
  });

  it('only writes under the next:isr: / next:cache: namespaces', async () => {
    deploy('d1');
    await new IsrHandler().set('/p', { kind: 'APP_PAGE' });
    await useCache.set('k', Promise.resolve(entry()));
    expect(testClient.has('next:isr:d1:/p')).toBe(true);
    expect(testClient.has('next:cache:d1:k')).toBe(true);
    expect(testClient.has('/p')).toBe(false);
    expect(testClient.has('k')).toBe(false);
  });

  it('caps entry TTL so old deployments age out of the store', async () => {
    const setSpy = vi.spyOn(testClient, 'set');
    deploy('d1');
    await new IsrHandler().set('/p', { kind: 'APP_PAGE' });
    await useCache.set('inf', Promise.resolve(entry({ expire: 0xfffffffe })));
    await useCache.set('short', Promise.resolve(entry({ expire: 60 })));

    const ttlOf = (key: string) =>
      (setSpy.mock.calls.find((c) => c[0] === key)?.[2] as { ttl?: number }).ttl;
    expect(ttlOf('next:isr:d1:/p')).toBe(ENTRY_MAX_TTL);
    expect(ttlOf('next:cache:d1:inf')).toBe(ENTRY_MAX_TTL);
    expect(ttlOf('next:cache:d1:short')).toBe(60);
  });

  it('falls back to .next/BUILD_ID when no deployment id is set (orkify up/run)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkify-scope-'));
    mkdirSync(join(dir, '.next'));
    writeFileSync(join(dir, '.next', 'BUILD_ID'), 'abc123\n');
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    deploy(undefined);
    expect(deploymentScope()).toBe('abc123');
  });

  it('falls back to "default" with neither a deployment id nor a BUILD_ID', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(mkdtempSync(join(tmpdir(), 'orkify-scope-')));
    deploy(undefined);
    expect(deploymentScope()).toBe('default');
  });
});
