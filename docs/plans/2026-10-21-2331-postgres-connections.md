# Postgres Connections Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Milestone 1's first slice: Quel opens Postgres (and Redshift) URLs and runs and cancels queries on them with the session surviving the cancel, tested against Postgres in Docker and SQLite on every run.

**Tech Stack:** let-go 1.13.0 / lgx 0.5.0, letgo-packages `postgres` (pgx v5.10.0 through `database/sql`), Docker (`postgres:17-alpine`), GitHub Actions.

---

## Design

### Why Docker cannot test Redshift

No Docker image runs Redshift. LocalStack's Redshift needs a paid plan and
emulates the AWS API (38 of 145 operations), not the SQL engine; its Data
API lacks `CancelStatement`. Redshift speaks the Postgres wire protocol, so
a Postgres container exercises everything Quel does over pgx (connect,
query, sessions, cancel, value types) on every test run, in CI too. The
three open Redshift questions in `docs/DESIGN.md` ("Unverified": pgx
protocol quirks, whether Redshift honours a cancel request, the
`svv_*` / `SHOW TABLE` catalog for non-superusers) only a real cluster
answers, and this slice does not test against one: Postgres in Docker and
SQLite are the test targets. Redshift URLs are still recognised (the
engine matters to `quel.meta` later), and those three questions stay open
in DESIGN.

### Findings from exploration (checked 2026-10-21 against Postgres 17 in Docker)

A probe script opened `postgres-v0.3.0` against a container and found:

- **Cancel kills the session.** pgx v5's default context handler
  (`DeadlineContextWatcherHandler`) answers a cancelled context by expiring
  the socket deadline; the connection is then closed asynchronously
  (`asyncClose` sends a protocol cancel request, then `Terminate`). The
  server-side query does stop (`pg_stat_activity` showed it gone within
  2 s, for both `pg_sleep` and a CPU-bound `generate_series` count), but
  the `*sql.Conn` returns `driver: bad connection` from then on. Quel's
  sessions promise psql behaviour (temp tables, `SET`, an open
  transaction survive), and psql keeps the session after Ctrl+C. pgx has
  the right mode, `CancelRequestContextWatcherHandler`, but it is a Go
  function in `pgconn.Config`, which let-go cannot set and the DSN cannot
  express. So it goes upstream: the `postgres` package gains an in-tree
  shim that opens a pool with that handler.
- **Value types through `sql.shim/ScanRow`:** int2/4/8 come back as let-go
  ints, float8 as a float, bool as a boolean, and numeric, text, uuid,
  json/jsonb, interval, time and arrays as strings (`"1.50"`, `"{1,2}"`,
  `"1 day"`). `ColumnTypeNames` gives `INT4 INT8 NUMERIC TEXT DATE
  TIMESTAMPTZ TIMESTAMP BYTEA JSONB UUID INTERVAL _INT4 BOOL FLOAT8 TIME`.
  Two need work:
  - `date`, `timestamp` and `timestamptz` arrive as Go `time.Time` values
    (type `go.time.Time`), whose `str` is
    `<go.time.Time 2026-10-21 00:00:00 +0000 UTC>`. `(.Format t layout)`
    works on them.
  - `bytea` arrives as a let-go string that has lost its bytes (the shim
    turns `[]byte` into a string; `\xdeadbeef` became 3 characters, two of
    them U+FFFD). There is nothing left to preview.

### Upstream: letgo-packages `postgres` v0.4.0

- New in-tree shim `postgres/shim` (module
  `github.com/abogoyavlensky/letgo-packages/postgres/shim`, coord
  `{:go/local "shim"}`, the model `sql`, `wails`, `nrepl` and `livekit`
  use), registering namespace `postgres.shim` with one function:

  ```go
  // Open returns a pool for dsn whose connections answer a cancelled
  // context with a protocol cancel request and stay usable, instead of
  // being closed. A connection the server does not answer within
  // deadlineDelay is closed after all.
  func Open(dsn string, cancelRequest bool) (*sql.DB, error)
  ```

  It parses with `pgx.ParseConfig`, and when `cancelRequest` is true sets
  `BuildContextWatcherHandler` to
  `&pgconn.CancelRequestContextWatcherHandler{Conn: c, CancelRequestDelay: 0, DeadlineDelay: 10 * time.Second}`.
  It also sets `ConnectTimeout` to 10 s when the DSN gives none (pgx's
  default dialer has no timeout, so an unreachable host would hang a ping
  for minutes). Then `stdlib.OpenDB(*cfg)`.
