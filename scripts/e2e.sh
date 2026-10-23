#!/usr/bin/env bash
# End-to-end tests of the UI: Playwright drives the app in Wails' server
# mode, against SQLite files made here: table t with 2,000 rows, and a
# second file with table t2 (10 rows) for the workspaces spec.
#
#   lgx e2e        # or: bash scripts/e2e.sh [playwright args...]
#
# Needs the Go toolchain, Node, curl, python3, and Playwright's Chromium
# (npx --prefix frontend playwright install chromium).
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
FAIL_PREFIX=e2e
# shellcheck source=scripts/server-mode.sh
source "$HERE/scripts/server-mode.sh"

tmp="$(mktemp -d)"
db="$tmp/e2e.db"
db2="$tmp/e2e2.db"

cd "$HERE"
# Always: the tests must see the current frontend.
"$LGX" fe-build

python3 - "$db" "$db2" <<'PY'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
c.execute("create table t (id integer primary key, name text)")
c.executemany("insert into t values (?, ?)", [(i, f"customer {i}") for i in range(1, 2001)])
c.commit()
c = sqlite3.connect(sys.argv[2])
c.execute("create table t2 (id integer primary key, name text)")
c.executemany("insert into t2 values (?, ?)", [(i, f"item {i}") for i in range(1, 11)])
c.commit()
PY

start_app
cleanup() {
    stop_app
    rm -rf "$tmp"
}
trap cleanup EXIT

QUEL_E2E_URL="$base" QUEL_E2E_DB="$db" QUEL_E2E_DB2="$db2" npm --prefix frontend run e2e -- "$@"
