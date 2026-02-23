import { hostname } from 'node:os';
import type { ConfigStore } from '../config/ConfigStore.js';
import type { TelemetryAlertEvent, TelemetryMetricsSnapshot } from '../types/index.js';

interface AlertState {
  consecutiveViolations: number;
  triggered: boolean;
  cooldownUntil: number; // timestamp
}

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export class AlertEvaluator {
  private states = new Map<string, AlertState>();
  private buffer: TelemetryAlertEvent[] = [];
  private knownRuleIds = new Set<string>();
  private host = hostname();

  constructor(private configStore: ConfigStore) {}

  evaluate(snapshots: TelemetryMetricsSnapshot[]): void {
    const rules = this.configStore.getAlertRules().filter((r) => r.is_enabled);
    const now = Date.now();

    // Track current rule IDs to prune stale states
    const currentRuleIds = new Set(rules.map((r) => r.id));

    // Prune states for removed rules
    if (!setsEqual(currentRuleIds, this.knownRuleIds)) {
      for (const key of this.states.keys()) {
        const ruleId = key.split(':')[0];
        if (!currentRuleIds.has(ruleId)) {
          this.states.delete(key);
        }
      }
      this.knownRuleIds = currentRuleIds;
    }

    // Build lookup of current process:worker combos for pruning
    const activeKeys = new Set<string>();

    for (const rule of rules) {
      const { metric, threshold, duration } = rule.condition;

      // Heartbeat rules are server-evaluated — skip on CLI
      if (metric === 'heartbeat') continue;

      for (const snapshot of snapshots) {
        for (const worker of snapshot.workers) {
          const key = `${rule.id}:${snapshot.processName}:${worker.id}`;
          activeKeys.add(key);

          const value = metric === 'cpu' ? worker.cpu : worker.memory;
          let state = this.states.get(key);

          if (!state) {
            state = { consecutiveViolations: 0, triggered: false, cooldownUntil: 0 };
            this.states.set(key, state);
          }

          if (value > threshold) {
            state.consecutiveViolations++;

            if (
              !state.triggered &&
              state.consecutiveViolations >= duration &&
              now >= state.cooldownUntil
            ) {
              state.triggered = true;
              state.cooldownUntil = now + COOLDOWN_MS;
              this.buffer.push({
                type: 'alert:triggered',
                rule_id: rule.id,
                rule_name: rule.name,
                metric,
                value,
                threshold,
                process_name: snapshot.processName,
                worker_id: worker.id,
                hostname: this.host,
                timestamp: now,
              });
            }
          } else {
            if (state.triggered) {
              this.buffer.push({
                type: 'alert:resolved',
                rule_id: rule.id,
                rule_name: rule.name,
                metric,
                value,
                threshold,
                process_name: snapshot.processName,
                worker_id: worker.id,
                hostname: this.host,
                timestamp: now,
              });
            }
            state.consecutiveViolations = 0;
            state.triggered = false;
          }
        }
      }
    }

    // Prune states for workers that are no longer active
    for (const key of this.states.keys()) {
      if (!activeKeys.has(key)) {
        const state = this.states.get(key);
        if (!state) continue;
        if (state.triggered) {
          const parts = key.split(':');
          const ruleId = parts[0];
          const processName = parts.slice(1, -1).join(':');
          const workerId = Number(parts[parts.length - 1]);
          const rule = rules.find((r) => r.id === ruleId);
          if (rule) {
            this.buffer.push({
              type: 'alert:resolved',
              rule_id: ruleId,
              rule_name: rule.name,
              metric: rule.condition.metric,
              value: 0,
              threshold: rule.condition.threshold,
              process_name: processName,
              worker_id: workerId,
              hostname: this.host,
              timestamp: now,
            });
          }
        }
        this.states.delete(key);
      }
    }
  }

  drainAlerts(): TelemetryAlertEvent[] {
    const alerts = this.buffer;
    this.buffer = [];
    return alerts;
  }

  restoreAlerts(alerts: TelemetryAlertEvent[]): void {
    this.buffer.unshift(...alerts);
  }
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}
