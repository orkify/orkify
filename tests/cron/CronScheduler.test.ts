import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessInfo } from '../../src/types/index.js';
import {
  CronScheduler,
  validateCronPath,
  validateCronSchedule,
} from '../../src/cron/CronScheduler.js';

// ---------------------------------------------------------------------------
// validateCronSchedule
// ---------------------------------------------------------------------------

describe('validateCronSchedule', () => {
  it('accepts "*/5 * * * *"', () => {
    expect(validateCronSchedule('*/5 * * * *')).toBeNull();
  });

  it('accepts "0 0 * * *" (daily at midnight)', () => {
    expect(validateCronSchedule('0 0 * * *')).toBeNull();
  });

  it('accepts "* * * * *" (every minute, at the 60s minimum)', () => {
    expect(validateCronSchedule('* * * * *')).toBeNull();
  });

  it('rejects plain "invalid"', () => {
    expect(validateCronSchedule('invalid')).toBeTypeOf('string');
  });

  it('rejects "* * *" (too few fields)', () => {
    expect(validateCronSchedule('* * *')).toBeTypeOf('string');
  });

  it('rejects sub-minute 6-field expression', () => {
    const err = validateCronSchedule('*/30 * * * * *');
    expect(err).toBeTypeOf('string');
  });

  it('rejects intervals > 24h (monthly)', () => {
    const err = validateCronSchedule('0 0 1 * *');
    expect(err).toBeTypeOf('string');
    expect(err).toContain('24h');
  });
});

// ---------------------------------------------------------------------------
// validateCronPath
// ---------------------------------------------------------------------------

describe('validateCronPath', () => {
  it('accepts "/api/cron/check"', () => {
    expect(validateCronPath('/api/cron/check')).toBeNull();
  });

  it('accepts "/health"', () => {
    expect(validateCronPath('/health')).toBeNull();
  });

  it('accepts "/"', () => {
    expect(validateCronPath('/')).toBeNull();
  });

  it('rejects path without leading slash', () => {
    expect(validateCronPath('api/check')).toBeTypeOf('string');
  });

  it('rejects path with "?"', () => {
    expect(validateCronPath('/check?foo')).toBeTypeOf('string');
  });

  it('rejects path with "#"', () => {
    expect(validateCronPath('/check#x')).toBeTypeOf('string');
  });

  it('rejects path with ":"', () => {
    expect(validateCronPath('/check:x')).toBeTypeOf('string');
  });

  it('rejects path with "@"', () => {
    expect(validateCronPath('/check@x')).toBeTypeOf('string');
  });

  it('rejects path with ".."', () => {
    expect(validateCronPath('/../../etc')).toBeTypeOf('string');
  });
});

// ---------------------------------------------------------------------------
// CronScheduler class
// ---------------------------------------------------------------------------

describe('CronScheduler', () => {
  let scheduler: CronScheduler;
  let mockOrchestrator: { list: ReturnType<typeof vi.fn>; getCronSecret: ReturnType<typeof vi.fn> };
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();

    mockOrchestrator = {
      list: vi.fn().mockReturnValue([]),
      getCronSecret: vi.fn().mockReturnValue(undefined),
    };

    // Cast through unknown — CronScheduler only accesses list() and getCronSecret()
    scheduler = new CronScheduler(
      mockOrchestrator as unknown as ConstructorParameters<typeof CronScheduler>[0]
    );

    mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    scheduler.shutdown();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // -- register / unregister / shutdown ------------------------------------

  describe('register / unregister / shutdown', () => {
    it('registers valid jobs and dispatches on tick', async () => {
      mockOrchestrator.list.mockReturnValue([{ name: 'web', port: 3000 }] as ProcessInfo[]);
      mockOrchestrator.getCronSecret.mockReturnValue('s3cret');

      scheduler.register('web', [{ schedule: '* * * * *', path: '/ping' }]);

      // Advance past the first nextRun (at most 60s) + tick interval (30s)
      await vi.advanceTimersByTimeAsync(90_000);

      expect(mockFetch).toHaveBeenCalled();
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:3000/ping');
      expect(opts.method).toBe('GET');
      expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer s3cret');
    });

    it('skips jobs with invalid schedule (no throw)', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      scheduler.register('web', [{ schedule: 'bad', path: '/ping' }]);

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('skips jobs with invalid path (no throw)', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      scheduler.register('web', [{ schedule: '* * * * *', path: 'no-slash' }]);

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('re-register replaces old jobs', async () => {
      mockOrchestrator.list.mockReturnValue([{ name: 'web', port: 3000 }] as ProcessInfo[]);

      scheduler.register('web', [{ schedule: '* * * * *', path: '/old' }]);
      scheduler.register('web', [{ schedule: '* * * * *', path: '/new' }]);

      await vi.advanceTimersByTimeAsync(90_000);

      // Only /new should be called, not /old
      const urls = mockFetch.mock.calls.map((c) => (c as [string])[0]);
      expect(urls.every((u: string) => u.includes('/new'))).toBe(true);
    });

    it('unregister of non-existent process is silent', () => {
      // Should not throw
      scheduler.unregister('nonexistent');
    });

    it('shutdown clears timer and jobs, safe to call twice', () => {
      scheduler.register('web', [{ schedule: '* * * * *', path: '/ping' }]);
      scheduler.shutdown();
      scheduler.shutdown(); // second call is safe
    });
  });

  // -- tick / dispatch -----------------------------------------------------

  describe('tick + dispatch', () => {
    it('skips dispatch when process has no port', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockOrchestrator.list.mockReturnValue([
        { name: 'web', port: undefined },
      ] as unknown as ProcessInfo[]);

      scheduler.register('web', [{ schedule: '* * * * *', path: '/ping' }]);

      await vi.advanceTimersByTimeAsync(90_000);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('no port'));
      logSpy.mockRestore();
    });

    it('handles fetch error gracefully', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockOrchestrator.list.mockReturnValue([{ name: 'web', port: 3000 }] as ProcessInfo[]);
      mockFetch.mockRejectedValue(new Error('network down'));

      scheduler.register('web', [{ schedule: '* * * * *', path: '/ping' }]);

      await vi.advanceTimersByTimeAsync(90_000);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('network down'));
      errorSpy.mockRestore();
    });

    it('skips overlapping dispatch when job is still running', async () => {
      mockOrchestrator.list.mockReturnValue([{ name: 'web', port: 3000 }] as ProcessInfo[]);

      // Make fetch hang (never resolve) to simulate a long-running request
      let resolveFetch!: () => void;
      mockFetch.mockImplementation(
        () =>
          new Promise<{ status: number }>((resolve) => {
            resolveFetch = () => resolve({ status: 200 });
          })
      );

      scheduler.register('web', [{ schedule: '* * * * *', path: '/ping' }]);

      // First tick triggers dispatch
      await vi.advanceTimersByTimeAsync(90_000);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second tick — job still running, should be skipped
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Let the pending fetch resolve
      resolveFetch();
      await vi.advanceTimersByTimeAsync(0);
    });
  });
});
