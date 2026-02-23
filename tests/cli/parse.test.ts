import { describe, expect, it, vi } from 'vitest';
import {
  parseCronSpecs,
  parseLogSize,
  parseMemorySize,
  parseWorkers,
} from '../../src/cli/parse.js';

describe('parseLogSize', () => {
  it('parses megabytes', () => {
    expect(parseLogSize('100M')).toBe(100 * 1024 * 1024);
  });

  it('parses kilobytes', () => {
    expect(parseLogSize('500K')).toBe(500 * 1024);
  });

  it('parses gigabytes', () => {
    expect(parseLogSize('1G')).toBe(1024 * 1024 * 1024);
  });

  it('parses fractional values', () => {
    expect(parseLogSize('1.5G')).toBe(Math.round(1.5 * 1024 * 1024 * 1024));
  });

  it('parses raw byte count', () => {
    expect(parseLogSize('1048576')).toBe(1048576);
  });

  it('is case-insensitive', () => {
    expect(parseLogSize('100m')).toBe(parseLogSize('100M'));
    expect(parseLogSize('1g')).toBe(parseLogSize('1G'));
    expect(parseLogSize('500k')).toBe(parseLogSize('500K'));
  });

  it('accepts optional B suffix', () => {
    expect(parseLogSize('100MB')).toBe(100 * 1024 * 1024);
    expect(parseLogSize('1GB')).toBe(1024 * 1024 * 1024);
  });

  it('enforces minimum size (MIN_LOG_MAX_SIZE = 1024)', () => {
    expect(parseLogSize('1')).toBe(1024);
    expect(parseLogSize('500')).toBe(1024);
  });

  it('falls back to DEFAULT_LOG_MAX_SIZE on invalid input', () => {
    expect(parseLogSize('invalid')).toBe(100 * 1024 * 1024);
  });
});

describe('parseMemorySize', () => {
  it('parses megabytes', () => {
    expect(parseMemorySize('512M')).toBe(512 * 1024 * 1024);
  });

  it('parses gigabytes', () => {
    expect(parseMemorySize('1G')).toBe(1024 * 1024 * 1024);
  });

  it('parses kilobytes', () => {
    expect(parseMemorySize('256K')).toBe(256 * 1024);
  });

  it('parses raw byte count', () => {
    expect(parseMemorySize('1048576')).toBe(1048576);
  });

  it('does not enforce a minimum', () => {
    expect(parseMemorySize('1')).toBe(1);
  });

  it('exits on invalid input', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseMemorySize('invalid')).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('Invalid memory size: invalid');

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exits on zero', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseMemorySize('0')).toThrow('process.exit');

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exits on negative number', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseMemorySize('-100')).toThrow('process.exit');

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('parseWorkers', () => {
  it('returns the number for positive integers', () => {
    expect(parseWorkers('4')).toBe(4);
    expect(parseWorkers('1')).toBe(1);
  });

  it('returns CPU count for "0"', () => {
    const result = parseWorkers('0');
    expect(result).toBeGreaterThan(0);
  });

  it('returns CPUs minus value for negative numbers', () => {
    const result = parseWorkers('-1');
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it('returns 1 for non-numeric input', () => {
    expect(parseWorkers('abc')).toBe(1);
  });

  it('clamps negative result to at least 1', () => {
    // Even with an absurdly negative value, should return at least 1
    expect(parseWorkers('-9999')).toBe(1);
  });
});

describe('parseCronSpecs', () => {
  it('parses a valid single spec', () => {
    const result = parseCronSpecs(['*/2 * * * * /api/check']);
    expect(result).toEqual([{ schedule: '*/2 * * * *', path: '/api/check' }]);
  });

  it('parses multiple specs', () => {
    const result = parseCronSpecs(['*/5 * * * * /api/health', '0 0 * * * /api/daily']);
    expect(result).toEqual([
      { schedule: '*/5 * * * *', path: '/api/health' },
      { schedule: '0 0 * * *', path: '/api/daily' },
    ]);
  });

  it('exits on too few tokens', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseCronSpecs(['* * * /api'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exits on invalid schedule', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseCronSpecs(['invalid * * * * /api'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exits on invalid path (missing leading slash)', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseCronSpecs(['*/5 * * * * api/check'])).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
