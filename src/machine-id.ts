import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let cached: null | string = null;

/**
 * Read a platform-specific machine identifier without elevated permissions.
 * - Linux: /etc/machine-id (systemd, readable by all users)
 * - macOS: IOPlatformUUID via ioreg
 * - Windows: MachineGuid from registry
 * Returns null if the ID can't be read (containers, restricted environments).
 */
export function getMachineId(): null | string {
  if (cached !== null) return cached || null;

  try {
    const id = readMachineId();
    cached = id ?? '';
    return id;
  } catch {
    cached = '';
    return null;
  }
}

function readMachineId(): null | string {
  switch (process.platform) {
    case 'linux': {
      const id = readFileSync('/etc/machine-id', 'utf8').trim();
      return id || null;
    }
    case 'darwin': {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        encoding: 'utf8',
        timeout: 3000,
      });
      const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      return match?.[1] ?? null;
    }
    case 'win32': {
      const out = execFileSync(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', timeout: 3000 }
      );
      const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
      return match?.[1] ?? null;
    }
    default:
      return null;
  }
}

/** Reset cached value — for testing only */
export function _resetMachineIdCache(): void {
  cached = null;
}
