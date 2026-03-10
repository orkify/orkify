import { describe, expect, it } from 'vitest';
import {
  deserialize,
  serialize,
  serializedByteLength,
} from '../../packages/cache/src/serialize.js';

describe('serialize', () => {
  describe('serialize()', () => {
    it('uses JSON for plain objects', () => {
      const result = serialize({ name: 'test', count: 42 });
      expect(result.encoding).toBe('json');
      expect(JSON.parse(result.data)).toEqual({ name: 'test', count: 42 });
    });

    it('uses JSON for strings', () => {
      const result = serialize('hello');
      expect(result.encoding).toBe('json');
    });

    it('uses JSON for numbers', () => {
      const result = serialize(42);
      expect(result.encoding).toBe('json');
    });

    it('uses JSON for booleans', () => {
      const result = serialize(true);
      expect(result.encoding).toBe('json');
    });

    it('uses JSON for null', () => {
      const result = serialize(null);
      expect(result.encoding).toBe('json');
    });

    it('uses JSON for arrays of primitives', () => {
      const result = serialize([1, 'two', true]);
      expect(result.encoding).toBe('json');
    });

    it('uses V8 for Map', () => {
      const map = new Map([
        ['a', 1],
        ['b', 2],
      ]);
      const result = serialize(map);
      expect(result.encoding).toBe('v8');
    });

    it('uses V8 for Set', () => {
      const set = new Set([1, 2, 3]);
      const result = serialize(set);
      expect(result.encoding).toBe('v8');
    });

    it('uses V8 for Date', () => {
      const result = serialize(new Date('2026-01-01'));
      expect(result.encoding).toBe('v8');
    });

    it('uses V8 for RegExp', () => {
      const result = serialize(/test/gi);
      expect(result.encoding).toBe('v8');
    });

    it('uses V8 for Error', () => {
      const result = serialize(new Error('test'));
      expect(result.encoding).toBe('v8');
    });

    it('uses V8 for nested Map in object', () => {
      const result = serialize({ data: new Map([['key', 'value']]) });
      expect(result.encoding).toBe('v8');
    });

    it('uses V8 for Map nested in array', () => {
      const result = serialize([new Map()]);
      expect(result.encoding).toBe('v8');
    });

    it('uses V8 for ArrayBuffer', () => {
      const result = serialize(new ArrayBuffer(8));
      expect(result.encoding).toBe('v8');
    });

    it('uses V8 for Uint8Array', () => {
      const result = serialize(new Uint8Array([1, 2, 3]));
      expect(result.encoding).toBe('v8');
    });

    it('throws on functions', () => {
      expect(() => serialize(() => {})).toThrow();
    });

    it('throws on symbols', () => {
      expect(() => serialize(Symbol('test'))).toThrow();
    });
  });

  describe('deserialize()', () => {
    it('round-trips JSON encoding', () => {
      const original = { name: 'test', nested: [1, 2, 3] };
      const serialized = serialize(original);
      expect(deserialize(serialized)).toEqual(original);
    });

    it('round-trips V8 encoding for Map', () => {
      const original = new Map([
        ['a', 1],
        ['b', 2],
      ]);
      const serialized = serialize(original);
      const result = deserialize(serialized) as Map<string, number>;
      expect(result).toBeInstanceOf(Map);
      expect(result.get('a')).toBe(1);
      expect(result.get('b')).toBe(2);
    });

    it('round-trips V8 encoding for Set', () => {
      const original = new Set([1, 2, 3]);
      const serialized = serialize(original);
      const result = deserialize(serialized) as Set<number>;
      expect(result).toBeInstanceOf(Set);
      expect(result.has(1)).toBe(true);
      expect(result.has(2)).toBe(true);
      expect(result.has(3)).toBe(true);
    });

    it('round-trips V8 encoding for Date', () => {
      const original = new Date('2026-01-01T00:00:00.000Z');
      const serialized = serialize(original);
      const result = deserialize(serialized) as Date;
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('round-trips V8 encoding for RegExp', () => {
      const original = /test/gi;
      const serialized = serialize(original);
      const result = deserialize(serialized) as RegExp;
      expect(result).toBeInstanceOf(RegExp);
      expect(result.source).toBe('test');
      expect(result.flags).toBe('gi');
    });

    it('round-trips complex nested V8 value', () => {
      const original = {
        statuses: new Map([
          ['err1', 'resolved'],
          ['err2', 'muted'],
        ]),
        known: new Set(['fp1', 'fp2']),
      };
      const serialized = serialize(original);
      const result = deserialize(serialized) as typeof original;
      expect(result.statuses).toBeInstanceOf(Map);
      expect(result.statuses.get('err1')).toBe('resolved');
      expect(result.known).toBeInstanceOf(Set);
      expect(result.known.has('fp1')).toBe(true);
    });
  });

  describe('serializedByteLength()', () => {
    it('returns correct byte length for JSON encoding', () => {
      const serialized = serialize('hello');
      // JSON.stringify('hello') = '"hello"' = 7 bytes
      expect(serializedByteLength(serialized)).toBe(7);
    });

    it('returns correct byte length for V8 encoding', () => {
      const serialized = serialize(new Map([['a', 1]]));
      // V8 base64 → approximate raw bytes
      const rawBytes = Math.ceil((serialized.data.length * 3) / 4);
      expect(serializedByteLength(serialized)).toBe(rawBytes);
    });

    it('handles multi-byte UTF-8 characters in JSON', () => {
      const serialized = serialize('hello \u00e4\u00f6\u00fc');
      expect(serializedByteLength(serialized)).toBe(Buffer.byteLength(serialized.data, 'utf-8'));
    });
  });
});
