import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Integration tests share a daemon and must run sequentially
    fileParallelism: false,
    // Integration tests spawn real processes, so higher threshold for "slow" warning
    slowTestThreshold: 1500,
    // Clean up stale daemon/processes before and after integration tests
    globalSetup: ['tests/integration/globalSetup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/**'],
      thresholds: {
        // Per-glob thresholds for modules with meaningful unit test coverage.
        // I/O boundary code (cli, ipc clients, cluster, daemon entry) is
        // covered by integration tests and intentionally excluded here.
        'src/config/schema.ts': { lines: 100, branches: 100 },
        'src/constants.ts': { lines: 97.36, branches: 50 },
        'src/state/StateStore.ts': { lines: 96.55, branches: 91.3 },
        'src/probe/parse-frames.ts': { lines: 95.65, branches: 100 },
        'src/ipc/protocol.ts': { lines: 100, branches: 100 },
        'src/telemetry/TelemetryReporter.ts': { lines: 91, branches: 83 },
        'src/daemon/Orchestrator.ts': { lines: 85, branches: 84.14 },
        'src/daemon/RotatingWriter.ts': { lines: 70, branches: 60 },
        'src/daemon/ManagedProcess.ts': { lines: 62, branches: 48.9 },
        'src/deploy/env.ts': { lines: 100, branches: 100 },
        'src/deploy/tarball.ts': { lines: 81.53, branches: 78.94 },
        'src/deploy/config.ts': { lines: 100, branches: 100 },
        'src/cache/CacheStore.ts': { lines: 100, branches: 93 },
        'src/cache/CacheClient.ts': { lines: 100, branches: 97 },
        'src/cache/CachePersistence.ts': { lines: 100, branches: 100 },
        'src/cache/CachePrimary.ts': { lines: 100, branches: 80 },
        'src/cache/serialize.ts': { lines: 100, branches: 100 },
        'src/deploy/DeployExecutor.ts': { lines: 73, branches: 56 },
      },
    },
    testTimeout: 15000,
    hookTimeout: 60000,
  },
});
