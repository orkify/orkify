import { hostname } from 'node:os';
import type { Orchestrator } from '../daemon/Orchestrator.js';
import type { TelemetryReporter } from '../telemetry/TelemetryReporter.js';
import type { DeployCommand, TelemetryConfig } from '../types/index.js';
import { getAgentName } from '../agent-name.js';
import { DeployExecutor } from './DeployExecutor.js';

export class CommandPoller {
  private config: TelemetryConfig;
  private orchestrator: Orchestrator;
  private telemetry: TelemetryReporter;
  private polling = false;

  constructor(config: TelemetryConfig, orchestrator: Orchestrator, telemetry: TelemetryReporter) {
    this.config = config;
    this.orchestrator = orchestrator;
    this.telemetry = telemetry;
  }

  start(): void {
    this.telemetry.on('commands:pending', () => {
      void this.fetchAndExecute();
    });
  }

  async fetchAndExecute(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      const hn = hostname();
      const agentName = getAgentName();
      const response = await fetch(
        `${this.config.apiHost}/api/v1/deploy/commands?hostname=${encodeURIComponent(hn)}&agentName=${encodeURIComponent(agentName)}`,
        {
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        console.error(`Command poll failed: ${response.status}`);
        return;
      }

      const body = (await response.json()) as { commands: DeployCommand[] };

      for (const cmd of body.commands) {
        if (cmd.type === 'deploy') {
          const executor = new DeployExecutor(this.config, this.orchestrator, this.telemetry, cmd);
          // Execute asynchronously — status reported via telemetry
          executor.execute().catch((err) => {
            console.error(`Deploy execution error: ${(err as Error).message}`);
          });
        }
      }
    } catch (err) {
      console.error(`Command poll error: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }
}
