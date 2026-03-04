import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectFramework } from '../../src/detect/framework.js';

describe('detectFramework', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orkify-detect-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns "nextjs" when package.json has next in dependencies', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^16.0.0' } }),
      'utf-8'
    );
    expect(detectFramework(tempDir)).toBe('nextjs');
  });

  it('returns "nextjs" when package.json has next in devDependencies', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ devDependencies: { next: '^16.0.0' } }),
      'utf-8'
    );
    expect(detectFramework(tempDir)).toBe('nextjs');
  });

  it('returns "nextjs" when next.config.ts exists (no package.json)', () => {
    writeFileSync(join(tempDir, 'next.config.ts'), 'export default {}', 'utf-8');
    expect(detectFramework(tempDir)).toBe('nextjs');
  });

  it('returns "nextjs" when next.config.js exists (no package.json)', () => {
    writeFileSync(join(tempDir, 'next.config.js'), 'module.exports = {}', 'utf-8');
    expect(detectFramework(tempDir)).toBe('nextjs');
  });

  it('returns "nextjs" when next.config.mjs exists (no package.json)', () => {
    writeFileSync(join(tempDir, 'next.config.mjs'), 'export default {}', 'utf-8');
    expect(detectFramework(tempDir)).toBe('nextjs');
  });

  it('returns undefined when neither signal exists', () => {
    expect(detectFramework(tempDir)).toBeUndefined();
  });

  it('returns undefined for malformed package.json', () => {
    writeFileSync(join(tempDir, 'package.json'), '{{{invalid json', 'utf-8');
    expect(detectFramework(tempDir)).toBeUndefined();
  });

  it('returns undefined when package.json exists but has no next dependency', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.0.0' } }),
      'utf-8'
    );
    expect(detectFramework(tempDir)).toBeUndefined();
  });

  it('prefers package.json detection over config file (both present)', () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^16.0.0' } }),
      'utf-8'
    );
    writeFileSync(join(tempDir, 'next.config.ts'), 'export default {}', 'utf-8');
    // Should still return 'nextjs' — package.json is checked first
    expect(detectFramework(tempDir)).toBe('nextjs');
  });
});
