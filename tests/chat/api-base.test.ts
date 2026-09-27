import { describe, expect, it } from 'vitest';
import { DEFAULT_API_BASE, resolveApiBase } from '../../packages/chat/src/api-base.js';

const CDN = 'https://cdn.jsdelivr.net/npm/@orkify/chat/orkify-chat.js';

describe('resolveApiBase', () => {
  it('uses the origin that served the script', () => {
    expect(resolveApiBase('https://orkify.com/orkify-chat.js')).toBe('https://orkify.com');
  });

  it('keeps a self-hosted instance on its own domain', () => {
    // Someone running their own Orkify serves both the script and the API.
    expect(resolveApiBase('https://ops.example.com/orkify-chat.js')).toBe(
      'https://ops.example.com'
    );
    expect(resolveApiBase('http://localhost:3000/orkify-chat.js')).toBe('http://localhost:3000');
  });

  it('does not ask a CDN for the API', () => {
    // The snippet the dashboard hands out loads from jsDelivr; the API is not
    // there, and before this the widget silently never appeared.
    expect(resolveApiBase(CDN)).toBe(DEFAULT_API_BASE);
    for (const src of [
      'https://unpkg.com/@orkify/chat/orkify-chat.js',
      'https://cdnjs.cloudflare.com/x/orkify-chat.js',
      'https://esm.sh/@orkify/chat',
      'https://fastly.jsdelivr.net/npm/@orkify/chat/orkify-chat.js',
    ]) {
      expect(resolveApiBase(src), src).toBe(DEFAULT_API_BASE);
    }
  });

  it('matches a CDN on whole labels only', () => {
    // A domain that merely ends in the same letters is somebody's own host.
    expect(resolveApiBase('https://myjsdelivr.net/orkify-chat.js')).toBe('https://myjsdelivr.net');
  });

  it('lets data-api-base win, for a CDN copy pointed at your own instance', () => {
    expect(resolveApiBase(CDN, 'https://ops.example.com')).toBe('https://ops.example.com');
    expect(resolveApiBase('https://orkify.com/orkify-chat.js', 'https://ops.example.com/')).toBe(
      'https://ops.example.com'
    );
  });

  it('ignores a data-api-base that is not an http(s) URL', () => {
    for (const value of ['', 'orkify.com', 'javascript:alert(1)', 'file:///etc/passwd']) {
      expect(resolveApiBase('https://orkify.com/orkify-chat.js', value), value).toBe(
        'https://orkify.com'
      );
    }
  });

  it('falls back when the script tag has no usable src', () => {
    expect(resolveApiBase(null)).toBe(DEFAULT_API_BASE);
    expect(resolveApiBase('not a url')).toBe(DEFAULT_API_BASE);
  });
});
