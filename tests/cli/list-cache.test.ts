import { describe, expect, it } from 'vitest';
import type { ProcessInfo } from '../../src/types/index.js';
import { formatProcessTable } from '../../src/cli/commands/list.js';

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

function makeProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    id: 0,
    name: 'app',
    script: '/app.js',
    cwd: '/app',
    execMode: 'fork',
    workerCount: 1,
    status: 'online',
    workers: [
      {
        id: 0,
        pid: 1234,
        status: 'online',
        restarts: 0,
        crashes: 0,
        uptime: 60_000,
        memory: 50 * 1024 * 1024,
        cpu: 5.0,
        createdAt: Date.now() - 60_000,
      },
    ],
    createdAt: Date.now() - 60_000,
    watch: false,
    sticky: false,
    ...overrides,
  };
}

function makeCluster(workers: ProcessInfo['workers']): ProcessInfo {
  return {
    id: 1,
    name: 'cluster',
    script: '/cluster.js',
    cwd: '/app',
    execMode: 'cluster',
    workerCount: workers.length,
    status: 'online',
    workers,
    pid: 1000,
    createdAt: Date.now() - 120_000,
    watch: false,
    sticky: false,
  };
}

describe('formatProcessTable --cache', () => {
  it('does not show cache columns without --cache flag', () => {
    const proc = makeProcess({
      workers: [
        {
          id: 0,
          pid: 1234,
          status: 'online',
          restarts: 0,
          crashes: 0,
          uptime: 60_000,
          memory: 50 * 1024 * 1024,
          cpu: 5.0,
          createdAt: Date.now(),
          cacheSize: 100,
          cacheHits: 500,
          cacheMisses: 50,
          cacheHitRate: 90.9,
        },
      ],
    });

    const table = stripAnsi(formatProcessTable([proc]));
    expect(table).not.toContain('size');
    expect(table).not.toContain('hit%');
  });

  it('shows cache columns with --cache when data present', () => {
    const proc = makeProcess({
      workers: [
        {
          id: 0,
          pid: 1234,
          status: 'online',
          restarts: 0,
          crashes: 0,
          uptime: 60_000,
          memory: 50 * 1024 * 1024,
          cpu: 5.0,
          createdAt: Date.now(),
          cacheSize: 100,
          cacheHits: 500,
          cacheMisses: 50,
          cacheHitRate: 90.9,
        },
      ],
    });

    const table = stripAnsi(formatProcessTable([proc], { cache: true }));
    expect(table).toContain('size');
    expect(table).toContain('hits');
    expect(table).toContain('misses');
    expect(table).toContain('hit%');
    expect(table).toContain('100');
    expect(table).toContain('500');
    expect(table).toContain('50');
    expect(table).toContain('90.9%');
  });

  it('does not show cache columns with --cache when no worker has cache data', () => {
    const proc = makeProcess();

    const table = stripAnsi(formatProcessTable([proc], { cache: true }));
    expect(table).not.toContain('hit%');
  });

  it('shows gray dash for workers without cache in a mixed cluster', () => {
    const cluster = makeCluster([
      {
        id: 0,
        pid: 2000,
        status: 'online',
        restarts: 0,
        crashes: 0,
        uptime: 60_000,
        memory: 50 * 1024 * 1024,
        cpu: 5.0,
        createdAt: Date.now(),
        cacheSize: 200,
        cacheHits: 1000,
        cacheMisses: 100,
        cacheHitRate: 90.9,
      },
      {
        id: 1,
        pid: 2001,
        status: 'online',
        restarts: 0,
        crashes: 0,
        uptime: 60_000,
        memory: 50 * 1024 * 1024,
        cpu: 5.0,
        createdAt: Date.now(),
        // No cache data
      },
    ]);

    const table = stripAnsi(formatProcessTable([cluster], { cache: true }));
    // Should contain cache headers
    expect(table).toContain('hit%');
    // Worker 0 should show data
    expect(table).toContain('200');
    expect(table).toContain('1,000');
    // Should contain dashes for worker without cache
    expect(table).toContain('-');
  });

  it('aggregates cache stats in cluster summary row', () => {
    const cluster = makeCluster([
      {
        id: 0,
        pid: 2000,
        status: 'online',
        restarts: 0,
        crashes: 0,
        uptime: 60_000,
        memory: 50 * 1024 * 1024,
        cpu: 5.0,
        createdAt: Date.now(),
        cacheSize: 200,
        cacheHits: 800,
        cacheMisses: 200,
        cacheHitRate: 80.0,
      },
      {
        id: 1,
        pid: 2001,
        status: 'online',
        restarts: 0,
        crashes: 0,
        uptime: 60_000,
        memory: 50 * 1024 * 1024,
        cpu: 5.0,
        createdAt: Date.now(),
        cacheSize: 300,
        cacheHits: 700,
        cacheMisses: 300,
        cacheHitRate: 70.0,
      },
    ]);

    const table = stripAnsi(formatProcessTable([cluster], { cache: true }));
    // Summary should aggregate: size=500, hits=1500, misses=500
    expect(table).toContain('500');
    expect(table).toContain('1,500');
    // Aggregate hit rate: 1500/(1500+500) = 75.0%
    expect(table).toContain('75.0%');
  });
});
