import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { AGENT_NAME_FILE, ORKIFY_HOME } from './constants.js';

let cached: string | undefined;

export function getAgentName(): string {
  if (cached) return cached;

  // 1. Env var override (containers)
  const envName = process.env.ORKIFY_AGENT_NAME;
  if (envName) {
    cached = envName;
    return cached;
  }

  // 2. Read persisted file
  try {
    const name = readFileSync(AGENT_NAME_FILE, 'utf8').trim();
    if (name) {
      cached = name;
      return cached;
    }
  } catch {
    // File doesn't exist yet — generate below
  }

  // 3. Generate: hostname-6hex
  const name = `${hostname()}-${randomBytes(3).toString('hex')}`;
  try {
    mkdirSync(ORKIFY_HOME, { recursive: true });
    writeFileSync(AGENT_NAME_FILE, name + '\n', 'utf8');
  } catch {
    // Best-effort persist — don't crash if write fails
  }
  cached = name;
  return cached;
}

/** Reset cached value — for testing only */
export function _resetAgentNameCache(): void {
  cached = undefined;
}
