import chalk from 'chalk';
import { cpus } from 'node:os';
import type { CronJob } from '../types/index.js';
import { DEFAULT_LOG_MAX_SIZE, MIN_LOG_MAX_SIZE } from '../constants.js';
import { validateCronPath, validateCronSchedule } from '../cron/CronScheduler.js';

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

/**
 * Parse --cron spec strings into CronJob objects.
 * Each spec is "schedule path" where schedule is a 5-part cron expression
 * and path is the last whitespace-separated token.
 * Exits process on validation failure.
 */
export function parseCronSpecs(specs: string[]): CronJob[] {
  const cronJobs: CronJob[] = [];
  for (const spec of specs) {
    const tokens = spec.trim().split(/\s+/);
    if (tokens.length < 6) {
      console.error(chalk.red(`✗ Invalid --cron spec: "${spec}" (need 5-part schedule + path)`));
      process.exit(1);
    }
    const path = tokens[tokens.length - 1];
    const schedule = tokens.slice(0, -1).join(' ');
    const pathError = validateCronPath(path);
    if (pathError) {
      console.error(chalk.red(`✗ Invalid --cron: ${pathError}`));
      process.exit(1);
    }
    const scheduleError = validateCronSchedule(schedule);
    if (scheduleError) {
      console.error(chalk.red(`✗ Invalid --cron: ${scheduleError}`));
      process.exit(1);
    }
    cronJobs.push({ schedule, path });
  }
  return cronJobs;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
