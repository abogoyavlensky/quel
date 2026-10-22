#!/usr/bin/env bash
# The dev loop with hot module replacement: Vite's dev server, and the app
# loading its page through it (FRONTEND_DEVSERVER_URL). Edits to the
# frontend apply in place, keeping React state; backend code is redefined
# over the nREPL as usual.
#
#   lgx dev        # or: bash scripts/dev.sh
#
# On Linux without the webview headers, run it in server mode and open
# http://localhost:8080 (WAILS_SERVER_PORT moves it):
#
#   CGO_ENABLED=0 GOFLAGS=-tags=server lgx dev
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
LGX="${LGX:-lgx}"
VITE_URL="http://localhost:5173"
cd "$HERE"

[[ -d frontend/node_modules ]] || "$LGX" fe-install

# Vite and the app each run in their own process group (`set -m`; setsid
# is not on macOS), so the trap stops each with everything it started,
# however this script ends: Ctrl+C, a kill, or the app exiting.
app_pid=""
set -m
npm --prefix frontend run dev &
vite_pid=$!
set +m
cleanup() {
    if [[ -n "$app_pid" ]]; then kill -- -"$app_pid" 2>/dev/null || true; fi
    kill -- -"$vite_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Wails waits only 5 s for the dev server, so start the app once it answers.
for _ in $(seq 1 60); do
    curl -fs -o /dev/null "$VITE_URL/" && break
    kill -0 "$vite_pid" 2>/dev/null || { echo "dev: Vite exited" >&2; exit 1; }
    sleep 0.5
done
curl -fs -o /dev/null "$VITE_URL/" || { echo "dev: Vite never answered on $VITE_URL" >&2; exit 1; }

set -m
FRONTEND_DEVSERVER_URL="$VITE_URL" "$LGX" run &
app_pid=$!
set +m
wait "$app_pid"
