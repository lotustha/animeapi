#!/usr/bin/env bash
# Stub harness for scripts/deploy/handover.sh — runs the real script under
# `set -euo pipefail` with fake pm2/bun/setsid/curl on PATH, in a throwaway
# shallow clone of this repo (no commits, nothing touched here).
#
# Why (review of 2026-09-26): the script had only been through `bash -n`,
# so its first execution would have been a production deploy. This covers
# the three exits that happen BEFORE pm2 is touched, which are the ones
# that must never restart pm2:
#   1. tracked file modified      -> exit 1, pm2 never called
#   2. bridge crashes while booting -> exit 1, pm2 never called
#   3. bridge never answers /health -> exit 1, pm2 never called, bridge killed
# The hand-over itself (reusePort overlap, ps parent chains, pm2 pids) needs
# Linux with real pm2 and is NOT covered here.
#
# Run: bash scripts/tests/handover.stub.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"

git clone -q --depth 1 "file://$REPO" "$T/repo"
mkdir -p "$T/repo/scripts/deploy"
cp "$REPO/scripts/deploy/handover.sh" "$T/repo/scripts/deploy/handover.sh"  # the working copy under test

cat >"$T/bin/pm2" <<EOF
#!/usr/bin/env bash
echo "\$*" >>"$T/pm2.calls"
[ "\${1:-}" = pid ] && echo 4242
exit 0
EOF
cat >"$T/bin/setsid" <<'EOF'
#!/usr/bin/env bash
exec "$@"
EOF
cat >"$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
exit 7
EOF
# bun: behaviour chosen per case through BUN_STUB (crash | hang)
cat >"$T/bin/bun" <<EOF
#!/usr/bin/env bash
[ "\${1:-}" = install ] && exit 0
case "\${BUN_STUB:-crash}" in
  crash) echo "error: EADDRINUSE" ; exit 1 ;;
  hang)  echo \$\$ >"$T/bridge.pid"; exec sleep 300 ;;
esac
EOF
chmod +x "$T/bin/"*

fails=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }

run() {
  : >"$T/pm2.calls"
  set +e
  (cd "$T/repo" && PATH="$T/bin:$PATH" BRIDGE_LOG="$T/bridge.log" BRIDGE_BOOT_WAIT="${WAIT:-30}" \
    BUN_STUB="${BUN_STUB:-crash}" bash scripts/deploy/handover.sh) >"$T/out" 2>&1
  RC=$?
  set -e
}

# 1. dirty tracked tree
echo "// hand edit" >>"$T/repo/package.json"
run
check "dirty tree: exit 1" '[ "$RC" = 1 ]'
check "dirty tree: says why" 'grep -q "tracked files are modified" "$T/out"'
check "dirty tree: pm2 never called" '[ ! -s "$T/pm2.calls" ]'
git -C "$T/repo" show HEAD:package.json >"$T/repo/package.json"

# 2. bridge crashes while booting
BUN_STUB=crash run
check "bridge crash: exit 1" '[ "$RC" = 1 ]'
check "bridge crash: says why" 'grep -q "bridge exited while booting" "$T/out"'
check "bridge crash: pm2 not restarted" '! grep -qE "^(restart|delete|start)" "$T/pm2.calls"'

# 3. bridge boots but never answers /health
BUN_STUB=hang WAIT=2 run
check "bridge silent: exit 1" '[ "$RC" = 1 ]'
check "bridge silent: says why" 'grep -q "did not answer" "$T/out"'
check "bridge silent: pm2 not restarted" '! grep -qE "^(restart|delete|start)" "$T/pm2.calls"'
sleep 1
check "bridge silent: leftover bridge stopped" '! kill -0 "$(cat "$T/bridge.pid" 2>/dev/null || echo 999999)" 2>/dev/null'

if [ "$fails" -ne 0 ]; then
  echo "---- last handover output ----"; cat "$T/out"
  exit 1
fi
echo "handover stub harness: all checks passed"
