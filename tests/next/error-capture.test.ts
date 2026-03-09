import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeStack } from '../../src/next/error-capture.js';

describe('normalizeStack', () => {
  it('passes V8 (Chrome) stacks through unchanged', () => {
    const stack = [
      'Error: boom',
      '    at handleClick (http://localhost:3000/_next/static/chunks/app/page-abc.js:42:15)',
      '    at HTMLButtonElement.callCallback (http://localhost:3000/_next/static/chunks/framework.js:100:20)',
    ].join('\n');
    expect(normalizeStack(stack)).toBe(stack);
  });

  it('converts Firefox fn@file:line:col to V8 format', () => {
    const firefox = [
      'handleClick@http://localhost:3000/_next/static/chunks/app/page-abc.js:42:15',
      'callCallback@http://localhost:3000/_next/static/chunks/framework.js:100:20',
    ].join('\n');
    const expected = [
      '    at handleClick (http://localhost:3000/_next/static/chunks/app/page-abc.js:42:15)',
      '    at callCallback (http://localhost:3000/_next/static/chunks/framework.js:100:20)',
    ].join('\n');
    expect(normalizeStack(firefox)).toBe(expected);
  });

  it('converts anonymous Firefox frames (@file:line:col)', () => {
    const firefox = '@http://localhost:3000/file.js:10:5';
    expect(normalizeStack(firefox)).toBe('    at http://localhost:3000/file.js:10:5');
  });

  it('converts Safari-style stacks (same @-based format)', () => {
    const safari = 'doSomething@http://localhost:3000/app.js:22:8';
    expect(normalizeStack(safari)).toBe('    at doSomething (http://localhost:3000/app.js:22:8)');
  });

  it('preserves error message lines', () => {
    const stack = [
      'TypeError: Cannot read properties of undefined',
      'handleClick@http://localhost:3000/app.js:42:15',
    ].join('\n');
    const result = normalizeStack(stack);
    expect(result).toContain('TypeError: Cannot read properties of undefined');
    expect(result).toContain('    at handleClick (http://localhost:3000/app.js:42:15)');
  });

  it('handles mixed Chrome and Firefox lines', () => {
    const mixed = [
      'Error: test',
      '    at foo (http://localhost:3000/a.js:1:1)',
      'bar@http://localhost:3000/b.js:2:2',
    ].join('\n');
    const result = normalizeStack(mixed);
    expect(result).toContain('    at foo (http://localhost:3000/a.js:1:1)');
    expect(result).toContain('    at bar (http://localhost:3000/b.js:2:2)');
  });

  it('handles empty stack', () => {
    expect(normalizeStack('')).toBe('');
  });
});

// Test the client-side behavior: sendError, reportError, dedup, maxErrors.
// These require mocking browser globals (window, fetch, location, navigator).
describe('browser error capture', () => {
  const fetchSpy = vi.fn(() => Promise.resolve(new Response('ok')));

  beforeEach(async () => {
    // Reset module state by re-importing with a fresh module registry
    vi.resetModules();

    // Set up browser-like globals
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('location', { href: 'http://localhost:3000/test' });
    vi.stubGlobal('navigator', { userAgent: 'TestBrowser/1.0' });

    fetchSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reportError sends correct payload shape', async () => {
    const { reportError } = await import('../../src/next/error-capture.js');

    const err = new Error('test error');
    err.name = 'TypeError';
    err.stack = '    at foo (http://localhost:3000/app.js:1:1)';

    reportError(err);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('/orkify/errors');
    expect(opts.method).toBe('POST');
    expect(opts.keepalive).toBe(true);

    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      name: 'TypeError',
      message: 'test error',
      stack: '    at foo (http://localhost:3000/app.js:1:1)',
      errorType: 'browser:error',
      url: 'http://localhost:3000/test',
      userAgent: 'TestBrowser/1.0',
    });
    expect(typeof body.timestamp).toBe('number');
  });

  it('reportError ignores non-Error values', async () => {
    const { reportError } = await import('../../src/next/error-capture.js');
    reportError('string error');
    reportError(42);
    reportError(null);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('deduplicates errors with same stack within 5s', async () => {
    const { reportError } = await import('../../src/next/error-capture.js');

    const err = new Error('dup test');
    err.stack = '    at dup (http://localhost:3000/x.js:1:1)';

    reportError(err);
    reportError(err); // same stack — should be deduped
    reportError(err); // same stack — should be deduped

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('respects maxErrors cap (default 10)', async () => {
    const { reportError } = await import('../../src/next/error-capture.js');

    for (let i = 0; i < 15; i++) {
      const err = new Error(`error-${i}`);
      err.stack = `    at fn${i} (http://localhost:3000/f.js:${i}:1)`;
      reportError(err);
    }

    // Default max is 10
    expect(fetchSpy).toHaveBeenCalledTimes(10);
  });

  it('exports OrkifyErrorCapture, reportError, and normalizeStack', async () => {
    const mod = await import('../../src/next/error-capture.js');
    expect(typeof mod.OrkifyErrorCapture).toBe('function');
    expect(typeof mod.reportError).toBe('function');
    expect(typeof mod.normalizeStack).toBe('function');
  });
});
