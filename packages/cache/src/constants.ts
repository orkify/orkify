import { homedir } from 'node:os';
import { join } from 'node:path';

const ORKIFY_HOME = join(homedir(), '.orkify');

export const CACHE_DIR = join(ORKIFY_HOME, 'cache');
export const CACHE_DEFAULT_MAX_ENTRIES = 10_000;
export const CACHE_DEFAULT_MAX_MEMORY_SIZE = 64 * 1024 * 1024; // 64 MB
export const CACHE_DEFAULT_MAX_VALUE_SIZE = 1024 * 1024; // 1 MB
export const CACHE_CLEANUP_INTERVAL = 60_000; // 60s
