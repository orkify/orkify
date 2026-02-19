import { type ChildProcess, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const BIN = join(process.cwd(), 'bin', 'orkify');
export const ORKIFY_HOME = join(homedir(), '.orkify');
export const EXAMPLES = join(process.cwd(), 'examples');
export const IS_WINDOWS = process.platform === 'win32';
export const IS_CI = process.env.CI === 'true';

export function spawnOrkify(
  args: string[],
  options: Parameters<typeof spawn>[2] = {}
): ChildProcess {
  return spawn('node', [BIN, ...args], options);
}
