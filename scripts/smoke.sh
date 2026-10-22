#!/usr/bin/env bash
# Smoke-test the app headless, in Wails' server mode: the frontend is
# served, the handlers answer over the real bridge, a runaway query is
# cancelled (on Postgres too, when QUEL_PG_URL is set), and redefining a
# handler over the in-app nREPL changes the running app with no restart.
#
#   lgx smoke       # or: bash scripts/smoke.sh
#   lgx smoke-pg    # the same, with a throwaway Postgres in Docker
#
# Needs the Go toolchain, Node (to build the frontend if it is missing),
# curl and python3. LGX picks the lgx binary (default: lgx on PATH);
# NREPL_CLIENT the tiny nREPL client from the letgo-packages nrepl
# package's tests (default: a letgo-packages checkout beside this repo).
# Without it, only the nREPL step is skipped.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
LGX="${LGX:-lgx}"
NREPL_CLIENT="${NREPL_CLIENT:-$HERE/../letgo-packages/nrepl/test/nrepl/client.py}"

port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
tmp="$(mktemp -d)"
db="$tmp/smoke.db"
log="$tmp/app.log"
base="http://localhost:$port"
bridge="github.com/abogoyavlensky/letgo-packages/wails/shim.Bridge.Call"
runaway="WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1000000000) SELECT count(*) FROM c"

cd "$HERE"
[[ -f resources/public/index.html ]] || "$LGX" fe-build

rm -f .nrepl-port
# Server mode: no window, an HTTP server instead. Both vars are needed (a
# few Wails packages gate on `linux && cgo` without a `!server` guard).
# `set -m` runs the background job in its own process group (setsid is not
# on macOS), so cleanup can stop lgx and the lg it starts together.
set -m
CGO_ENABLED=0 GOFLAGS=-tags=server WAILS_SERVER_PORT="$port" LGX_RUN=1 \
    "$LGX" run >"$log" 2>&1 &
pid=$!
set +m
cleanup() {
    kill -- -"$pid" 2>/dev/null || true
    rm -rf "$tmp" .nrepl-port
}
trap cleanup EXIT

fail() { echo "smoke: FAIL: $1" >&2; tail -20 "$log" >&2; exit 1; }

# The first run builds the runtime, which takes minutes.
for _ in $(seq 1 300); do
    curl -fs -o /dev/null "$base/" && [[ -s .nrepl-port ]] && break
    kill -0 "$pid" 2>/dev/null || fail "the app exited"
    sleep 2
done
curl -fs -o /dev/null "$base/" || fail "the app never answered on $base"

# call NAME JSON-ARGS: the handler's reply body, success or not (a thrown
# handler answers with its message).
call() {
    local id="smoke-$RANDOM"
    curl -s -X POST "$base/wails/runtime" \
        -H 'Content-Type: application/json' -H 'x-wails-client-id: smoke' \
        -d "{\"object\":0,\"method\":0,\"args\":{\"call-id\":\"$id\",\"methodName\":\"$bridge\",\"args\":[\"$1\",$2]}}"
}

json() { python3 -c "import json,sys; print(json.loads(sys.argv[1])$2)" "$1"; }

[[ "$(curl -fs -o /dev/null -w '%{http_code}' "$base/")" == 200 ]] || fail "/ is not served"
[[ "$(call ping '[]')" == *'"ok":true'* ]] || fail "ping does not answer"

opened="$(call open-db "[\"$db\"]")"
conn="$(json "$opened" "['conn-id']")" || fail "open-db: $opened"

dup="$(call run "[\"$conn\",\"q-dup\",\"select 1 as id, 2 as id\"]")"
[[ "$dup" == *'"rows":[[1,2]]'* ]] || fail "duplicate columns: $dup"
[[ "$(json "$dup" "['columns']")" == *"'name': 'id'"*"'name': 'id'"* ]] || fail "column names: $dup"

# Cancel a runaway query from a second call while the first is in flight.
call run "[\"$conn\",\"q-runaway\",\"$runaway\"]" >"$tmp/runaway" &
runaway_pid=$!
canceled=""
for _ in $(seq 1 50); do
    sleep 0.1
    canceled="$(call cancel '["q-runaway"]')"
    [[ "$canceled" == *'"canceled":true'* ]] && break
done
[[ "$canceled" == *'"canceled":true'* ]] || fail "cancel did not find the query: $canceled"
for _ in $(seq 1 100); do
    kill -0 "$runaway_pid" 2>/dev/null || break
    sleep 0.1
done
kill -0 "$runaway_pid" 2>/dev/null && fail "the cancelled query did not return within 10 s"
[[ "$(cat "$tmp/runaway")" == *'Query canceled.'* ]] || fail "runaway reply: $(cat "$tmp/runaway")"

call close-db "[\"$conn\"]" >/dev/null

# Postgres, when one is configured (lgx smoke-pg, or CI): open the URL,
# run, cancel, and run again on the same session.
if [[ -n "${QUEL_PG_URL:-}" ]]; then
    pg_opened="$(call open-db "[\"$QUEL_PG_URL\"]")"
    pg="$(json "$pg_opened" "['conn-id']")" || fail "open-db (postgres): $pg_opened"
    [[ "$pg_opened" == *'"engine":"postgres"'* ]] || fail "engine: $pg_opened"
    [[ "$pg_opened" != *"$QUEL_PG_URL"* ]] || fail "the label shows the password: $pg_opened"
    call run "[\"$pg\",\"pg-temp\",\"create temp table kept (x int)\"]" >/dev/null
    call run "[\"$pg\",\"pg-sleep\",\"select pg_sleep(30)\"]" >"$tmp/pg-sleep" &
    pg_pid=$!
    pg_canceled=""
    for _ in $(seq 1 50); do
        sleep 0.1
        pg_canceled="$(call cancel '["pg-sleep"]')"
        [[ "$pg_canceled" == *'"canceled":true'* ]] && break
    done
    [[ "$pg_canceled" == *'"canceled":true'* ]] || fail "postgres cancel did not find the query: $pg_canceled"
    wait "$pg_pid" || true
    [[ "$(cat "$tmp/pg-sleep")" == *'Query canceled.'* ]] || fail "postgres cancel reply: $(cat "$tmp/pg-sleep")"
    after="$(call run "[\"$pg\",\"pg-after\",\"select count(*) from kept\"]")"
    [[ "$after" == *'"rows":[[0]]'* ]] || fail "the postgres session did not survive the cancel: $after"
    call close-db "[\"$pg\"]" >/dev/null
else
    echo "smoke: postgres step skipped (QUEL_PG_URL is unset; lgx smoke-pg sets it)"
fi

# Redefine a handler in the running app. It is registered by var, so the
# next call runs the new definition. (alter-var-root is fine here: this is
# the test driving the app, not app code.)
if [[ -f "$NREPL_CLIENT" ]]; then
    python3 "$NREPL_CLIENT" "$(cat .nrepl-port)" \
        "(alter-var-root #'quel.api/ping (constantly (fn [_env] {:ok :redefined})))" \
        >/dev/null || fail "the nREPL eval failed"
    [[ "$(call ping '[]')" == *'"ok":"redefined"'* ]] || fail "the redefinition did not take effect"
else
    echo "smoke: nREPL step skipped (no client at $NREPL_CLIENT; set NREPL_CLIENT)"
fi

echo "smoke: ok"
