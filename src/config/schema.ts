import { z } from 'zod';
import {
  DEFAULT_LOG_MAX_AGE,
  DEFAULT_LOG_MAX_FILES,
  DEFAULT_LOG_MAX_SIZE,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_MIN_UPTIME,
  DEFAULT_RELOAD_RETRIES,
  DEFAULT_RESTART_DELAY,
  DEFAULT_WORKERS,
  KILL_TIMEOUT,
  MIN_LOG_MAX_SIZE,
} from '../constants.js';

export const startOptionsSchema = z.object({
  name: z.string().optional(),
  workers: z.number().int().positive().default(DEFAULT_WORKERS),
  watch: z.boolean().default(false),
  watchPaths: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  nodeArgs: z.array(z.string()).default([]),
  args: z.array(z.string()).default([]),
  killTimeout: z.number().int().positive().default(KILL_TIMEOUT),
  maxRestarts: z.number().int().nonnegative().default(DEFAULT_MAX_RESTARTS),
  minUptime: z.number().int().nonnegative().default(DEFAULT_MIN_UPTIME),
  restartDelay: z.number().int().nonnegative().default(DEFAULT_RESTART_DELAY),
  sticky: z.boolean().default(false),
  port: z.number().int().positive().optional(),
  reloadRetries: z.number().int().min(0).max(3).default(DEFAULT_RELOAD_RETRIES),
  healthCheck: z.string().startsWith('/').optional(),
  logMaxSize: z.number().int().min(MIN_LOG_MAX_SIZE).default(DEFAULT_LOG_MAX_SIZE),
  logMaxFiles: z.number().int().min(0).max(10000).default(DEFAULT_LOG_MAX_FILES),
  logMaxAge: z.number().int().nonnegative().default(DEFAULT_LOG_MAX_AGE),
});

export type StartOptions = z.infer<typeof startOptionsSchema>;

export const targetSchema = z.union([z.string(), z.number().int().nonnegative(), z.literal('all')]);

export type Target = z.infer<typeof targetSchema>;

export const logsOptionsSchema = z.object({
  lines: z.number().int().positive().default(100),
  follow: z.boolean().default(false),
});

export type LogsOptions = z.infer<typeof logsOptionsSchema>;

export function validateStartOptions(options: unknown): StartOptions {
  return startOptionsSchema.parse(options);
}

export function validateTarget(target: unknown): Target {
  return targetSchema.parse(target);
}

export function validateLogsOptions(options: unknown): LogsOptions {
  return logsOptionsSchema.parse(options);
}

export const mcpStateSchema = z.object({
  transport: z.literal('simple-http'),
  port: z.number().int().positive(),
  bind: z.string().min(1),
  cors: z.string().optional(),
});

export function validateMcpState(value: unknown): value is z.infer<typeof mcpStateSchema> {
  return mcpStateSchema.safeParse(value).success;
}
