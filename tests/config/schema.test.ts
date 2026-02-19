import { describe, expect, it } from 'vitest';
import {
  validateLogsOptions,
  validateStartOptions,
  validateTarget,
} from '../../src/config/schema.js';

describe('Config Schema', () => {
  describe('validateStartOptions', () => {
    it('validates minimal options with defaults', () => {
      const result = validateStartOptions({});

      expect(result.workers).toBe(1);
      expect(result.watch).toBe(false);
      expect(result.nodeArgs).toEqual([]);
      expect(result.args).toEqual([]);
      expect(result.killTimeout).toBe(5000);
      expect(result.maxRestarts).toBe(10);
      expect(result.minUptime).toBe(1000);
      expect(result.restartDelay).toBe(100);
      expect(result.sticky).toBe(false);
    });

    it('accepts valid custom options', () => {
      const result = validateStartOptions({
        name: 'my-app',
        workers: 4,
        watch: true,
        watchPaths: ['/src'],
        cwd: '/app',
        nodeArgs: ['--max-old-space-size=4096'],
        args: ['--port', '3000'],
        killTimeout: 10000,
        maxRestarts: 5,
        sticky: true,
      });

      expect(result.name).toBe('my-app');
      expect(result.workers).toBe(4);
      expect(result.watch).toBe(true);
      expect(result.watchPaths).toEqual(['/src']);
      expect(result.cwd).toBe('/app');
      expect(result.nodeArgs).toEqual(['--max-old-space-size=4096']);
      expect(result.args).toEqual(['--port', '3000']);
      expect(result.killTimeout).toBe(10000);
      expect(result.maxRestarts).toBe(5);
      expect(result.sticky).toBe(true);
    });

    it('rejects invalid worker counts', () => {
      expect(() => validateStartOptions({ workers: 0 })).toThrow();
      expect(() => validateStartOptions({ workers: -1 })).toThrow();
      expect(() => validateStartOptions({ workers: 1.5 })).toThrow();
    });

    it('rejects negative timeouts', () => {
      expect(() => validateStartOptions({ killTimeout: -1 })).toThrow();
      expect(() => validateStartOptions({ minUptime: -1 })).toThrow();
      expect(() => validateStartOptions({ restartDelay: -1 })).toThrow();
    });

    it('accepts healthCheck starting with /', () => {
      const result = validateStartOptions({ healthCheck: '/health' });
      expect(result.healthCheck).toBe('/health');
    });

    it('rejects healthCheck not starting with /', () => {
      expect(() => validateStartOptions({ healthCheck: 'health' })).toThrow();
    });

    it('accepts optional port', () => {
      const result = validateStartOptions({ port: 3000 });
      expect(result.port).toBe(3000);
    });

    it('rejects invalid port', () => {
      expect(() => validateStartOptions({ port: -1 })).toThrow();
      expect(() => validateStartOptions({ port: 0 })).toThrow();
    });
  });

  describe('validateTarget', () => {
    it('accepts string targets', () => {
      expect(validateTarget('my-app')).toBe('my-app');
    });

    it('accepts numeric targets', () => {
      expect(validateTarget(0)).toBe(0);
      expect(validateTarget(5)).toBe(5);
    });

    it('accepts "all" as a target', () => {
      expect(validateTarget('all')).toBe('all');
    });

    it('rejects negative numbers', () => {
      expect(() => validateTarget(-1)).toThrow();
    });
  });

  describe('validateLogsOptions', () => {
    it('validates with defaults', () => {
      const result = validateLogsOptions({});

      expect(result.lines).toBe(100);
      expect(result.follow).toBe(false);
    });

    it('accepts custom options', () => {
      const result = validateLogsOptions({
        lines: 50,
        follow: true,
      });

      expect(result.lines).toBe(50);
      expect(result.follow).toBe(true);
    });

    it('rejects invalid lines', () => {
      expect(() => validateLogsOptions({ lines: 0 })).toThrow();
      expect(() => validateLogsOptions({ lines: -1 })).toThrow();
    });
  });
});
