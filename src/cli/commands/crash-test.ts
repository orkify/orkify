import { Command } from 'commander';
import { IPCMessageType } from '../../constants.js';
import { daemonClient } from '../../ipc/DaemonClient.js';

export const crashTestCommand = new Command('_crash-test')
  .description('Trigger a daemon crash for testing (internal)')
  .action(async () => {
    try {
      await daemonClient.request(IPCMessageType.CRASH_TEST);
    } catch {
      // Expected — daemon crashes after responding
    } finally {
      daemonClient.disconnect();
    }
  });
