import { describe, expect, it } from 'vitest';
import { orkify } from './test-utils.js';

describe('CLI', () => {
  it('shows help', async () => {
    const output = await orkify('--help');
    expect(output).toContain('process orchestration and deployment');
    expect(output).toContain('up');
    expect(output).toContain('down');
    expect(output).toContain('reload');
  });

  it('shows version', async () => {
    const output = await orkify('--version');
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
