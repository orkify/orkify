import { describe, expect, it } from 'vitest';
import {
  computeFingerprint,
  normalizeMessage,
  parseFunctionName,
} from '../../src/probe/compute-fingerprint.js';

describe('parseFunctionName', () => {
  const stack = [
    'TypeError: Cannot read properties of undefined',
    '    at handleRequest (/app/src/server.ts:42:5)',
    '    at MyClass.method (/app/src/class.ts:10:3)',
    '    at Object.<anonymous> (/app/src/index.ts:1:1)',
    '    at async processQueue (/app/src/queue.ts:20:10)',
    '    at new MyClass (/app/src/class.ts:5:1)',
    '    at get foo (/app/src/obj.ts:3:1)',
    '    at /app/src/bare.ts:5:12',
  ].join('\n');

  it('extracts named function', () => {
    expect(parseFunctionName(stack, '/app/src/server.ts', 42)).toBe('handleRequest');
  });

  it('extracts class method', () => {
    expect(parseFunctionName(stack, '/app/src/class.ts', 10)).toBe('MyClass.method');
  });

  it('extracts <anonymous> from Object.<anonymous>', () => {
    expect(parseFunctionName(stack, '/app/src/index.ts', 1)).toBe('<anonymous>');
  });

  it('strips async prefix', () => {
    expect(parseFunctionName(stack, '/app/src/queue.ts', 20)).toBe('processQueue');
  });

  it('extracts constructor', () => {
    expect(parseFunctionName(stack, '/app/src/class.ts', 5)).toBe('new MyClass');
  });

  it('extracts getter', () => {
    expect(parseFunctionName(stack, '/app/src/obj.ts', 3)).toBe('get foo');
  });

  it('returns null for bare path (no function name)', () => {
    expect(parseFunctionName(stack, '/app/src/bare.ts', 5)).toBeNull();
  });

  it('returns null when file/line not found in stack', () => {
    expect(parseFunctionName(stack, '/app/src/missing.ts', 99)).toBeNull();
  });

  it('returns null for empty stack', () => {
    expect(parseFunctionName('', '/app/src/server.ts', 42)).toBeNull();
  });

  it('returns null for empty file', () => {
    expect(parseFunctionName(stack, '', 42)).toBeNull();
  });

  it('skips error message line that contains file:line reference', () => {
    const tricky = [
      'Error: Failed processing /app/src/server.ts:42:5',
      '    at handleRequest (/app/src/server.ts:42:5)',
    ].join('\n');
    // Should find the actual frame, not bail on the message line
    expect(parseFunctionName(tricky, '/app/src/server.ts', 42)).toBe('handleRequest');
  });

  it('matches file:// URLs in ESM stack traces', () => {
    const esmStack = ['Error: boom', '    at handleRequest (file:///app/src/server.ts:42:5)'].join(
      '\n'
    );
    // targetFile is the resolved absolute path, stack has file:// URL
    expect(parseFunctionName(esmStack, '/app/src/server.ts', 42)).toBe('handleRequest');
  });
});

describe('normalizeMessage', () => {
  it('replaces UUIDs', () => {
    expect(normalizeMessage('User 550e8400-e29b-41d4-a716-446655440000 not found')).toBe(
      'User * not found'
    );
  });

  it('replaces hex strings (16+ chars)', () => {
    expect(normalizeMessage('Token abc123def456789012 expired')).toBe('Token * expired');
  });

  it('replaces IPv4 addresses', () => {
    expect(normalizeMessage('Connection to 192.168.1.100 refused')).toBe('Connection to * refused');
  });

  it('replaces standalone numbers', () => {
    expect(normalizeMessage('Port 3000 in use')).toBe('Port * in use');
  });

  it('handles mixed dynamic values', () => {
    const msg = 'Error 42 for user 550e8400-e29b-41d4-a716-446655440000 at 10.0.0.1';
    expect(normalizeMessage(msg)).toBe('Error * for user * at *');
  });

  it('leaves clean messages unchanged', () => {
    expect(normalizeMessage('Cannot read properties of undefined')).toBe(
      'Cannot read properties of undefined'
    );
  });

  it('replaces multiple numbers', () => {
    expect(normalizeMessage('Expected 200 but got 404')).toBe('Expected * but got *');
  });
});

describe('computeFingerprint', () => {
  it('returns 32-char hex string', () => {
    const fp = computeFingerprint({
      errorName: 'TypeError',
      message: 'test',
      file: '/app/server.ts',
      line: 42,
    });
    expect(fp).toHaveLength(32);
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });

  it('uses function name when provided', () => {
    const withFn = computeFingerprint({
      errorName: 'TypeError',
      message: 'test',
      file: '/app/server.ts',
      line: 42,
      functionName: 'handleRequest',
    });
    const withoutFn = computeFingerprint({
      errorName: 'TypeError',
      message: 'test',
      file: '/app/server.ts',
      line: 42,
    });
    // Different because one uses function name, other uses line
    expect(withFn).not.toBe(withoutFn);
  });

  it('is stable across line changes when function name is available', () => {
    const fp1 = computeFingerprint({
      errorName: 'TypeError',
      message: 'test',
      file: '/app/server.ts',
      line: 42,
      functionName: 'handleRequest',
    });
    const fp2 = computeFingerprint({
      errorName: 'TypeError',
      message: 'test',
      file: '/app/server.ts',
      line: 43, // line shifted
      functionName: 'handleRequest',
    });
    expect(fp1).toBe(fp2);
  });

  it('produces different fingerprints for different error names', () => {
    const base = { message: 'test', file: '/app/server.ts', line: 42 };
    const fp1 = computeFingerprint({ ...base, errorName: 'TypeError' });
    const fp2 = computeFingerprint({ ...base, errorName: 'ReferenceError' });
    expect(fp1).not.toBe(fp2);
  });

  it('produces same fingerprint for different dynamic values in message', () => {
    const base = {
      errorName: 'Error',
      file: '/app/server.ts',
      line: 42,
      functionName: 'handleRequest',
    };
    const fp1 = computeFingerprint({ ...base, message: 'User 123 not found' });
    const fp2 = computeFingerprint({ ...base, message: 'User 456 not found' });
    expect(fp1).toBe(fp2);
  });

  it('produces same fingerprint for different UUIDs in message', () => {
    const base = {
      errorName: 'Error',
      file: '/app/server.ts',
      line: 42,
    };
    const fp1 = computeFingerprint({
      ...base,
      message: 'Not found: 550e8400-e29b-41d4-a716-446655440000',
    });
    const fp2 = computeFingerprint({
      ...base,
      message: 'Not found: a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    expect(fp1).toBe(fp2);
  });

  it('falls back to file:line when no function name', () => {
    const fp1 = computeFingerprint({
      errorName: 'Error',
      message: 'test',
      file: '/app/server.ts',
      line: 42,
      functionName: null,
    });
    const fp2 = computeFingerprint({
      errorName: 'Error',
      message: 'test',
      file: '/app/server.ts',
      line: 43,
      functionName: null,
    });
    // Different because line numbers differ and no function name
    expect(fp1).not.toBe(fp2);
  });
});
