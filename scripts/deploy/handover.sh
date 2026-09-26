#!/usr/bin/env bash
#
# Zero-downtime restart of mugen-api. Run ON THE VPS, from anywhere, after the
# new code is pulled (.github/workflows/deploy.yml does exactly that).
#
# Why: a bare `pm2 restart` killed Bun with requests in flight and left :3001
# unbound until the new process booted — 50–191 nginx "connect() failed (111)"
# per deploy, and discover/stream-check jobs dying with "fetch failed"
# (measured 2026-09-26).
#
# How: Elysia's Bun adapter binds with SO_REUSEPORT, so a second Bun process
# can listen on :3001 beside pm2's. We start a short-lived "bridge" on the new
# code, wait until it is provably answering, and only then let pm2 restart.
# The old process closes its listener and drains (src/index.ts) while the
# kernel sends every new connection to the bridge; once pm2's new process is
# answering too, the bridge drains and exits the same way. :3001 always has at
# least one listener.
#
#   a. refuse on modified tracked files (untracked cache/, .well-known/ are fine)
#   b. bun install --frozen-lockfile, only if bun.lock moved in this pull
#   c. start the bridge (new session, own log, hard 900s lifetime)
#   d. poll /health until the BRIDGE answers — else kill it, pm2 untouched
#   e. pm2 restart (old process drains behind the bridge)
#   f. poll /health until pm2's NEW process answers
#   g. SIGTERM the bridge, wait for its drain, print a summary
#
# /health answers {ok, pid, bootedAt, commit}. Connections are spread across
# listeners by a hash of the client's source port, so each curl (a fresh
# connection) can land on either process — the polls repeat until the pid
# they are waiting for shows up.
#
# ADOPT=1 (once, by hand) swaps step e for pm2 delete + start from
# ecosystem.config.cjs + pm2 save — see that file.
#
# Assumes BASE_PATH is unset on this box (routes unprefixed) and PORT 3001,
# matching ecosystem.config.cjs.

set -euo pipefail

APP=mugen-api
API_PORT=3001                      # deliberately NOT exported; see step e
HEALTH_URL="http://127.0.0.1:${API_PORT}/health"
BRIDGE_LOG="${BRIDGE_LOG:-/root/mugen-bridge.log}"   # overridable for scripts/tests/handover.stub.sh
BRIDGE_LIFETIME=900                # seconds; SIGTERM (graceful) after this
BRIDGE_BOOT_WAIT="${BRIDGE_BOOT_WAIT:-30}"
PM2_BOOT_WAIT=150                  # pm2's old process may drain up to 125s first
BRIDGE_DRAIN_WAIT=130

BUN=/root/.bun/bin/bun
[ -x "$BUN" ] || BUN="$(command -v bun)" || { echo "bun not found" >&2; exit 1; }

cd "$(dirname "$0")/../.."
REPO_DIR="$(pwd)"
STARTED=$SECONDS

log() { printf '[handover +%3ss] %s\n' "$((SECONDS - STARTED))" "$*"; }
die() { log "FAILED: $*"; exit 1; }

# The pid named by one /health answer, or "" when nothing (or an old build
# without /health) answered.
health_pid() {
  curl -s --max-time 2 "$HEALTH_URL" 2>/dev/null | grep -o '"pid":[0-9]*' | cut -d: -f2 || true
}

# True when $1 is $2 or a descendant of it. Neither pm2 (script = the bun
# binary) nor the bridge should put anything between the recorded pid and the
# Bun process that serves, but `timeout` does fork one child — so compare by
# ancestry rather than bet on pids being identical.
descends_from() {
  local pid=$1 ancestor=$2 i
  [ -n "$pid" ] && [ -n "$ancestor" ] && [ "$ancestor" != 0 ] || return 1
  for i in 1 2 3 4 5; do
    [ "$pid" = "$ancestor" ] && return 0
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [ -n "$pid" ] && [ "$pid" != 0 ] && [ "$pid" != 1 ] || return 1
  done
  return 1
}

