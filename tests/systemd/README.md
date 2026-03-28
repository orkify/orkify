# Systemd Integration Test

Tests orkify's systemd integration by running the actual `orkify@.service`
unit under systemd inside Docker. Covers start, stop, restart, reload, and
rapid restarts — the last of which reproduces the race condition where
`systemctl restart` fails because the old daemon hasn't fully exited when
the new one starts.

## What it tests

1. `systemctl start` — service starts and restores processes from snapshot
2. `systemctl restart` — stop + start in sequence, processes come back
3. `systemctl stop` + `systemctl start` — same as restart but explicit
4. `systemctl reload` — triggers `orkify daemon-reload`, processes survive
5. Rapid restart x3 — repeated restarts to catch intermittent races

## Usage

From the repo root:

```bash
# Build the image
docker build -t orkify-systemd-test -f tests/systemd/Dockerfile .

# Start container with systemd as PID 1 (needs --privileged for systemd)
docker run -d --privileged --name orkify-systemd-test orkify-systemd-test

# Wait for systemd to boot, then run the test
sleep 2
docker exec orkify-systemd-test /usr/local/bin/repro.sh

# Clean up
docker rm -f orkify-systemd-test
```

## When to run

After changes to kill, shutdown, PID lock, IPC lifecycle, or the systemd
service unit. This is a manual smoke test — the automated equivalent
(without systemd) is `tests/integration/kill-wait.test.ts`.
