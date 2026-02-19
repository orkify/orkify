import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DAEMON_PID_FILE,
  ExecMode,
  IPCMessageType,
  LOGS_DIR,
  ORKIFY_HOME,
  ProcessStatus,
  SNAPSHOT_FILE,
  SOCKET_PATH,
} from '../src/constants.js';

describe('Constants', () => {
  describe('Paths', () => {
    it('ORKIFY_HOME is in user home directory', () => {
      expect(ORKIFY_HOME).toBe(join(homedir(), '.orkify'));
    });

    it('SOCKET_PATH is platform-specific and user-namespaced', () => {
      const username = userInfo().username;
      if (process.platform === 'win32') {
        expect(SOCKET_PATH).toBe(`\\\\.\\pipe\\orkify-${username}`);
      } else {
        expect(SOCKET_PATH).toBe(join(ORKIFY_HOME, 'orkify.sock'));
      }
    });

    it('SNAPSHOT_FILE is in ORKIFY_HOME', () => {
      expect(SNAPSHOT_FILE).toBe(join(ORKIFY_HOME, 'snapshot.yml'));
    });

    it('DAEMON_PID_FILE is in ORKIFY_HOME', () => {
      expect(DAEMON_PID_FILE).toBe(join(ORKIFY_HOME, 'daemon.pid'));
    });

    it('LOGS_DIR is in ORKIFY_HOME', () => {
      expect(LOGS_DIR).toBe(join(ORKIFY_HOME, 'logs'));
    });
  });

  describe('ProcessStatus', () => {
    it('has all expected statuses', () => {
      expect(ProcessStatus.ONLINE).toBe('online');
      expect(ProcessStatus.STOPPING).toBe('stopping');
      expect(ProcessStatus.STOPPED).toBe('stopped');
      expect(ProcessStatus.ERRORED).toBe('errored');
      expect(ProcessStatus.LAUNCHING).toBe('launching');
    });
  });

  describe('ExecMode', () => {
    it('has all expected modes', () => {
      expect(ExecMode.FORK).toBe('fork');
      expect(ExecMode.CLUSTER).toBe('cluster');
    });
  });

  describe('IPCMessageType', () => {
    it('has all command types', () => {
      expect(IPCMessageType.UP).toBe('up');
      expect(IPCMessageType.DOWN).toBe('down');
      expect(IPCMessageType.RESTART).toBe('restart');
      expect(IPCMessageType.RELOAD).toBe('reload');
      expect(IPCMessageType.DELETE).toBe('delete');
      expect(IPCMessageType.LIST).toBe('list');
      expect(IPCMessageType.LOGS).toBe('logs');
      expect(IPCMessageType.SNAP).toBe('snap');
      expect(IPCMessageType.RESTORE).toBe('restore');
      expect(IPCMessageType.RESTORE_CONFIGS).toBe('restore_configs');
      expect(IPCMessageType.KILL_DAEMON).toBe('kill_daemon');
      expect(IPCMessageType.PING).toBe('ping');
    });

    it('has all response types', () => {
      expect(IPCMessageType.SUCCESS).toBe('success');
      expect(IPCMessageType.ERROR).toBe('error');
      expect(IPCMessageType.PROCESS_LIST).toBe('process_list');
      expect(IPCMessageType.LOG_DATA).toBe('log_data');
      expect(IPCMessageType.PONG).toBe('pong');
    });
  });
});
