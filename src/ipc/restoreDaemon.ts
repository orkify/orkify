import { existsSync } from 'node:fs';
import { DAEMON_PID_FILE, IPCMessageType } from '../constants.js';
import type { IPCResponse, ProcessConfig } from '../types/index.js';
import { DaemonClient } from './DaemonClient.js';

/**
 * Wait for old daemon to exit, start a new one, and restore processes.
 * Shared by daemon-reload command and crash-recovery script.
 */
export async function restoreDaemon(
  client: DaemonClient,
  configs: ProcessConfig[],
  daemonEnv?: Record<string, string>
): Promise<IPCResponse> {
  if (daemonEnv) client.setSpawnEnv(daemonEnv);

  // Wait for old daemon to fully exit
  const deadline = Date.now() + 10_000;
  while (existsSync(DAEMON_PID_FILE) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  // Start new daemon (auto-start on connect) and restore configs
  const response = await client.request(IPCMessageType.RESTORE_CONFIGS, configs);
  return response;
}
