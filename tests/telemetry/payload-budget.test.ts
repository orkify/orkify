import { describe, expect, it } from 'vitest';
import type {
  TelemetryErrorEvent,
  TelemetryLogEntry,
  TelemetryPayload,
} from '../../src/types/index.js';
import { fitPayloadToBudget, payloadBytes } from '../../src/telemetry/payload-budget.js';

function log(i: number, size = 4000): TelemetryLogEntry {
  return {
    processName: 'app',
    workerId: 0,
    timestamp: i,
    level: 'info',
    message: `#${i} ${'x'.repeat(size)}`,
  };
}

function error(i: number, contextSize = 20_000): TelemetryErrorEvent {
  return {
    processName: 'app',
    workerId: 0,
    timestamp: i,
    errorType: 'uncaughtException',
    name: 'Error',
    message: `boom ${i}`,
    stack: `Error: boom ${i}\n    at f (app.js:1:1)`,
    fingerprint: `fp${i}`,
    sourceContext: [
      { file: 'app.js', line: 1, column: 1, pre: [], target: 'y'.repeat(contextSize), post: [] },
    ] as never,
    topFrame: { file: 'app.js', line: 1, column: 1 },
    diagnostics: null,
    nodeVersion: 'v22.0.0',
    pid: 1,
    lastLogs: ['z'.repeat(contextSize)],
  };
}

function payload(over: Partial<TelemetryPayload> = {}): TelemetryPayload {
  return {
    daemonPid: 1,
    daemonUptime: 100,
    hostname: 'h',
    agentName: 'a',
    machineId: 'm',
    host: { os: 'linux', arch: 'x64', nodeVersion: 'v22.0.0', cpuCount: 4, totalMemory: 8e9 },
    events: [{ type: 'process:start', processName: 'app', timestamp: 1 }],
    metrics: [],
    errors: [],
    logs: [],
    sentAt: 1,
    ...over,
  } as TelemetryPayload;
}

describe('fitPayloadToBudget', () => {
  it('returns a payload under budget unchanged', () => {
    const p = payload({ logs: [log(1, 100)] });
    const r = fitPayloadToBudget(p, 100_000);
    expect(r.payload).toBe(p);
    expect(r).toMatchObject({ droppedLogs: 0, slimmedErrors: 0, droppedErrors: 0 });
  });

  it('drops the OLDEST log lines first until the payload fits', () => {
    const p = payload({ logs: Array.from({ length: 40 }, (_, i) => log(i)) }); // ~160 KB
    const budget = 60_000;
    const r = fitPayloadToBudget(p, budget);

    expect(r.bytes).toBeLessThanOrEqual(budget);
    expect(payloadBytes(r.payload)).toBe(r.bytes);
    expect(r.droppedLogs).toBeGreaterThan(0);
    // Newest lines survive; oldest are gone.
    const kept = r.payload.logs.map((l) => l.timestamp);
    expect(kept.at(-1)).toBe(39);
    expect(kept).not.toContain(0);
  });

  it('never touches metrics, events or host info', () => {
    const p = payload({ logs: Array.from({ length: 40 }, (_, i) => log(i)) });
    const r = fitPayloadToBudget(p, 60_000);
    expect(r.payload.events).toEqual(p.events);
    expect(r.payload.metrics).toEqual(p.metrics);
    expect(r.payload.host).toEqual(p.host);
  });

  it('strips heavy error context (keeps the error) before dropping any error', () => {
    const p = payload({ errors: [error(1), error(2)] }); // ~80 KB, mostly context
    const r = fitPayloadToBudget(p, 10_000);

    expect(r.bytes).toBeLessThanOrEqual(10_000);
    expect(r.droppedErrors).toBe(0);
    expect(r.slimmedErrors).toBe(2);
    expect(r.payload.errors.map((e) => e.fingerprint)).toEqual(['fp1', 'fp2']);
    expect(r.payload.errors.every((e) => e.sourceContext === null && e.lastLogs.length === 0)).toBe(
      true
    );
  });

  it('drops the oldest errors only as a last resort', () => {
    const p = payload({ errors: Array.from({ length: 30 }, (_, i) => error(i, 10)) });
    const budget = payloadBytes(payload()) + 2_000; // room for only a few slim errors
    const r = fitPayloadToBudget(p, budget);

    expect(r.bytes).toBeLessThanOrEqual(budget);
    expect(r.droppedErrors).toBeGreaterThan(0);
    expect(r.payload.errors.at(-1)?.fingerprint).toBe('fp29'); // newest kept
  });

  it('trims logs before it ever touches errors', () => {
    const p = payload({ logs: Array.from({ length: 10 }, (_, i) => log(i)), errors: [error(1)] });
    const logBytes = payloadBytes(p) - payloadBytes(payload({ errors: [error(1)] }));
    const r = fitPayloadToBudget(p, payloadBytes(p) - logBytes / 2);

    expect(r.droppedLogs).toBeGreaterThan(0);
    expect(r.slimmedErrors).toBe(0);
    expect(r.payload.errors[0].sourceContext).not.toBeNull();
  });
});
