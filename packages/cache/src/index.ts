import type { CacheConfig } from './types.js';
import { CacheClient } from './CacheClient.js';

let instance: CacheClient | undefined;
let pendingConfig: CacheConfig | undefined;

// In cluster mode, IPC cache messages (including snapshots) can arrive before
// this module loads.  The metrics probe registers a global buffer on
// `globalThis.__orkifyCacheBuffer` synchronously before any `await`, so those
// early messages are captured even when this module loads late.
//
// Messages that arrive *after* this module loads but *before* the proxy is first
// accessed are captured by the local early listener below.  Both sources are
// merged and drained when the CacheClient is created.
const g = globalThis as Record<string, unknown>;
const probeBuffer: unknown[] = Array.isArray(g.__orkifyCacheBuffer)
  ? (g.__orkifyCacheBuffer as unknown[])
  : [];

const localBuffer: unknown[] = [];
let earlyListener: ((msg: unknown) => void) | undefined;

if (process.env.ORKIFY_CLUSTER_MODE === 'true' && typeof process.send === 'function') {
  earlyListener = (msg: unknown) => {
    const m = msg as { __orkify?: boolean; type?: string };
    if (m?.__orkify && m.type?.startsWith('cache:')) {
      localBuffer.push(msg);
    }
  };
  process.on('message', earlyListener);
}

function createInstance(): void {
  // Stop the local early listener — CacheClient registers its own
  if (earlyListener) {
    process.removeListener('message', earlyListener);
    earlyListener = undefined;
  }

  // Stop the probe's global buffer listener
  if (typeof g.__orkifyCacheBufferCleanup === 'function') {
    (g.__orkifyCacheBufferCleanup as () => void)();
    delete g.__orkifyCacheBufferCleanup;
    delete g.__orkifyCacheBuffer;
  }

  // Merge probe buffer + local buffer — probe messages arrived first
  const merged = [...probeBuffer, ...localBuffer];
  probeBuffer.length = 0;
  localBuffer.length = 0;

  // Default to fileBacked: true unless explicitly disabled
  const config: CacheConfig | undefined =
    pendingConfig?.fileBacked === false ? pendingConfig : { fileBacked: true, ...pendingConfig };

  instance = new CacheClient(config, merged);
  const client = instance;
  (g as Record<string, unknown>).__orkifyCacheStats = () => client.stats();
}

/**
 * @deprecated Use `cache.configure()` instead. Will be removed in a future version.
 */
export function configure(config: CacheConfig): void {
  if (instance) {
    throw new Error('orkify/cache: configure() must be called before the first use of cache');
  }
  pendingConfig = config;
}

/**
 * Shared cache singleton. Reads are always synchronous local Map lookups.
 * In cluster mode, writes broadcast via IPC so all workers converge.
 * In standalone/fork mode, behaves as a local in-memory cache.
 *
 * Call `cache.configure()` before any other method to set options.
 */
export const cache: CacheClient = new Proxy({} as CacheClient, {
  get(_target, prop, receiver) {
    // configure() must run before the instance is created
    if (prop === 'configure') {
      return (config: CacheConfig) => {
        if (instance) {
          throw new Error('orkify/cache: configure() must be called before the first use of cache');
        }
        pendingConfig = config;
      };
    }

    if (!instance) createInstance();
    const inst = instance as CacheClient;
    const value = Reflect.get(inst, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(inst);
    }
    return value;
  },
});

export type { CacheConfig, CacheSetOptions, CacheStats } from './types.js';
