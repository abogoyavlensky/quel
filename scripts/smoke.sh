#!/usr/bin/env bash
# Smoke-test the app headless, in Wails' server mode: the frontend is
# served, the handlers answer over the real bridge, profiles save and
# connect, a runaway query is
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
NREPL_CLIENT="${NREPL_CLIENT:-$HERE/../letgo-packages/nrepl/test/nrepl/client.py}"
FAIL_PREFIX=smoke
# shellcheck source=scripts/server-mode.sh
source "$HERE/scripts/server-mode.sh"

tmp="$(mktemp -d)"
db="$tmp/smoke.db"
runaway="WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1000000000) SELECT count(*) FROM c"

cd "$HERE"
[[ -f resources/public/index.html ]] || "$LGX" fe-build

start_app
cleanup() {
    stop_app
    rm -rf "$tmp"
}
trap cleanup EXIT

[[ "$(curl -fs -o /dev/null -w '%{http_code}' "$base/")" == 200 ]] || fail "/ is not served"
[[ "$(call ping '[]')" == *'"ok":true'* ]] || fail "ping does not answer"

opened="$(call open-db "[\"$db\"]")"
conn="$(json "$opened" "['conn-id']")" || fail "open-db: $opened"

dup="$(call run "[\"$conn\",\"s1\",\"q-dup\",\"select 1 as id, 2 as id\"]")"
[[ "$dup" == *'"rows":[[1,2]]'* ]] || fail "duplicate columns: $dup"
[[ "$(json "$dup" "['columns']")" == *"'name': 'id'"*"'name': 'id'"* ]] || fail "column names: $dup"

# Cancel a runaway query from a second call while the first is in flight.
call run "[\"$conn\",\"s1\",\"q-runaway\",\"$runaway\"]" >"$tmp/runaway" &
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

# Paging: a 1,200-row result comes back as 500, 500 and 200 rows, the
# cursor held open between calls.
call run "[\"$conn\",\"s1\",\"q-mk\",\"create table t (id integer)\"]" >/dev/null
call run "[\"$conn\",\"s1\",\"q-fill\",\"insert into t (id) with recursive c(x) as (select 1 union all select x + 1 from c where x < 1200) select x from c\"]" >/dev/null
first="$(call run "[\"$conn\",\"s1\",\"q-big\",\"select id from t order by id\"]")"
[[ "$first" == *'"has-more":true'* ]] || fail "the first page: ${first:0:200}"
p2="$(call fetch-page '["q-big"]')"
[[ "$(json "$p2" "['rows'].__len__()")" == 500 && "$p2" == *'"has-more":true'* ]] || fail "page 2: ${p2:0:200}"
p3="$(call fetch-page '["q-big"]')"
[[ "$(json "$p3" "['rows'].__len__()")" == 200 && "$p3" == *'"has-more":false'* ]] || fail "page 3: ${p3:0:200}"
[[ "$(call fetch-page '["q-big"]')" == *'"closed":true'* ]] || fail "a finished result is closed"
# A nil reply comes back as {} (the bridge lowers nil that way).
nothing() { [[ -z "$1" || "$1" == null || "$1" == "{}" ]]; }
r="$(call close-result '["nope"]')"; nothing "$r" || fail "close-result of an unknown id: $r"
r="$(call close-session "[\"$conn\",\"s1\"]")"; nothing "$r" || fail "close-session: $r"

call close-db "[\"$conn\"]" >/dev/null

# A SQLite profile: save, list, connect, run.
saved="$(call save-profile "[{\"name\":\"Smoke file\",\"engine\":\"sqlite\",\"path\":\"$db\"}]")"
profile="$(json "$saved" "['id']")" || fail "save-profile: $saved"
[[ "$(call list-profiles '[]')" == *"\"$profile\""* ]] || fail "list-profiles misses $profile"
connected="$(call connect "[\"$profile\"]")"
pconn="$(json "$connected" "['conn-id']")" || fail "connect: $connected"
[[ "$connected" == *'"label":"Smoke file"'* ]] || fail "connect label: $connected"
[[ "$(call run "[\"$pconn\",\"s1\",\"q-p\",\"select 1\"]")" == *'"rows":[[1]]'* ]] || fail "run on a profile's connection"
call close-db "[\"$pconn\"]" >/dev/null

# Postgres, when one is configured (lgx smoke-pg, or CI): open the URL,
# run, cancel, and run again on the same session.
if [[ -n "${QUEL_PG_URL:-}" ]]; then
    pg_opened="$(call open-db "[\"$QUEL_PG_URL\"]")"
    pg="$(json "$pg_opened" "['conn-id']")" || fail "open-db (postgres): $pg_opened"
    [[ "$pg_opened" == *'"engine":"postgres"'* ]] || fail "engine: $pg_opened"
    [[ "$pg_opened" != *"$QUEL_PG_URL"* ]] || fail "the label shows the password: $pg_opened"
    call run "[\"$pg\",\"s1\",\"pg-temp\",\"create temp table kept (x int)\"]" >/dev/null
    call run "[\"$pg\",\"s1\",\"pg-sleep\",\"select pg_sleep(30)\"]" >"$tmp/pg-sleep" &
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
    after="$(call run "[\"$pg\",\"s1\",\"pg-after\",\"select count(*) from kept\"]")"
    [[ "$after" == *'"rows":[[0]]'* ]] || fail "the postgres session did not survive the cancel: $after"
    call close-db "[\"$pg\"]" >/dev/null

    # A Postgres profile, its password in the memory store: the reply says
    # one is saved and never carries it.
    pg_form="$(python3 -c '
import json, sys, urllib.parse as u
p = u.urlparse(sys.argv[1])
print(json.dumps({"name": "Smoke PG", "engine": "postgres", "host": p.hostname, "port": p.port,
                  "database": p.path.lstrip("/"), "user": u.unquote(p.username),
                  "password": u.unquote(p.password), "ssl-mode": "disable"}))' "$QUEL_PG_URL")"
    pg_password="$(python3 -c 'import sys, urllib.parse as u; print(u.unquote(u.urlparse(sys.argv[1]).password))' "$QUEL_PG_URL")"
    pg_saved="$(call save-profile "[$pg_form]")"
    pg_profile="$(json "$pg_saved" "['id']")" || fail "save-profile (postgres): $pg_saved"
    [[ "$pg_saved" == *'"has-password":true'* ]] || fail "has-password: $pg_saved"
    [[ "$pg_saved" != *"\"$pg_password\""* ]] || fail "save-profile returned the password"
    pg_connected="$(call connect "[\"$pg_profile\"]")"
    pgp="$(json "$pg_connected" "['conn-id']")" || fail "connect (postgres): $pg_connected"
    [[ "$(call run "[\"$pgp\",\"s1\",\"pg-p\",\"select 1\"]")" == *'"rows":[[1]]'* ]] || fail "run on the postgres profile"
    call close-db "[\"$pgp\"]" >/dev/null
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