- `postgres.core/open` takes `:postgres/cancel` in its opts: `:close` (the
  default, today's behaviour, so existing users see no change) or
  `:request`. The key is removed before the opts become `:sql/opts`.
  Either way `open` now goes through `shim/Open` (the connect-timeout
  default applies to both); `:close` passes `cancelRequest` false.
- The package's first tests, `postgres/test/postgres/core_test.lg`, gated
  on `POSTGRES_TEST_URL` (unset: each test returns without assertions and
  the file prints one skip line). They cover: open and query; column type
  names; cancel with `:request` (the error, the server-side query gone
  from `pg_stat_activity`, the same `*sql.Conn` still answering
  `select 1`, a temp table created before the cancel still there); cancel
  with the default `:close` (the session reports `bad connection`); the
  connect timeout. A closed port fails instantly whatever the timeout, so
  the timeout test needs an endpoint that accepts and then stalls: the
  test starts one with `python3` in the background (listen on port 0,
  write the port to a temp file, accept, sleep 60), and checks that `Ping`
  fails within 4 s with `connect_timeout=1` in the DSN, and within 15 s
  with no `connect_timeout` (the 10 s default).
- CI (`.github/workflows/test.yml`): a `postgres:17-alpine` service
  container with a health check, and `POSTGRES_TEST_URL` set job-wide.
- Docs: `postgres/README.md` gains "Cancellation" (the two modes and why
  `:request` suits interactive clients); the root README's shim lists
  (Releasing, In-tree shims, the workflow comment) add `postgres`.
- Release: `postgres-v0.4.0`, still on `sql-v0.3.0` (nothing else changes,
  so the round is one package and the same-sql-tag rule holds).

### Quel

**Opening a database.** `open-db` keeps taking one string, so the spike
screen's input works for both:

- a string starting with `postgres://` or `postgresql://` is a Postgres
  URL; `redshift://` is rewritten to `postgres://`; either becomes engine
  `:redshift` when the host ends in `.redshift.amazonaws.com` or
  `.redshift-serverless.amazonaws.com` (or the scheme was `redshift://`),
  else `:postgres`;
- anything else is a SQLite file path, as today.

`quel.conn/target` does this parsing and returns
`{:engine :sqlite :path p}` or `{:engine :postgres|:redshift :url u}`.
`open!` opens Postgres and Redshift with `{:postgres/cancel :request}`,
then pings (`(.Ping handle)` returns nil or an error value, checked on
the probe; a wrong password's `(.Error err)` names the auth failure); a failed ping
closes the pool and throws the driver's message, so a wrong password shows
at Open, not at the first Run. The registry entry gains `:engine` and
`:label` (the path, or the URL with the password replaced by `***`), and
`open!` returns `{:conn-id :engine :label}`. `:path` goes away from the
reply; the frontend shows `label`. Passwords in URLs are a spike
convenience: profiles and the Keychain come later in milestone 1.

**Broken sessions.** A session whose connection died (a dropped network,
a server restart, a cancel that hit the 10 s deadline fallback) never
recovers, and the first error does not reliably say so: pgx can return a
server `FATAL` or an `unexpected EOF`, and only later calls report `driver:
bad connection` or `sql: connection is already closed`. So `quel.exec/run!`
does not classify the failed run's error. After any failed run, cancelled
or not, it probes the session with `select 1` under a context it cancels
after 5 s. The probe turns whatever happened into a known signature: if
the probe's error contains `bad connection`, `connection is already
closed`, or the probe was cancelled, the session is dead, and `run!`
drops it (`conn/reset-session!`) so the next run takes a fresh connection.
The error message then gains " The session was reset." ("Query canceled.
The session was reset." for a cancel). Any other probe error means the
connection is alive: an aborted transaction answers `select 1` with
SQLSTATE 25P02, and that session must be kept, because the user still has
to `ROLLBACK`. A successful run never probes.

**Statement routing.** `quel.exec/rows?` also routes `fetch` and `call` to
the rows path (Postgres `FETCH` and `CALL` with OUT parameters return
rows; a `CALL` without them returns zero columns, which the rows path
handles). Dollar-quoted bodies (`$$...$$`) are not tokenized: Go's regexp
has no backreferences, so a tagged `$fn$...$fn$` cannot be matched, and a
`RETURNING` inside a function body would send its `CREATE` down the rows
path. That is harmless on pgx (a query that returns no rows reads as an
empty result) and noted, not fixed.

**Cells.** `quel.cells/encode-row` takes the column type names alongside
the row, and `encode` takes the type:

| Type name | Value | Cell |
|---|---|---|
| `DATE` | `time.Time` | `"2026-10-21"` (layout `2006-01-02`) |
| `TIMESTAMP` | `time.Time` | `"2026-10-21T10:00:00"` (`2006-01-02T15:04:05.999999`) |
| `TIMESTAMPTZ` | `time.Time` | `"2026-10-21T08:00:00Z"` (`2006-01-02T15:04:05.999999Z07:00`) |
| `BYTEA` | anything but nil | `"(binary)"` |

Precedence: nil stays nil; then `BYTEA`; then a string passes through
(SQLite stores dates as text, and bytea arrives as a string too, which is
why `BYTEA` comes before it); then the table's `time.Time` cases. Any other
non-plain value keeps the `str` fallback. A `time.Time` is recognised by
its type name, `(= "go.time.Time" (str (type v)))` (checked on the probe). The bytea preview needs the sql shim to keep binary
values as bytes: backlogged as upstream work, not done here.

**Frontend.** The path input's placeholder and label become "File path or
postgres:// URL"; the "Open:" line shows `label` and the engine. No other
change.

### Testing

- **Postgres in Docker.** `scripts/with-postgres.sh CMD...` starts
  `postgres:17-alpine` on a free loopback port (`-p 127.0.0.1::5432`),
  waits for `pg_isready`, runs `CMD` with
  `QUEL_PG_URL=postgres://postgres:quel@127.0.0.1:PORT/postgres`, and
  removes the container on exit. lgx task `test-pg` runs
  `bash scripts/with-postgres.sh lgx test`. `test/quel/pg_test.lg` is
  gated on `QUEL_PG_URL`; `lgx test` without it skips that file's checks.
  CI runs `lgx test-pg` in place of `lgx test` (the runner has Docker).

### Not in this slice

Testing against a real Redshift cluster, profiles, the Keychain, per-tab sessions, the structure tree, `quel.meta`,
paging beyond the first page, and the bytea preview.

## File Structure

letgo-packages (branch `postgres-cancel-request`):

| File | Change |
|---|---|
| `postgres/shim/go.mod`, `postgres/shim/shim.go` | new: `Open` and the `postgres.shim` namespace |
| `postgres/lgx.edn` | the shim coord, `:lg-runtime :built`, `:lg-version`, test context unchanged |
| `postgres/src/postgres/core.lg` | `open` through the shim, `:postgres/cancel` |
| `postgres/test/postgres/core_test.lg` | new: gated tests |
| `postgres/README.md`, `README.md` | Cancellation section; shim lists |
| `.github/workflows/test.yml` | postgres service, `POSTGRES_TEST_URL` |

Quel (branch `postgres-connections`):

| File | Change |
|---|---|
| `lgx.edn` | `postgres-v0.4.0` dep; task `test-pg` |
| `src/quel/conn.lg` | `target`, engines, ping, `:label`, `reset-session!` |
| `src/quel/exec.lg` | `fetch`/`call` in `rows?`; reset a bad session; types to cells |
| `src/quel/cells.lg` | type-aware `encode` |
| `src/quel/api.lg` | `open-db` docstring/return shape only |
| `frontend/src/App.tsx`, `frontend/src/lib/types.ts` | label and engine |
| `scripts/with-postgres.sh` | new |
| `test/quel/{conn,exec,cells}_test.lg` | target parsing, routing, cells |
| `test/quel/pg_test.lg` | new, gated on `QUEL_PG_URL` |
| `.github/workflows/ci.yml` | trigger on `master`; `lgx test-pg` |
| `docs/DESIGN.md`, `README.md`, `AGENTS.md` | cancel mode, testing, commands |
| `docs/backlog/bytea-preview.md` | new |

## Tasks

### Task 1: The postgres shim

**Files:**
- Create: `../letgo-packages/postgres/shim/go.mod`, `../letgo-packages/postgres/shim/shim.go`
- Modify: `../letgo-packages/postgres/lgx.edn`

- [x] **Step 1:** In letgo-packages, `git checkout master && git pull && git checkout -b postgres-cancel-request`.
- [x] **Step 2:** Write `postgres/shim/go.mod` modelled on `sql/shim/go.mod` (module path above, `require github.com/nooga/let-go v0.0.0`, plus `github.com/jackc/pgx/v5 v5.10.0`). Write `shim.go`: a package comment saying why the shim exists (the context handler is a Go func in `pgconn.Config`), `Open` as specified in the design, and an `init` registering `postgres.shim` with `Open`, following `sql/shim/shim.go`'s registration. Run `go mod tidy` in `postgres/shim` if lgx needs the sums (check how `sql/shim` handles `go.sum`; mirror it).
- [x] **Step 3:** In `postgres/lgx.edn`, add `github.com/abogoyavlensky/letgo-packages/postgres/shim {:go/local "shim"}` with a comment in the `sql` package's style, plus `:lg-runtime :built` and `:lg-version "1.13.0"` (needed for its own `lgx test`, as sqlite got in sql-v0.3.0). Keep the stdlib dep (the shim imports it, but the coord documents the driver).
- [x] **Step 4:** Smoke: a scratch `.lg` under `postgres/test/` is not needed yet; run `cd postgres && lgx test` and expect "no tests" (or 0 tests) with a successful runtime build.

### Task 2: `postgres.core/open` with `:postgres/cancel`

**Files:**
- Modify: `../letgo-packages/postgres/src/postgres/core.lg`
- Create: `../letgo-packages/postgres/test/postgres/core_test.lg`

- [x] **Step 1: Write the tests** (gated on `POSTGRES_TEST_URL`, as in the design). Model the file on `sqlite/test/sqlite/core_test.lg` (futures, `deref` with a timeout, `thrown-message`). Use `select pg_sleep(30)` as the runaway. `pg_stat_activity.query` keeps a session's last statement after it ends, so a count by query text would still find a surviving session: read the session's `pg_backend_pid()` before the run, and after the cancel poll (every 100 ms, up to 5 s) from the pool until that pid's `state` is no longer `'active'`.
- [x] **Step 2: Run them to see them fail.** Start Postgres: `docker run --rm -d --name lgp-pg -e POSTGRES_PASSWORD=pg -p 127.0.0.1::5432 postgres:17-alpine`, read the port with `docker port lgp-pg 5432`, then `cd postgres && POSTGRES_TEST_URL=postgres://postgres:pg@127.0.0.1:PORT/postgres lgx test`. Expected: the `:request` tests fail (session reports bad connection).
- [x] **Step 3: Implement.** `open` calls `shim/Open` with `(= :request (:postgres/cancel opts))`; throw `ex-info` on an error value; reject any value other than `:close`, `:request` or nil. Update the docstring.
- [x] **Step 4: Run tests.** Expected: all pass. Also run without `POSTGRES_TEST_URL`: passes, prints the skip line.
- [x] **Step 5: Commit** `"postgres: open with a cancel request that keeps the connection"`.

### Task 3: CI and docs, PR, release

**Files:**
- Modify: `../letgo-packages/.github/workflows/test.yml`, `../letgo-packages/postgres/README.md`, `../letgo-packages/README.md`

- [x] **Step 1:** Add the service to the `test` job (`postgres:17-alpine`, `POSTGRES_PASSWORD`, port `5432:5432`, `--health-cmd pg_isready` with interval/timeout/retries) and `POSTGRES_TEST_URL` in the job's `env`. Mention `postgres` in the in-tree shim comment. Run `actionlint` (`mise exec -- actionlint` if the shim needs it).
- [x] **Step 2:** README changes from the design. Coords in `postgres/README.md` move to `postgres-v0.4.0`.
- [x] **Step 3:** Commit `"postgres: test against a service container in CI"` and `"postgres: document cancellation"` (two commits).
- [x] **Step 4:** Codex review of the branch: `codex exec -C ../letgo-packages review --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --base master -o .tmp/codex-review-pg.md`, in the background. Fold real findings, re-run tests.
- [x] **Step 5:** Push, open the PR, link it with `link_pull_request`, wait for CI green (`gh pr checks --watch`), merge.
- [x] **Step 6:** Tag `postgres-v0.4.0` on the merge commit of master and push the tag. Never move a pushed tag. Verify from a throwaway lgx project (as in the exploration probe at `/tmp/pgprobe`) that the coord resolves and `postgres.shim/Open` is callable.

> Deviation: Task 1 had no commit of its own; it landed with Task 2's commit (57f81a9).
> Deviation: codex (3 rounds) refined the connect-timeout default: it applies only when no source sets `connect_timeout` (a nonzero parsed value is kept; an explicit 0, in the DSN or `PGCONNECT_TIMEOUT`, still means none; the DSN is read with libpq quoting and ASCII whitespace, as pgx does). An explicit 0 in a service file is the one case it cannot see. Added tests: explicit zero, and a keyword DSN whose quoted password mentions `connect_timeout`. Merged as letgo-packages #11; `postgres-v0.4.0` tagged on 8752396 and verified from a throwaway project.

### Task 4: Postgres in Docker for Quel's tests

**Files:**
- Create: `scripts/with-postgres.sh`
- Modify: `lgx.edn`, `.github/workflows/ci.yml`

- [x] **Step 1:** In Quel, `git checkout master && git pull && git checkout -b postgres-connections`.
- [x] **Step 2:** Write `scripts/with-postgres.sh` as in the design. Unique container name (`quel-pg-$$`), `trap` cleanup, wait up to 30 s for `docker exec ... pg_isready -U postgres`, then `exec`-free run of `"$@"` so the trap fires. Passes `shellcheck`.
- [x] **Step 3:** `lgx.edn`: dep `abogoyavlensky/letgo-postgres` at `postgres-v0.4.0` (`:deps/root "postgres"`), comment in the existing style; task `test-pg` (`bash scripts/with-postgres.sh lgx test`).
- [x] **Step 4:** `ci.yml`: trigger `push: branches: [master]` (the default branch moved); replace "Backend tests" with `lgx test-pg`. `actionlint`.
- [x] **Step 5:** Verify: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test-pg` passes (no pg tests yet) and leaves no container (`docker ps -a --filter name=quel-pg`).
- [x] **Step 6: Commit** `"Run the tests with Postgres in Docker"`.

> Deviation: `with-postgres.sh` waits for a real `select 1` over TCP inside the container rather than `pg_isready`, which can answer during the image's init restart.

### Task 5: Opening Postgres and Redshift

**Files:**
- Modify: `src/quel/conn.lg`, `src/quel/api.lg`
- Test: `test/quel/conn_test.lg`, `test/quel/pg_test.lg`

- [ ] **Step 1: Tests.** `conn_test`: `target` for a path, `postgres://`, `postgresql://`, `redshift://` (rewritten, engine redshift), a provisioned and a serverless Redshift host, and the label masking a password (`postgres://u:secret@h/db` → `postgres://u:***@h/db`; no password → unchanged). `pg_test` (gated on `QUEL_PG_URL`): `open!` returns `{:conn-id :engine :postgres :label}`; a wrong password throws at open with the server's message and leaves no registry entry; `close!` closes.
- [ ] **Step 2:** Run `lgx test-pg` to see them fail.
- [ ] **Step 3: Implement** `target`, the engine branch in `open!` (ping, close on failure), `:label`, and `reset-session!` (dissoc the session and close it, ignoring the close error). `close-entry!` closes by engine. Update the namespace comment.
- [ ] **Step 4:** Run `lgx test-pg`: all pass. Update existing tests that read `:path` from the reply.
- [ ] **Step 5: Commit** `"Open Postgres and Redshift URLs"`.

### Task 6: Running and cancelling on Postgres

**Files:**
- Modify: `src/quel/exec.lg`
- Test: `test/quel/exec_test.lg`, `test/quel/pg_test.lg`

- [ ] **Step 1: Tests.** `exec_test`: `rows?` for `fetch all from c`, `call p()`, and the existing cases unchanged. `pg_test`: `run!` of a `select` returns columns with pg types; an `insert` returns its update count; `insert ... returning` returns rows; cancel of `select pg_sleep(30)` throws "Query canceled." within 5 s, and afterwards a temp table created before the cancel still answers on the same conn-id (the session survived); a session killed server-side (`select pg_terminate_backend(pid)` from the pool, with the pid read from the session first) makes the next run fail with a message ending "The session was reset.", and the run after that succeeds; inside `begin`, a failing statement leaves the session in place (the next `select 1` reports the aborted transaction, not a reset), and `rollback` recovers it. A cancel that destroys the connection cannot be forced from Postgres (it always answers the cancel request), so that path is covered by the terminate test, which reaches the same probe.
- [ ] **Step 2:** `lgx test-pg` to see them fail.
- [ ] **Step 3: Implement** `fetch`/`call` in `rows?`, and the probe-and-reset in `run!`'s error path as in the design (a `future` that sleeps 5 s and cancels the probe's `Ctx`, skipped once the probe returns).
- [ ] **Step 4:** `lgx test-pg`: all pass.
- [ ] **Step 5: Commit** `"Run and cancel on Postgres, resetting a broken session"`.

### Task 7: Type-aware cells

**Files:**
- Modify: `src/quel/cells.lg`, `src/quel/exec.lg`
- Test: `test/quel/cells_test.lg`, `test/quel/pg_test.lg`

- [ ] **Step 1: Tests.** `cells_test`: strings in `DATE`/`TIMESTAMP` columns pass through; `BYTEA` becomes `"(binary)"`; untyped (nil type) values behave as before. `pg_test`: a row of `date`, `timestamp`, `timestamptz` (`timestamptz '2026-10-21 10:00:00+02'`), `bytea`, `numeric`, `int8` beyond 2^53 comes back as the cells in the design's table.
- [ ] **Step 2:** Run, see them fail. Implement `encode [type v]` and `encode-row [types row]`; `exec/read-page` passes the type names it already reads. Run `lgx test-pg`: all pass.
- [ ] **Step 3: Commit** `"Encode dates, timestamps and binary values by column type"`.

### Task 8: Frontend and smoke

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/lib/types.ts`, `scripts/smoke.sh` (only if it reads `:path`)

- [ ] **Step 1:** `OpenResult` becomes `{"conn-id", engine, label}`; the input's placeholder and aria-label and the "Open:" line as in the design.
- [ ] **Step 2:** `npm --prefix frontend test`, `npm --prefix frontend run lint`, `lgx fe-build`, and `CGO_ENABLED=0 GOFLAGS=-tags=server lgx smoke` all pass.
- [ ] **Step 3:** By hand in server mode with a Postgres container (`scripts/with-postgres.sh` with a command that prints `$QUEL_PG_URL` and sleeps, or a manual container): open the URL in the page through headless Chromium or curl on the bridge, run a query, cancel `select pg_sleep(30)`, run again. Expected: rows, "Query canceled.", then rows.
- [ ] **Step 4: Commit** `"Open a Postgres URL from the spike screen"`.

### Task 9: Docs and backlog

**Files:**
- Modify: `docs/DESIGN.md`, `README.md`, `AGENTS.md`
- Create: `docs/backlog/bytea-preview.md`

- [ ] **Step 1:** DESIGN: "Running" says Quel opens pgx with the cancel-request handler (from `postgres-v0.4.0`) so a cancelled session survives, and why the default would not do; a broken session is reset. Testing replaces the "Redshift ... against a real cluster, gated on an environment variable" line: Postgres runs in Docker (`lgx test-pg`), no Docker image runs Redshift (LocalStack included), and Redshift-specific checks wait for a cluster. The three Redshift items stay in "Unverified". Upstream table: a done row for `postgres` v0.4.0; the bytea row. Cell encoding: dates and timestamps as implemented. Milestone 1: this slice done (date), and its "Starts with the Redshift checks" sentence now says those checks wait for a cluster.
- [ ] **Step 2:** README and AGENTS command tables: `lgx test-pg`, Docker as a requirement for `test-pg`.
- [ ] **Step 3: Commit** `"Document Postgres testing"`.
- [ ] **Step 4:** /backlog: `bytea-preview.md` (the sql shim's `ScanRow` turns `[]byte` into a string, losing binary values; Quel shows `(binary)`; fix upstream by keeping binary columns as bytes). Own commit, `"Backlog: preview binary values"`.

### Task 10: Review, PR

- [ ] **Step 1:** Codex review of the branch against master in the background (as in Task 3). Fold real findings; re-run `lgx test-pg`, frontend tests, smoke.
- [ ] **Step 2:** Push the branch, open a PR against `master`, link it, wait for CI green. Do not merge without the user.
