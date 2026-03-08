import { afterEach, describe, expect, it } from 'vitest';

// Import after any mock setup
const { getMachineId, _resetMachineIdCache } = await import('../src/machine-id.js');

describe('getMachineId', () => {
  afterEach(() => {
    _resetMachineIdCache();
  });

  it('returns a non-empty string or null', () => {
    const id = getMachineId();
    if (id !== null) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('caches the result across calls', () => {
    const first = getMachineId();
    const second = getMachineId();
    expect(second).toBe(first);
  });

  it('_resetMachineIdCache allows re-read', () => {
    const first = getMachineId();
    _resetMachineIdCache();
    const second = getMachineId();
    // Same machine, same ID
    expect(second).toBe(first);
  });
});
