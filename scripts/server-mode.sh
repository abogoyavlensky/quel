# Helpers for driving the app in Wails' server mode over HTTP, sourced by
# scripts/smoke.sh and scripts/e2e.sh. Needs curl and python3.
#
#   source scripts/server-mode.sh
#   start_app          # sets $base, $log; stops the app on exit
#   call ping '[]'     # a handler's reply body

SERVER_MODE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LGX="${LGX:-lgx}"
bridge="github.com/abogoyavlensky/letgo-packages/wails/shim.Bridge.Call"

free_port() {
    python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'
}

fail() { echo "${FAIL_PREFIX:-server-mode}: FAIL: $1" >&2; [[ -n "${log:-}" ]] && tail -20 "$log" >&2; exit 1; }

# start_app: run the app under `lgx run` in server mode on a free port and
# wait until it serves / and has written .nrepl-port. Sets $base (its URL),
# $log, $app_pid and $data_dir. The app keeps its database in $data_dir, a
# fresh temp dir, and profile passwords in memory (QUEL_SECRETS=memory): a
# run never touches the real profiles or Keychain. Update checks are off
# (QUEL_UPDATES=off) unless the caller sets QUEL_UPDATES and, for a stub
# GitHub, QUEL_UPDATES_URL (e2e does). The app runs in its own process group (`set -m`;
# setsid is not on macOS), and an EXIT trap stops lgx and the lg it starts
# together; callers with their own cleanup call stop_app from it.
start_app() {
    local port
    port="$(free_port)"
    base="http://localhost:$port"
    log="$(mktemp)"
    data_dir="$(mktemp -d)"
    cd "$SERVER_MODE_ROOT"
    rm -f .nrepl-port
    # Both vars are needed (a few Wails packages gate on `linux && cgo`
    # without a `!server` guard).
    set -m
    CGO_ENABLED=0 GOFLAGS=-tags=server WAILS_SERVER_PORT="$port" LGX_RUN=1 \
        QUEL_SECRETS=memory QUEL_DATA_DIR="$data_dir" \
        QUEL_UPDATES="${QUEL_UPDATES:-off}" QUEL_UPDATES_URL="${QUEL_UPDATES_URL:-}" \
        "$LGX" run >"$log" 2>&1 &
    app_pid=$!
    set +m
    trap stop_app EXIT
    # The first run builds the runtime, which takes minutes.
    for _ in $(seq 1 300); do
        curl -fs -o /dev/null "$base/" && [[ -s .nrepl-port ]] && break
        kill -0 "$app_pid" 2>/dev/null || fail "the app exited"
        sleep 2
    done
    curl -fs -o /dev/null "$base/" || fail "the app never answered on $base"
}

stop_app() {
    if [[ -n "${app_pid:-}" ]]; then kill -- -"$app_pid" 2>/dev/null || true; fi
    rm -f "$SERVER_MODE_ROOT/.nrepl-port" "${log:-}"
    if [[ -n "${data_dir:-}" ]]; then rm -rf "$data_dir"; fi
}

# call NAME JSON-ARGS: the handler's reply body, success or not (a thrown
# handler answers with its message).
call() {
    local id="call-$RANDOM"
    curl -s -X POST "$base/wails/runtime" \
        -H 'Content-Type: application/json' -H 'x-wails-client-id: server-mode' \
        -d "{\"object\":0,\"method\":0,\"args\":{\"call-id\":\"$id\",\"methodName\":\"$bridge\",\"args\":[\"$1\",$2]}}"
}

# json BODY EXPR: a Python expression on the parsed body, e.g. "['conn-id']".
json() { python3 -c "import json,sys; print(json.loads(sys.argv[1])$2)" "$1"; }