pm2_pid() { pm2 pid "$APP" 2>/dev/null | tail -n 1 | tr -d ' \r' || true; }

# ── cleanup ───────────────────────────────────────────────────────────────
# Any failure BEFORE pm2 restarts leaves the old process serving, so the
# bridge is surplus and is stopped (gracefully — SIGTERM drains it). From
# step e until step f sees pm2's new process answer, the bridge may be the
# ONLY thing serving, so it is left up (KEEP_BRIDGE=1); `timeout` retires it
# within BRIDGE_LIFETIME regardless.
WRAP_PID=""       # the `timeout` wrapper we launched
BRIDGE_PID=""     # the Bun process under it, learned from /health
KEEP_BRIDGE=0
cleanup() {
  local rc=$?
  if [ -n "$WRAP_PID" ] && kill -0 "$WRAP_PID" 2>/dev/null; then
    if [ "$KEEP_BRIDGE" = 1 ]; then
      log "bridge left running (wrapper pid $WRAP_PID) so :$API_PORT stays served; it exits by itself within ${BRIDGE_LIFETIME}s of starting"
    else
      log "stopping leftover bridge (wrapper pid $WRAP_PID)"
      kill -TERM "${BRIDGE_PID:-$WRAP_PID}" 2>/dev/null || true
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# ── a. tracked tree must be clean ─────────────────────────────────────────
# The old workflow `git stash`ed hand edits away silently. Now they stop the
# deploy instead, so a hot-fix typed on the box is never lost or half-shipped.
# --ignore-submodules=dirty: the `Cooren` gitlink has no .gitmodules and the
# server never imports from it; its contents must not block a deploy.
if ! git diff --quiet --ignore-submodules=dirty || ! git diff --cached --quiet --ignore-submodules=dirty; then
  git status --short --untracked-files=no --ignore-submodules=dirty
  die "tracked files are modified in $REPO_DIR. Push the change through git, or discard it with 'git checkout -- <file>'. Nothing was restarted."
fi
log "commit $(git rev-parse --short HEAD), tree clean"

# ── b. dependencies ───────────────────────────────────────────────────────
# HEAD@{1} is where HEAD was before the pull. On a no-op pull it is the
# previous reflog move, which at worst re-runs an idempotent frozen install.
# The old process keeps what it already loaded; only its lazy imports see the
# new node_modules, for the minute until it is replaced.
if git rev-parse -q --verify 'HEAD@{1}' >/dev/null && ! git diff --quiet 'HEAD@{1}' HEAD -- bun.lock; then
  log "bun.lock changed — bun install --frozen-lockfile"
  "$BUN" install --frozen-lockfile
else
  log "bun.lock unchanged — skipping install"
fi

# ── c. bridge ─────────────────────────────────────────────────────────────
# setsid: its own session, so an ssh drop (SIGHUP to our group) cannot take
# it down mid-handover. timeout: a hard ceiling if this script dies before
# step g — SIGTERM, the same graceful drain step g uses (pm2 itself sends
# SIGINT, which the app drains on too; see ecosystem.config.cjs).
# All three fds are redirected: appleboy/ssh-action waits for every fd tied
# to the session to close, and a bridge holding stdout would hang the job.
# PORT is set inline, not exported — `pm2 restart --update-env` below would
# otherwise copy it into pm2's saved env. Bun loads .env from the cwd itself.
OLD_PM2_PID="$(pm2_pid)"
printf '\n==== bridge %s commit %s ====\n' "$(date -Is)" "$(git rev-parse --short HEAD)" >>"$BRIDGE_LOG"
PORT="$API_PORT" setsid timeout "$BRIDGE_LIFETIME" "$BUN" run src/index.ts </dev/null >>"$BRIDGE_LOG" 2>&1 &
WRAP_PID=$!
log "bridge started (wrapper pid $WRAP_PID), pm2 $APP is pid ${OLD_PM2_PID:-?}"

# ── d. wait for the bridge to answer ──────────────────────────────────────
deadline=$((SECONDS + BRIDGE_BOOT_WAIT))
while :; do
  if ! kill -0 "$WRAP_PID" 2>/dev/null; then
    tail -n 30 "$BRIDGE_LOG" >&2 || true
    die "bridge exited while booting (log above; is :$API_PORT held by a process without SO_REUSEPORT?). pm2 not restarted."
  fi
  p="$(health_pid)"
  if descends_from "$p" "$WRAP_PID"; then
    BRIDGE_PID=$p
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    tail -n 30 "$BRIDGE_LOG" >&2 || true
    die "bridge did not answer $HEALTH_URL within ${BRIDGE_BOOT_WAIT}s. pm2 not restarted."
  fi
  sleep 0.3
done
log "bridge pid $BRIDGE_PID is serving"

# ── e. restart pm2 behind the bridge ──────────────────────────────────────
# Blocks while the old process drains (up to 125s, kill_timeout 130s).
# From here until pm2's new process is seen answering, the bridge may be the
# only listener — any exit (error, ssh drop) must leave it running.
KEEP_BRIDGE=1
if [ "${ADOPT:-0}" = 1 ]; then
  # One-time switch from the hand-started app to ecosystem.config.cjs (see
  # that file). `restart` would keep the old definition, so delete + start;
  # the bridge covers the gap exactly as it covers a restart.
  log "ADOPT=1: pm2 delete $APP && pm2 start ecosystem.config.cjs && pm2 save"
  pm2 delete "$APP" >/dev/null || true
  pm2 start "$REPO_DIR/ecosystem.config.cjs" >/dev/null || die "pm2 start ecosystem.config.cjs failed. Check 'pm2 logs $APP'."
  pm2 save >/dev/null || log "warning: pm2 save failed — run it by hand so a reboot resurrects the new definition"
else
  log "pm2 restart $APP"
  pm2 restart "$APP" --update-env >/dev/null || die "pm2 restart $APP failed. Check 'pm2 logs $APP'."
fi

# ── f. wait for pm2's new process ─────────────────────────────────────────
deadline=$((SECONDS + PM2_BOOT_WAIT))
NEW_PM2_PID=""
while :; do
  cur="$(pm2_pid)"
  if [ -n "$cur" ] && [ "$cur" != 0 ] && [ "$cur" != "$OLD_PM2_PID" ]; then
    p="$(health_pid)"
    if descends_from "$p" "$cur"; then
      NEW_PM2_PID=$p
      break
    fi
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    pm2 describe "$APP" 2>/dev/null | grep -E 'status|restarts|uptime' >&2 || true
    die "pm2's new $APP (pid ${cur:-none}) did not answer within ${PM2_BOOT_WAIT}s. Check 'pm2 logs $APP'."
  fi
  sleep 0.5
done
log "pm2 $APP pid $NEW_PM2_PID is serving"
KEEP_BRIDGE=0

# ── g. retire the bridge ──────────────────────────────────────────────────
# SIGTERM, not SIGINT: chrome-launcher's SIGINT listener exited mid-drain
# once a stream/CF request had launched Chrome (review, 2026-09-26; see
# src/core/lib/browser.ts).
kill -TERM "$BRIDGE_PID" 2>/dev/null || true
deadline=$((SECONDS + BRIDGE_DRAIN_WAIT))
while kill -0 "$WRAP_PID" 2>/dev/null; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    log "bridge still draining after ${BRIDGE_DRAIN_WAIT}s — sending SIGKILL"
    kill -KILL "$BRIDGE_PID" 2>/dev/null || true
    break
  fi
  sleep 0.5
done
wait "$WRAP_PID" 2>/dev/null || true
WRAP_PID=""

log "done: $APP pid $OLD_PM2_PID -> $NEW_PM2_PID, bridge $BRIDGE_PID retired, health: $(curl -s --max-time 2 "$HEALTH_URL" || echo unreachable)"
