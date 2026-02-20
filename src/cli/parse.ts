import { cpus } from 'node:os';
import { DEFAULT_LOG_MAX_SIZE, MIN_LOG_MAX_SIZE } from '../constants.js';

/**
 * Core byte parser. Supports: 100M, 500K, 1G, 1.5G, or raw byte count.
 * Returns null if the string is not a valid size.
 */
function parseSizeBytes(value: string): null | number {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i);
  if (!match) {
    const num = parseInt(value, 10);
    return isNaN(num) ? null : num;
  }
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'k':
      return Math.round(num * 1024);
    case 'm':
      return Math.round(num * 1024 * 1024);
    case 'g':
      return Math.round(num * 1024 * 1024 * 1024);
    default:
      return Math.round(num);
  }
}

/**
 * Parse human-readable size for log rotation config.
 * Falls back to DEFAULT_LOG_MAX_SIZE on invalid input.
 * Enforces MIN_LOG_MAX_SIZE minimum.
 */
export function parseLogSize(value: string): number {
  return Math.max(parseSizeBytes(value) ?? DEFAULT_LOG_MAX_SIZE, MIN_LOG_MAX_SIZE);
}

/**
 * Parse human-readable size for memory threshold.
 * Exits process on invalid input (CLI validation).
 */
export function parseMemorySize(value: string): number {
  const bytes = parseSizeBytes(value);
  if (bytes === null || bytes <= 0) {
    console.error(`Invalid memory size: ${value}`);
    process.exit(1);
  }
  return bytes;
}

/**
 * Parse workers option:
 * - "0" → CPU cores
 * - negative number → CPU cores minus that value (-1 = CPUs - 1)
 * - positive number → that many workers
 */
export function parseWorkers(value: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num)) return 1;
  if (num === 0) return cpus().length;
  if (num < 0) return Math.max(1, cpus().length + num);
  return num;
}
