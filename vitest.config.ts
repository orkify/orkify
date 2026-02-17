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
        // Ratchet: when coverage improves, vitest auto-raises the floor.
        autoUpdate: true,
        // Per-glob thresholds for modules with meaningful unit test coverage.
        // I/O boundary code (cli, ipc clients, cluster, daemon entry) is
        // covered by integration tests and intentionally excluded here.
        'src/config/schema.ts': { lines: 100, branches: 100 },
        'src/constants.ts': { lines: 97.36, branches: 50 },
        'src/state/StateStore.ts': { lines: 96.55, branches: 91.3 },
        'src/probe/parse-frames.ts': { lines: 95.65, branches: 100 },
        'src/ipc/protocol.ts': { lines: 100, branches: 100 },
        'src/telemetry/TelemetryReporter.ts': { lines: 94.63, branches: 87.5 },
        'src/daemon/Orchestrator.ts': { lines: 86.74, branches: 84.14 },
        'src/daemon/ManagedProcess.ts': { lines: 63.17, branches: 48.9 },
        'src/deploy/env.ts': { lines: 100, branches: 100 },
        'src/deploy/tarball.ts': { lines: 81.53, branches: 78.94 },
        'src/deploy/config.ts': { lines: 100, branches: 100 },
        'src/deploy/DeployExecutor.ts': { lines: 76.35, branches: 60 },
      },
    },
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
