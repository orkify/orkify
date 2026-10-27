import type { TelemetryErrorEvent, TelemetryPayload } from '../types/index.js';

export interface BudgetResult {
  payload: TelemetryPayload;
  /** Serialized size of `payload` in bytes. */
  bytes: number;
  droppedLogs: number;
  slimmedErrors: number;
  droppedErrors: number;
}

export function payloadBytes(payload: TelemetryPayload): number {
  return Buffer.byteLength(JSON.stringify(payload));
}

function slim(error: TelemetryErrorEvent): TelemetryErrorEvent {
  return { ...error, sourceContext: null, diagnostics: null, lastLogs: [] };
}

/**
 * Shrink a telemetry payload until it serializes within `budget` bytes, so one
 * oversized batch can never be rejected (413) forever. Cheapest data goes first:
 *   1. oldest log lines
 *   2. heavy error context (source, diagnostics, last logs) — the error itself stays
 *   3. oldest errors
 * Metrics, events, alerts and host info are small and never trimmed.
 */
export function fitPayloadToBudget(payload: TelemetryPayload, budget: number): BudgetResult {
  let bytes = payloadBytes(payload);
  const result: BudgetResult = {
    payload,
    bytes,
    droppedLogs: 0,
    slimmedErrors: 0,
    droppedErrors: 0,
  };
  if (bytes <= budget) return result;

  const logs = [...payload.logs];
  let errors = [...payload.errors];
  const current = (): TelemetryPayload => ({ ...payload, logs, errors });

  // Per-item sizes let us subtract without re-serializing on every drop.
  // (+1 for the array comma; approximate but conservative — verified at the end.)
  const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v)) + 1;

  while (logs.length > 0 && bytes > budget) {
    bytes -= size(logs.shift());
    result.droppedLogs++;
  }

  if (bytes > budget) {
    errors = errors.map((e) => {
      const s = slim(e);
      if (
        s.sourceContext !== e.sourceContext ||
        s.diagnostics !== e.diagnostics ||
        e.lastLogs.length > 0
      ) {
        bytes -= size(e) - size(s);
        result.slimmedErrors++;
      }
      return s;
    });
  }

  while (errors.length > 0 && bytes > budget) {
    bytes -= size(errors.shift());
    result.droppedErrors++;
  }

  result.payload = current();
  result.bytes = payloadBytes(result.payload);
  // Exact correction for the approximation above.
  while (result.bytes > budget && (logs.length > 0 || errors.length > 0)) {
    if (logs.length > 0) {
      logs.shift();
      result.droppedLogs++;
    } else {
      errors.shift();
      result.droppedErrors++;
    }
    result.payload = current();
    result.bytes = payloadBytes(result.payload);
  }
  return result;
}
