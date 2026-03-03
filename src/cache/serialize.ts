import v8 from 'node:v8';

export type Encoding = 'json' | 'v8';

export interface Serialized {
  data: string;
  encoding: Encoding;
}

function needsV8(value: unknown): boolean {
  if (
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Error
  )
    return true;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true;
  if (Array.isArray(value)) return value.some(needsV8);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(needsV8);
  }
  return false;
}

export function serialize(value: unknown): Serialized {
  if (typeof value === 'function') {
    throw new Error('cache: functions are not serializable');
  }
  if (typeof value === 'symbol') {
    throw new Error('cache: symbols are not serializable');
  }
  if (needsV8(value)) {
    return { data: v8.serialize(value).toString('base64'), encoding: 'v8' };
  }
  return { data: JSON.stringify(value), encoding: 'json' };
}

export function deserialize({ data, encoding }: Serialized): unknown {
  if (encoding === 'v8') return v8.deserialize(Buffer.from(data, 'base64'));
  return JSON.parse(data);
}

export function serializedByteLength(s: Serialized): number {
  return s.encoding === 'v8'
    ? Math.ceil((s.data.length * 3) / 4) // base64 → raw bytes
    : Buffer.byteLength(s.data, 'utf-8');
}
