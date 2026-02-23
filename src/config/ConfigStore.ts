import { EventEmitter } from 'node:events';
import type { AlertRuleConfig, McpRemoteConfig, ProjectConfig } from '../types/index.js';

export class ConfigStore extends EventEmitter {
  private hash: null | string = null;
  private config: null | ProjectConfig = null;

  getHash(): null | string {
    return this.hash;
  }

  getAlertRules(): AlertRuleConfig[] {
    return this.config?.alert_rules ?? [];
  }

  getMcpConfig(): McpRemoteConfig {
    return this.config?.mcp ?? { enabled: false, keys: [] };
  }

  update(config: ProjectConfig, hash: string): void {
    const prevMcp = this.config?.mcp;
    this.config = config;
    this.hash = hash;
    this.emit('config:updated', config, prevMcp);
  }
}
