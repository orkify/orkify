import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Module mocks — vitest hoists these before imports
vi.mock('../../src/deploy/config.js', () => ({
  getOrkifyConfig: vi.fn(),
  collectGitMetadata: vi.fn(),
  interactiveConfig: vi.fn(),
  readPackageJson: vi.fn(),
  saveOrkifyConfig: vi.fn(),
}));

vi.mock('../../src/deploy/tarball.js', () => ({
  createTarball: vi.fn(),
}));

vi.mock('../../src/ipc/DaemonClient.js', () => ({
  daemonClient: { request: vi.fn(), disconnect: vi.fn() },
}));

import {
  computeSha256,
  deployCommand,
  formatSize,
  parseErrorBody,
} from '../../src/cli/commands/deploy.js';
import { collectGitMetadata, getOrkifyConfig, readPackageJson } from '../../src/deploy/config.js';
import { createTarball } from '../../src/deploy/tarball.js';

// ---------------------------------------------------------------------------
// Unit tests for helper functions
// ---------------------------------------------------------------------------

describe('deploy upload helpers', () => {
  describe('parseErrorBody', () => {
    it('extracts error field from JSON response', async () => {
      const resp = new Response(JSON.stringify({ error: 'Quota exceeded' }), {
        status: 403,
        statusText: 'Forbidden',
      });
      expect(await parseErrorBody(resp)).toBe('Quota exceeded');
    });

    it('falls back to status text when JSON has no error field', async () => {
      const resp = new Response(JSON.stringify({ ok: false }), {
        status: 500,
        statusText: 'Internal Server Error',
      });
      expect(await parseErrorBody(resp)).toBe('500 Internal Server Error');
    });

    it('falls back to status text for non-JSON response', async () => {
      const resp = new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
      });
      expect(await parseErrorBody(resp)).toBe('404 Not Found');
    });

    it('falls back to status text for malformed JSON', async () => {
      const resp = new Response('{{invalid', {
        status: 502,
        statusText: 'Bad Gateway',
      });
      expect(await parseErrorBody(resp)).toBe('502 Bad Gateway');
    });
  });

  describe('formatSize', () => {
    it('returns "0 B" for zero bytes', () => {
      expect(formatSize(0)).toBe('0 B');
    });

    it('formats bytes', () => {
      expect(formatSize(500)).toBe('500 B');
    });

    it('formats kilobytes', () => {
      expect(formatSize(1024)).toBe('1 KB');
      expect(formatSize(1536)).toBe('1.5 KB');
    });

    it('formats megabytes', () => {
      expect(formatSize(1024 * 1024)).toBe('1 MB');
    });

    it('formats gigabytes', () => {
      expect(formatSize(1024 * 1024 * 1024)).toBe('1 GB');
    });
  });

  describe('computeSha256', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'orkify-sha-test-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('computes correct SHA-256 hash', async () => {
      const filePath = join(tempDir, 'test.txt');
      writeFileSync(filePath, 'hello world', 'utf-8');
      const hash = await computeSha256(filePath);
      // SHA-256 of "hello world"
      expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });

    it('returns a 64-character hex string', async () => {
      const filePath = join(tempDir, 'test.bin');
      writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02]));
      const hash = await computeSha256(filePath);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});

// ---------------------------------------------------------------------------
// Upload command flow tests
// ---------------------------------------------------------------------------

