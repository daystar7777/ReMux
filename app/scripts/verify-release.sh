#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== REMUX release verification =="

echo "== frontend typecheck =="
npx tsc --noEmit

echo "== frontend tests =="
npx vitest run

echo "== rust tests =="
(cd src-tauri && cargo test)

echo "== tauri app bundle =="
npx tauri build --bundles app


APP_BUNDLE="src-tauri/target/release/bundle/macos/REMUX.app"

echo "== codesign verify =="
codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

echo "== bundle identifier =="
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP_BUNDLE/Contents/Info.plist"

echo "== local tmux smoke =="
SOCKET="/private/tmp/remux-release-smoke"
SESSION="remux_release_smoke"
tmux -S "$SOCKET" kill-server >/dev/null 2>&1 || true
tmux -S "$SOCKET" new-session -d -s "$SESSION" -n main sleep 300
trap 'tmux -S "$SOCKET" kill-server >/dev/null 2>&1 || true' EXIT

FORMAT='#{pane_id}	#{window_id}	#{session_id}	#{session_name}	#{window_index}	#{window_name}	#{pane_index}	#{pane_title}	#{pane_pid}	#{pane_current_command}	#{pane_current_path}'
initial="$(tmux -S "$SOCKET" list-panes -a -F "$FORMAT")"
if [[ "$initial" != *"$SESSION"* ]]; then
  echo "tmux smoke failed: initial pane list did not include $SESSION" >&2
  exit 1
fi

pane_id="$(printf '%s\n' "$initial" | awk -F '\t' 'NR == 1 {print $1}')"
window_id="$(printf '%s\n' "$initial" | awk -F '\t' 'NR == 1 {print $2}')"

tmux -S "$SOCKET" split-window -h -t "$pane_id"
pane_count="$(tmux -S "$SOCKET" list-panes -a -F "$FORMAT" | wc -l | tr -d ' ')"
if [[ "$pane_count" != "2" ]]; then
  echo "tmux smoke failed: expected 2 panes after split, got $pane_count" >&2
  exit 1
fi

tmux -S "$SOCKET" select-layout -t "$window_id" tiled
layout_name="$(tmux -S "$SOCKET" display-message -p -t "$window_id" '#{window_layout}')"
if [[ -z "$layout_name" ]]; then
  echo "tmux smoke failed: select-layout did not leave a readable window_layout" >&2
  exit 1
fi

tmux -S "$SOCKET" rename-window -t "$window_id" renamed
if ! tmux -S "$SOCKET" list-panes -a -F "$FORMAT" | grep -q $'\trenamed\t'; then
  echo "tmux smoke failed: rename-window did not appear in pane list" >&2
  exit 1
fi

tmux -S "$SOCKET" select-pane -t "$pane_id" -T worker
if ! tmux -S "$SOCKET" list-panes -a -F "$FORMAT" | grep -q $'\tworker\t'; then
  echo "tmux smoke failed: pane title did not appear in pane list" >&2
  exit 1
fi

tmux -S "$SOCKET" set-option -t "$SESSION" mouse on
mouse_state="$(tmux -S "$SOCKET" show-options -v -t "$SESSION" mouse)"
if [[ "$mouse_state" != "on" ]]; then
  echo "tmux smoke failed: expected mouse on, got $mouse_state" >&2
  exit 1
fi

tmux -S "$SOCKET" set-option -t "$SESSION" mouse off
mouse_state="$(tmux -S "$SOCKET" show-options -v -t "$SESSION" mouse)"
if [[ "$mouse_state" != "off" ]]; then
  echo "tmux smoke failed: expected mouse off, got $mouse_state" >&2
  exit 1
fi

second_pane="$(tmux -S "$SOCKET" list-panes -a -F '#{pane_id}' | sed -n '2p')"
tmux -S "$SOCKET" kill-pane -t "$second_pane"
pane_count="$(tmux -S "$SOCKET" list-panes -a -F "$FORMAT" | wc -l | tr -d ' ')"
if [[ "$pane_count" != "1" ]]; then
  echo "tmux smoke failed: expected 1 pane after kill, got $pane_count" >&2
  exit 1
fi

echo "== optional remote ssh/tmux smoke =="
if [[ -z "${REMUX_REMOTE_SMOKE_HOST:-}" ]]; then
  echo "skipped: set REMUX_REMOTE_SMOKE_HOST to run remote key/agent/alias tmux smoke"
