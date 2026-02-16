import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { orkify, sleep, httpGet, waitForProcessOnline } from './test-utils.js';

describe('Error Handling', () => {
  it('fails gracefully for non-existent script', () => {
    const output = orkify('up /nonexistent/path/to/script.js -n test-noexist');

    // Should report an error
    expect(output.toLowerCase()).toMatch(/error|fail|not found|enoent/i);
  });

  it('fails gracefully for invalid script path', () => {
    const output = orkify('up "" -n test-empty');

    // Should report an error
    expect(output.toLowerCase()).toMatch(/error|fail|invalid|required/i);
  });

  it('fails gracefully when stopping non-existent process', () => {
    const output = orkify('down nonexistent-process-12345');

    // Should report not found
    expect(output.toLowerCase()).toMatch(/not found|error|fail/i);
  });

  it('fails gracefully when reloading non-existent process', () => {
    const output = orkify('reload nonexistent-process-12345');

    // Should report not found
    expect(output.toLowerCase()).toMatch(/not found|error|fail/i);
  });

  it('fails gracefully when deleting non-existent process', () => {
    const output = orkify('delete nonexistent-process-12345');

    // Should report not found
    expect(output.toLowerCase()).toMatch(/not found|error|fail/i);
  });

  it('handles syntax error in script gracefully', async () => {
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-syntax-error-')));
    const badScript = join(tempDir, 'bad.js');

    writeFileSync(badScript, 'this is not valid javascript {{{{');

    // Start the script (will crash due to syntax error)
    orkify(`up ${badScript} -n test-syntax-error`);

    // Give it time to fail
    await sleep(2000);

    // Process should have started but then crashed
    const list = orkify('list');
    // Either shows error status or the start command itself failed
    expect(list).toContain('test-syntax-error');

    orkify('delete test-syntax-error');
    rmSync(tempDir, { recursive: true, force: true });
  }, 15000);

  it('handles permission denied gracefully', async () => {
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-perm-test-')));
    const noReadScript = join(tempDir, 'noread.js');

    writeFileSync(noReadScript, 'console.log("hello");');

    // Remove read permission
    const { chmodSync } = await import('node:fs');
    chmodSync(noReadScript, 0o000);

    try {
      // Try to start the script - should fail
      const output = orkify(`up ${noReadScript} -n test-perm-error`);

      // Should report an error (permission denied or similar)
      // The error could come from Node.js or the filesystem
      expect(output.toLowerCase()).toMatch(/error|fail|permission|denied|eacces/i);
    } finally {
      // Restore permissions so we can delete
      chmodSync(noReadScript, 0o644);
      orkify('delete test-perm-error');
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15000);

  it('handles port conflict gracefully', async () => {
    const tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'orkify-port-conflict-')));
    const script1 = join(tempDir, 'app1.js');
    const script2 = join(tempDir, 'app2.js');

    // Both scripts try to use the same port
    const portConflictScript = `
      const http = require('http');
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('ok');
      });
      server.listen(3031, () => {

      });
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `;

    writeFileSync(script1, portConflictScript);
    writeFileSync(script2, portConflictScript);

    // Start first app - should succeed
    orkify(`up ${script1} -n test-port-1`);
    await waitForProcessOnline('test-port-1');

    // Verify first app is running
    const { status } = await httpGet('http://localhost:3031/');
    expect(status).toBe(200);

    // Start second app on same port - should start but crash due to EADDRINUSE
    orkify(`up ${script2} -n test-port-2`);
    await sleep(2000);

    // First app should still be running
    const { status: status1 } = await httpGet('http://localhost:3031/');
    expect(status1).toBe(200);

    // Second app should be in error state (crashed) or restarting
    const list = orkify('list');
    expect(list).toContain('test-port-1');
    expect(list).toContain('test-port-2');
    // First should be online
    expect(list).toMatch(/test-port-1.*online|online.*test-port-1/i);

    orkify('delete test-port-1');
    orkify('delete test-port-2');
    rmSync(tempDir, { recursive: true, force: true });
  }, 20000);
});
