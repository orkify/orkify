import type { CacheConfig } from './types.js';
import { CacheClient } from './CacheClient.js';

let instance: CacheClient | undefined;
let pendingConfig: CacheConfig | undefined;

// In cluster mode, IPC cache broadcasts can arrive before the user's code
// first touches the `cache` proxy (e.g., a SET from another worker arrives
// while this worker is still importing modules). Buffer those messages so
// they're replayed when the CacheClient is finally created.
const messageBuffer: unknown[] = [];
let earlyListener: ((msg: unknown) => void) | undefined;

if (process.env.ORKIFY_CLUSTER_MODE === 'true' && typeof process.send === 'function') {
  earlyListener = (msg: unknown) => {
    const m = msg as { __orkify?: boolean; type?: string };
    if (m?.__orkify && m.type?.startsWith('cache:')) {
      messageBuffer.push(msg);
    }
  };
  process.on('message', earlyListener);
}

/**
 * Configure the shared cache. Call before first use of `cache`, or defaults apply.
 * Throws if called after the cache singleton has already been created.
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
 */
export const cache: CacheClient = new Proxy({} as CacheClient, {
  get(_target, prop, receiver) {
    if (!instance) {
      // Stop the early listener — CacheClient registers its own
      if (earlyListener) {
        process.removeListener('message', earlyListener);
        earlyListener = undefined;
      }
      instance = new CacheClient(pendingConfig, messageBuffer);
      messageBuffer.length = 0;
    }
    const value = Reflect.get(instance, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
});

export type { CacheConfig, CacheSetOptions, CacheStats } from './types.js';