describe('deploy upload command', () => {
  let tempDir: string;
  let tarPath: string;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let savedApiKey: string | undefined;
  let savedApiHost: string | undefined;

  const UPLOAD_RESPONSE = {
    ok: true,
    json: async () => ({
      artifactId: 'art-123',
      uploadUrl: 'https://s3.example.com/presigned',
      version: 1,
    }),
  };
  const PUT_RESPONSE = { ok: true };
  const CONFIRM_RESPONSE = { ok: true, json: async () => ({ ok: true }) };

  beforeEach(() => {
    // Save and clear env vars the deploy command reads
    savedApiKey = process.env.ORKIFY_API_KEY;
    savedApiHost = process.env.ORKIFY_API_HOST;
    delete process.env.ORKIFY_API_KEY;
    delete process.env.ORKIFY_API_HOST;

    tempDir = mkdtempSync(join(tmpdir(), 'orkify-upload-test-'));

    // Real package.json for the existsSync check
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'test-app', version: '1.0.0' }),
      'utf-8'
    );

    // Real tarball file for statSync / readFileSync / computeSha256
    tarPath = join(tempDir, 'test.tar.gz');
    writeFileSync(tarPath, 'fake-tarball-content');

    // Mock config functions
    vi.mocked(getOrkifyConfig).mockReturnValue({
      version: 1,
      deploy: { install: 'npm ci' },
      processes: [{ name: 'app', script: 'dist/app.js' }],
    } as never);
    vi.mocked(readPackageJson).mockReturnValue({ name: 'test-app', version: '1.0.0' });
    vi.mocked(collectGitMetadata).mockReturnValue({});
    vi.mocked(createTarball).mockResolvedValue(tarPath);

    // Mock fetch
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // Spy on console and process.exit
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();

    // Restore env vars
    if (savedApiKey !== undefined) process.env.ORKIFY_API_KEY = savedApiKey;
    else delete process.env.ORKIFY_API_KEY;
    if (savedApiHost !== undefined) process.env.ORKIFY_API_HOST = savedApiHost;
    else delete process.env.ORKIFY_API_HOST;
  });

  /** Run the upload subcommand, swallowing the throw from mocked process.exit. */
  async function runUpload(extraArgs: string[] = []) {
    try {
      await deployCommand.parseAsync(['upload', tempDir, '--api-key', 'test-key', ...extraArgs], {
        from: 'user',
      });
    } catch {
      // process.exit mock throws — expected for error paths
    }
  }

  it('exits with error when API key is missing', async () => {
    try {
      await deployCommand.parseAsync(['upload', tempDir], { from: 'user' });
    } catch {
      // expected
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('API key required'));
  });

  it('shows parsed error on upload request failure', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ error: 'Deploy storage full (0.95/1 GB used)' }),
    });

    await runUpload();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Artifact upload failed: Deploy storage full')
    );
  });

  it('shows status text when upload returns non-JSON error', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => {
        throw new Error('not json');
      },
    });

    await runUpload();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Artifact upload failed: 503 Service Unavailable')
    );
  });

  it('shows parsed error on storage upload failure', async () => {
    fetchSpy.mockResolvedValueOnce(UPLOAD_RESPONSE).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new Error('not json');
      },
    });

    await runUpload();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Artifact storage failed: 500 Internal Server Error')
    );
  });

  it('shows parsed error on confirmation failure', async () => {
    fetchSpy
      .mockResolvedValueOnce(UPLOAD_RESPONSE)
      .mockResolvedValueOnce(PUT_RESPONSE)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Failed to confirm artifact' }),
      });

    await runUpload();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Artifact confirmation failed: Failed to confirm artifact')
    );
  });

  it('succeeds and shows artifact info', async () => {
    // For success path, process.exit should not be called — use no-op mock
    exitSpy.mockRestore();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    fetchSpy
      .mockResolvedValueOnce(UPLOAD_RESPONSE)
      .mockResolvedValueOnce(PUT_RESPONSE)
      .mockResolvedValueOnce(CONFIRM_RESPONSE);

    await deployCommand.parseAsync(['upload', tempDir, '--api-key', 'test-key'], {
      from: 'user',
    });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Artifact v1 uploaded'));
  });

  it('sends correct headers and body to upload endpoint', async () => {
    exitSpy.mockRestore();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    fetchSpy
      .mockResolvedValueOnce(UPLOAD_RESPONSE)
      .mockResolvedValueOnce(PUT_RESPONSE)
      .mockResolvedValueOnce(CONFIRM_RESPONSE);

    await deployCommand.parseAsync(
      ['upload', tempDir, '--api-key', 'test-key', '--api-host', 'https://api.test.com'],
      { from: 'user' }
    );

    // Verify upload endpoint call
    const [uploadUrl, uploadOpts] = fetchSpy.mock.calls[0];
    expect(uploadUrl).toBe('https://api.test.com/api/v1/deploy/upload');
    expect(uploadOpts.method).toBe('POST');
    expect(uploadOpts.headers['Authorization']).toBe('Bearer test-key');
    expect(uploadOpts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(uploadOpts.body);
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.sizeBytes).toBeGreaterThan(0);
    expect(body.filename).toBe('test-app.tar.gz');

    // Verify PUT to presigned URL
    const [putUrl, putOpts] = fetchSpy.mock.calls[1];
    expect(putUrl).toBe('https://s3.example.com/presigned');
    expect(putOpts.method).toBe('PUT');
    expect(putOpts.headers['Content-Type']).toBe('application/gzip');

    // Verify confirm endpoint call
    const [confirmUrl, confirmOpts] = fetchSpy.mock.calls[2];
    expect(confirmUrl).toBe('https://api.test.com/api/v1/deploy/upload/art-123/confirm');
    expect(confirmOpts.method).toBe('POST');
    expect(confirmOpts.headers['Authorization']).toBe('Bearer test-key');
  });
});
