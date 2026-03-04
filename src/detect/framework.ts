import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NEXT_CONFIG_FILES = ['next.config.ts', 'next.config.js', 'next.config.mjs'];

export function detectFramework(cwd: string): string | undefined {
  // Primary: check package.json for `next` dependency
  try {
    const raw = readFileSync(join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    if (pkg.dependencies?.next || pkg.devDependencies?.next) {
      return 'nextjs';
    }
  } catch {
    // Missing or malformed package.json — fall through to config file check
  }

  // Fallback: check for next.config.{ts,js,mjs}
  for (const file of NEXT_CONFIG_FILES) {
    if (existsSync(join(cwd, file))) {
      return 'nextjs';
    }
  }

  return undefined;
}
