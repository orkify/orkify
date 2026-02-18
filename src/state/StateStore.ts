import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stringify, parse } from 'yaml';
import { validateMcpState } from '../config/schema.js';
import { SNAPSHOT_FILE } from '../constants.js';
import type { McpStartPayload, ProcessConfig, SavedState } from '../types/index.js';

const STATE_VERSION = 1;

export class StateStore {
  private filePath: string;

  constructor(filePath: string = SNAPSHOT_FILE) {
    this.filePath = filePath;
  }

  async save(processes: ProcessConfig[], mcp?: McpStartPayload): Promise<void> {
    const state: SavedState = {
      version: STATE_VERSION,
      processes,
      ...(mcp ? { mcp } : {}),
    };

    // Ensure directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Atomic write: write to temp file then rename to prevent corruption
    // if the process crashes mid-write
    const tmpPath = this.filePath + '.tmp';
    await writeFile(tmpPath, stringify(state, { defaultStringType: 'QUOTE_DOUBLE' }), 'utf-8');
    await rename(tmpPath, this.filePath);
  }

  async load(): Promise<ProcessConfig[]> {
    const state = await this.loadFull();
    return state.processes;
  }

  async loadFull(): Promise<SavedState> {
    if (!existsSync(this.filePath)) {
      return { processes: [] };
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const state: SavedState = parse(content);

      const version = state?.version ?? 1;
      if (version !== STATE_VERSION) {
        console.warn(`Snapshot file version mismatch: expected ${STATE_VERSION}, got ${version}`);
      }

      const processes = state?.processes || [];

      // Coerce env values to strings — YAML parses unquoted values like
      // `PORT: 3000` as numbers and `VERBOSE: yes` as booleans.  Environment
      // variables must always be strings.
      for (const proc of processes) {
        if (proc.env && typeof proc.env === 'object') {
          for (const [key, value] of Object.entries(proc.env)) {
            if (typeof value !== 'string') {
              proc.env[key] = value === null || value === undefined ? '' : String(value);
            }
          }
        }
      }

      const mcp = validateMcpState(state?.mcp) ? (state.mcp as McpStartPayload) : undefined;
      if (state?.mcp && !mcp) {
        console.warn('Snapshot contains invalid mcp section — ignoring');
      }

      return { ...state, processes, mcp };
    } catch (err) {
      console.error('Failed to load snapshot:', err);
      return { processes: [] };
    }
  }

  async clear(): Promise<void> {
    if (existsSync(this.filePath)) {
      await writeFile(
        this.filePath,
        stringify({ version: STATE_VERSION, processes: [] }, { defaultStringType: 'QUOTE_DOUBLE' }),
        'utf-8'
      );
    }
  }

  async exists(): Promise<boolean> {
    return existsSync(this.filePath);
  }
}
