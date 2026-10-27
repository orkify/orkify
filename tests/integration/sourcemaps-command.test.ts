import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { orkify } from './test-utils.js';

describe('orkify sourcemaps', () => {
  it('moves .next/static maps into .orkify/sourcemaps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkify-sm-cmd-'));
    mkdirSync(join(dir, '.next/static/chunks'), { recursive: true });
    writeFileSync(join(dir, '.next/static/chunks/a.js'), 'x();');
    writeFileSync(join(dir, '.next/static/chunks/a.js.map'), '{}');

    expect(orkify(`sourcemaps "${dir}"`)).toContain('Moved 1 source map');
    expect(existsSync(join(dir, '.next/static/chunks/a.js.map'))).toBe(false);
    expect(existsSync(join(dir, '.orkify/sourcemaps/chunks/a.js.map'))).toBe(true);
    expect(existsSync(join(dir, '.next/static/chunks/a.js'))).toBe(true);

    expect(orkify(`sourcemaps "${dir}"`)).toContain('No source maps found');
  });
});
