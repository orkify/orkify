import { describe, it, expect } from 'vitest';
import { createMessageParser } from '../../src/ipc/protocol.js';

describe('IPC Protocol edge cases', () => {
  describe('unbounded buffer growth', () => {
    // Issue #6: The message parser concatenates incoming chunks into a string
    // buffer. If data arrives without newline delimiters, the buffer grows
    // without limit until the daemon runs out of memory.
    it('should reject or truncate data that exceeds max buffer size', () => {
      const parser = createMessageParser();

      // Simulate 10MB of data without any newline delimiter
      const chunk = Buffer.alloc(1024 * 1024, 'A'); // 1MB

      // Feed 10 chunks (10MB total) without any newline
      // Currently this accumulates in memory unboundedly.
      // A well-behaved parser should either:
      // - Throw an error after exceeding a limit
      // - Discard the buffer and reset
      // - Return an error indicator
      let threw = false;
      try {
        for (let i = 0; i < 10; i++) {
          parser(chunk);
        }
      } catch {
        threw = true;
      }

      // The parser should have either thrown or indicated an error.
      // Currently it silently accumulates all 10MB.
      expect(threw).toBe(true);
    });

    it('currently accumulates all data in buffer until newline arrives (documents unbounded growth)', () => {
      const parser = createMessageParser();

      // Send 5MB of data without newlines — the buffer holds all of it
      const chunk = Buffer.alloc(1024 * 1024, 'X'); // 1MB
      for (let i = 0; i < 5; i++) {
        const messages = parser(chunk);
        // No newline yet, so no messages parsed — but buffer keeps growing
        expect(messages).toHaveLength(0);
      }

      // After a newline arrives, the 5MB of garbage gets tried as JSON.parse
      // (which fails silently) and the valid message parses. The buffer is
      // now cleared. But for the duration between the first chunk and the
      // newline, 5MB+ was held in memory with no upper bound.
      const messages = parser(Buffer.from('\n{"type":"ping","id":"1"}\n'));

      // Parser recovers and parses the valid message — but the issue is
      // the unbounded accumulation before this point.
      // A fix should enforce a max buffer size (e.g., 10MB) and discard
      // or error when exceeded.
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'ping', id: '1' });
    });
  });

  describe('malformed JSON resilience', () => {
    // Baseline test: malformed JSON should not crash the parser
    it('should handle malformed JSON without throwing', () => {
      const parser = createMessageParser();

      // Send broken JSON followed by a valid message
      const messages = parser(Buffer.from('{broken json\n{"type":"ping","id":"1"}\n'));

      // Should skip the broken message and parse the valid one
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'ping', id: '1' });
    });

    it('should handle empty lines between messages', () => {
      const parser = createMessageParser();

      const messages = parser(Buffer.from('\n\n{"type":"ping","id":"1"}\n\n'));

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'ping', id: '1' });
    });
  });
});
