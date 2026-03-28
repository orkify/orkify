#!/usr/bin/env bash
#
# Systemd restart race condition test.
# Run inside the Docker container after systemd boots:
#   docker exec <container> /usr/local/bin/repro.sh
#
set -euo pipefail

PASS=0
FAIL=0
TESTS=0

pass() { PASS=$((PASS + 1)); TESTS=$((TESTS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); TESTS=$((TESTS + 1)); echo "  FAIL: $1"; }

echo "=== Systemd Restart Race Condition Test ==="
echo ""

# --- Setup: start processes and save snapshot as orkify user ---
echo "1. Setting up: starting processes and saving snapshot..."
su - orkify -c 'orkify up /home/orkify/app.js -n app-a'
su - orkify -c 'orkify up /home/orkify/app.js -n app-b'
su - orkify -c 'orkify up /home/orkify/app.js -n app-c'
sleep 2
su - orkify -c 'orkify snap'
su - orkify -c 'orkify kill'
# Wait for daemon to exit before enabling the service
sleep 2

echo ""
echo "2. Enabling orkify@orkify service..."
systemctl enable orkify@orkify --now
sleep 3

# Verify service is running
if systemctl is-active --quiet orkify@orkify; then
  pass "service started"
else
  fail "service did not start"
  journalctl -u orkify@orkify --no-pager -n 20
fi

su - orkify -c 'orkify list'
echo ""

# --- Test: systemctl restart ---
echo "3. Testing: systemctl restart orkify@orkify"
if systemctl restart orkify@orkify; then
  sleep 2
  if su - orkify -c 'orkify list' | grep -q 'online'; then
    pass "systemctl restart — processes online"
  else
    fail "systemctl restart — no processes online"
    su - orkify -c 'orkify list' || true
  fi
else
  fail "systemctl restart — command failed"
fi
echo ""

# --- Test: systemctl stop + start ---
echo "4. Testing: systemctl stop + start"
systemctl stop orkify@orkify
sleep 1

# Daemon should be dead
if su - orkify -c 'test -f /home/orkify/.orkify/daemon.pid' 2>/dev/null; then
  fail "systemctl stop — PID file still exists"
else
  pass "systemctl stop — PID file cleaned up"
fi

systemctl start orkify@orkify
sleep 3

if su - orkify -c 'orkify list' | grep -q 'online'; then
  pass "systemctl start — processes restored"
else
  fail "systemctl start — no processes online"
  su - orkify -c 'orkify list' || true
fi
echo ""

# --- Test: systemctl reload (daemon-reload) ---
echo "5. Testing: systemctl reload orkify@orkify"
if systemctl reload orkify@orkify; then
  sleep 3
  if su - orkify -c 'orkify list' | grep -q 'online'; then
    pass "systemctl reload — processes online"
  else
    fail "systemctl reload — no processes online"
    su - orkify -c 'orkify list' || true
  fi
else
  fail "systemctl reload — command failed"
fi
echo ""

# --- Test: rapid restart (the original race) ---
echo "6. Testing: rapid restart x3"
for i in 1 2 3; do
  if systemctl restart orkify@orkify; then
    sleep 2
    if su - orkify -c 'orkify list' | grep -q 'online'; then
      pass "rapid restart $i — processes online"
    else
      fail "rapid restart $i — no processes online"
      su - orkify -c 'orkify list' || true
    fi
  else
    fail "rapid restart $i — command failed"
  fi
done

echo ""
echo "=== Results: $PASS passed, $FAIL failed out of $TESTS ==="

# Clean up
systemctl stop orkify@orkify 2>/dev/null || true

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Service logs:"
  journalctl -u orkify@orkify --no-pager -n 30
  exit 1
fi