else
  REMOTE_TARGET="$REMUX_REMOTE_SMOKE_HOST"
  if [[ -n "${REMUX_REMOTE_SMOKE_USER:-}" ]]; then
    REMOTE_TARGET="${REMUX_REMOTE_SMOKE_USER}@${REMOTE_TARGET}"
  fi

  REMOTE_SESSION="${REMUX_REMOTE_SMOKE_SESSION:-remux_remote_smoke}"
  REMOTE_TMUX="${REMUX_REMOTE_SMOKE_TMUX:-tmux}"
  SSH_ARGS=(-o BatchMode=yes -o ConnectTimeout=8)
  if [[ -n "${REMUX_REMOTE_SMOKE_PORT:-}" ]]; then
    SSH_ARGS+=(-p "$REMUX_REMOTE_SMOKE_PORT")
  fi
  if [[ -n "${REMUX_REMOTE_SMOKE_KEY:-}" ]]; then
    SSH_ARGS+=(-i "$REMUX_REMOTE_SMOKE_KEY")
  fi
  if [[ -n "${REMUX_REMOTE_SMOKE_PROXY_JUMP:-}" ]]; then
    SSH_ARGS+=(-J "$REMUX_REMOTE_SMOKE_PROXY_JUMP")
  fi
  if [[ -n "${REMUX_REMOTE_SMOKE_IDENTITY_AGENT:-}" ]]; then
    SSH_ARGS+=(-o "IdentityAgent=$REMUX_REMOTE_SMOKE_IDENTITY_AGENT")
  fi

  remote_tmux() {
    ssh "${SSH_ARGS[@]}" "$REMOTE_TARGET" "$REMOTE_TMUX" "$@"
  }

  remote_cleanup() {
    remote_tmux kill-session -t "$REMOTE_SESSION" >/dev/null 2>&1 || true
  }

  remote_cleanup
  remote_tmux new-session -d -s "$REMOTE_SESSION" -n main sleep 300
  trap 'remote_cleanup; tmux -S "$SOCKET" kill-server >/dev/null 2>&1 || true' EXIT

  remote_initial="$(remote_tmux list-panes -t "$REMOTE_SESSION" -F '#{pane_id}')"
  remote_pane_id="$(printf '%s\n' "$remote_initial" | sed -n '1p')"
  if [[ -z "$remote_pane_id" ]]; then
    echo "remote tmux smoke failed: no initial pane id" >&2
    exit 1
  fi

  remote_tmux split-window -h -t "$remote_pane_id"
  remote_pane_count="$(remote_tmux list-panes -t "$REMOTE_SESSION" -F '#{pane_id}' | wc -l | tr -d ' ')"
  if [[ "$remote_pane_count" != "2" ]]; then
    echo "remote tmux smoke failed: expected 2 panes after split, got $remote_pane_count" >&2
    exit 1
  fi

  remote_tmux select-layout -t "$REMOTE_SESSION:0" tiled
  remote_layout_name="$(remote_tmux display-message -p -t "$REMOTE_SESSION:0" '#{window_layout}')"
  if [[ -z "$remote_layout_name" ]]; then
    echo "remote tmux smoke failed: select-layout did not leave a readable window_layout" >&2
    exit 1
  fi

  remote_tmux rename-window -t "$REMOTE_SESSION:0" renamed
  if ! remote_tmux list-windows -t "$REMOTE_SESSION" -F '#{window_name}' | grep -qx 'renamed'; then
    echo "remote tmux smoke failed: rename-window did not appear" >&2
    exit 1
  fi

  remote_tmux select-pane -t "$remote_pane_id" -T worker
  if ! remote_tmux list-panes -t "$REMOTE_SESSION" -F '#{pane_title}' | grep -qx 'worker'; then
    echo "remote tmux smoke failed: pane title did not appear" >&2
    exit 1
  fi

  remote_tmux set-option -t "$REMOTE_SESSION" mouse on
  remote_mouse_state="$(remote_tmux show-options -v -t "$REMOTE_SESSION" mouse)"
  if [[ "$remote_mouse_state" != "on" ]]; then
    echo "remote tmux smoke failed: expected mouse on, got $remote_mouse_state" >&2
    exit 1
  fi

  remote_tmux set-option -t "$REMOTE_SESSION" mouse off
  remote_mouse_state="$(remote_tmux show-options -v -t "$REMOTE_SESSION" mouse)"
  if [[ "$remote_mouse_state" != "off" ]]; then
    echo "remote tmux smoke failed: expected mouse off, got $remote_mouse_state" >&2
    exit 1
  fi

  remote_second_pane="$(remote_tmux list-panes -t "$REMOTE_SESSION" -F '#{pane_id}' | sed -n '2p')"
  remote_tmux kill-pane -t "$remote_second_pane"
  remote_pane_count="$(remote_tmux list-panes -t "$REMOTE_SESSION" -F '#{pane_id}' | wc -l | tr -d ' ')"
  if [[ "$remote_pane_count" != "1" ]]; then
    echo "remote tmux smoke failed: expected 1 pane after kill, got $remote_pane_count" >&2
    exit 1
  fi

  remote_cleanup
  echo "remote ssh/tmux smoke passed for $REMOTE_TARGET"
fi

echo "== release verification passed =="
