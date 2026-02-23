import { CronExpressionParser } from 'cron-parser';
import type { Orchestrator } from '../daemon/Orchestrator.js';
import type { CronJob } from '../types/index.js';

interface CronJobState {
  job: CronJob;
  processName: string;
  nextRun: Date;
  running: boolean;
}

const DEFAULT_TIMEOUT = 30_000;
const TICK_INTERVAL = 30_000;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * Validate a cron schedule string. Returns null if valid,
 * or an error message if invalid, sub-minute, or > 24h.
 */
export function validateCronSchedule(schedule: string): null | string {
  try {
    const expr = CronExpressionParser.parse(schedule);
    const first = expr.next().toDate();
    const second = expr.next().toDate();
    const intervalMs = second.getTime() - first.getTime();
    if (intervalMs < MIN_INTERVAL_MS) {
      return `schedule "${schedule}" fires every ${Math.round(intervalMs / 1000)}s — minimum interval is 60s`;
    }
    if (intervalMs > MAX_INTERVAL_MS) {
      const hours = Math.round(intervalMs / 3_600_000);
      return `schedule "${schedule}" fires every ${hours}h — maximum interval is 24h`;
    }
    return null;
  } catch {
    return `invalid cron expression: "${schedule}"`;
  }
}

/**
 * Validate a cron job path. Must be a clean local route path
 * (e.g. "/api/cron/heartbeat-check") — no URLs, hosts, or query strings.
 */
export function validateCronPath(path: string): null | string {
  if (!path.startsWith('/')) {
    return `path "${path}" must start with /`;
  }
  if (/[:\\?#@]/.test(path)) {
    return `path "${path}" must be a plain route path (no ":", "?", "#", or "@")`;
  }
  if (path.includes('..')) {
    return `path "${path}" must not contain ".."`;
  }
  return null;
}

export class CronScheduler {
  private orchestrator: Orchestrator;
  private jobs: CronJobState[] = [];
  private timer: null | ReturnType<typeof setInterval> = null;

  constructor(orchestrator: Orchestrator) {
    this.orchestrator = orchestrator;
    this.timer = setInterval(() => this.tick(), TICK_INTERVAL);
    this.timer.unref();
  }

  register(processName: string, jobs: CronJob[]): void {
    // Remove any existing jobs for this process first
    this.unregister(processName);

    for (const job of jobs) {
      const pathError = validateCronPath(job.path);
      if (pathError) {
        console.error(`[cron] ${processName} — ${pathError}, skipping`);
        continue;
      }

      const error = validateCronSchedule(job.schedule);
      if (error) {
        console.error(`[cron] ${processName}${job.path} — ${error}, skipping`);
        continue;
      }

      // Safe: validateCronSchedule above guarantees a valid schedule
      const nextRun = this.computeNextRun(job.schedule) as Date;

      this.jobs.push({
        job,
        processName,
        nextRun,
        running: false,
      });

      console.log(
        `[cron] Registered ${processName} ${job.method ?? 'GET'} ${job.path} schedule="${job.schedule}" next=${nextRun.toISOString()}`
      );
    }
  }

  unregister(processName: string): void {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((s) => s.processName !== processName);
    if (this.jobs.length < before) {
      console.log(`[cron] Unregistered all jobs for ${processName}`);
    }
  }

  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.jobs = [];
  }

  private tick(): void {
    const now = Date.now();

    for (const state of this.jobs) {
      if (state.running) continue;
      if (now < state.nextRun.getTime()) continue;

      this.dispatch(state);
    }
  }

  private dispatch(state: CronJobState): void {
    const { job, processName } = state;

    // Look up process port and secret
    const processList = this.orchestrator.list();
    const proc = processList.find((p) => p.name === processName);
    const port = proc?.port;
    const cronSecret = this.orchestrator.getCronSecret(processName);

    if (!port) {
      console.log(`[cron] ${processName}${job.path} — no port detected, skipping`);
      state.nextRun = this.computeNextRun(job.schedule) ?? new Date(Date.now() + 60_000);
      return;
    }

    const method = job.method ?? 'GET';
    const timeout = job.timeout ?? DEFAULT_TIMEOUT;
    const headers: Record<string, string> = {};
    if (cronSecret) {
      headers['Authorization'] = `Bearer ${cronSecret}`;
    }

    state.running = true;

    fetch(`http://localhost:${port}${job.path}`, {
      method,
      headers,
      signal: AbortSignal.timeout(timeout),
    })
      .then((res) => {
        console.log(`[cron] ${processName} ${method} ${job.path} → ${res.status}`);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[cron] ${processName} ${method} ${job.path} — error: ${message}`);
      })
      .finally(() => {
        state.running = false;
        state.nextRun = this.computeNextRun(job.schedule) ?? new Date(Date.now() + 60_000);
      });
  }

  private computeNextRun(schedule: string): Date | null {
    try {
      const expr = CronExpressionParser.parse(schedule);
      return expr.next().toDate();
    } catch {
      return null;
    }
  }
}
