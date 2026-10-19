# Milestone 0: Project Setup and SQLite Spike Implementation Plan

> **Status: complete except Task 12** (the manual macOS pass), 2026-10-19.

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Quel repository on the let-go + Wails + Vite/React stack and prove the whole path end to end against SQLite: a page calls let-go handlers, runs a query on a dedicated session, shows the first page of rows, and cancels a runaway query. Land and release the `sql` context support it needs.

**Tech Stack:** let-go 1.13.0 via lgx 0.5.0, Go 1.27, Wails v3.0.0-beta.30 (letgo-packages `wails-v0.2.0`), letgo-packages `sql`/`sqlite` (modernc.org/sqlite), integrant, letgo-packages `nrepl`; Vite, TypeScript, React, Tailwind v4, shadcn/ui, `@wailsio/runtime` 3.0.0-beta.30, Vitest.

---

## Design

### What milestone 0 is

`docs/DESIGN.md` describes the app and its milestones. Milestone 0 is the
spike that proves the stack before feature work begins. This plan changes
one thing in it: **the spike runs against SQLite, not Redshift**, which keeps
it local and needs no cluster or Docker. The Redshift checks (pgx connects,
a cancel reaches the server, the catalog queries) move to the start of
milestone 1. Task 13 updates `docs/DESIGN.md` to match.

The spike is also the project setup. Everything it adds is the real
skeleton milestone 1 builds on, sized to what the spike exercises:

- the integrant system, the Wails app and window, the menu, and the dev
  loop (nREPL plus window reload), following `examples/wails-tasks` in the
  lgx repo (`/home/agent/Projects/lgx/examples/wails-tasks`);
- `quel.conn`, `quel.exec` and `quel.cells` in their real shape (a
  connection registry, a query registry keyed by a frontend `query-id`,
  cancellation, and the array-of-arrays cell encoding), minus what
  milestone 1 adds (profiles, `fetch-page`, cursor lifetime, result tabs);
- a Vite + React + TypeScript + Tailwind + shadcn frontend with one typed
  bridge helper and one spike screen.

Two parts of milestone 0 cannot run on the Linux box this plan is executed
on, which has no GTK4/WebKitGTK headers. Everything automated runs in
Wails' cgo-free **server mode** (`CGO_ENABLED=0 GOFLAGS=-tags=server`).
The native macOS window, menus, dialogs and the built binary are checked
by hand on a Mac in Task 12.

### Upstream: context support in `letgo-packages/sql`

Cancellation and per-tab sessions need `database/sql`'s context methods,
which let-go cannot reach today: building a `context.Context` and calling
a variadic method with a parameter vector both need Go. The shim
(`letgo-packages/sql/shim/shim.go`) gains:

```go
// Connectable is now the context-method shape. *sql.DB, *sql.Tx and
// *sql.Conn all satisfy it (*sql.Conn has only the ...Context methods).
type Connectable interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

type Ctx struct { /* ctx context.Context; cancel context.CancelFunc */ }
func NewCtx() *Ctx                // context.WithCancel(context.Background())
func (c *Ctx) Cancel()            // idempotent
func (c *Ctx) Canceled() bool     // ctx.Err() != nil

func Query(c Connectable, query string, args []any) (*sql.Rows, error)   // unchanged signature, now context.Background()
func Exec(c Connectable, query string, args []any) (sql.Result, error)   // same
func QueryCtx(c Connectable, ctx *Ctx, query string, args []any) (*sql.Rows, error)
func ExecCtx(c Connectable, ctx *Ctx, query string, args []any) (sql.Result, error)
func Conn(db *sql.DB) (*sql.Conn, error)                  // db.Conn(context.Background())
func ColumnTypeNames(rows *sql.Rows) ([]string, error)    // DatabaseTypeName per column
```

Changing `Connectable`'s methods is backward compatible for every caller,
because `*sql.DB` and `*sql.Tx` have both sets. A side effect worth
documenting: `sql.core/execute!` now accepts a `*sql.Conn` handle.
`with-transaction` does not (it calls `.Begin`, which `*sql.Conn` lacks);
the README says so. Quel opens transactions with `BEGIN` statements on the
session, so it does not need it.

`ColumnTypeNames` is a shim fn rather than reflective calls on
`*sql.ColumnType` from let-go: it is one line, it returns plain strings,
and it settles the "is `DatabaseTypeName` reachable" unverified item with
no guesswork.

Cancellation semantics, which the tests pin down: cancelling a `Ctx` while
`QueryCtx` is executing makes modernc call `sqlite3_interrupt`, and the
call fails promptly with `context canceled` (verified; the driver's own
"interrupted" text may surface instead, so callers check `.Canceled`
rather than the message). Cancelling after rows came back
makes `database/sql` close the rows; `.Next` returns false and `.Err`
reports the context error.

**The shim moves in-tree.** `sql` follows the model the root README asks
new work to use (livekit, wails, nrepl): `sql/lgx.edn` commits
`{:go/local "shim"}` and releases with the package tag alone. That drops
the Go-module-tag dance (`sql/shim/vX.Y.Z`, the `go get` check, the coord
flip) from this and every future `sql` release. The old
`sql/shim/v0.1.0` tag stays as history.

**Release round** (the root README's "When `sql/` changed"): PR 1 lands
the shim change and is merged; `sql-v0.3.0` is tagged on the merge
commit. PR 2 points `sqlite`, `postgres`, `duckdb` and `ragtime` at
`sql-v0.3.0`; once merged, each is tagged `<pkg>-v0.3.0`. Quel depends on
`sqlite-v0.3.0`. Pushed tags are permanent: never move or delete one, fix
forward.

### Quel backend

Namespaces (all under `src/quel/`):

| Namespace | Milestone 0 responsibility |
|---|---|
| `quel.app` | Entry point only: `-main` starts the system, blocks in `w/run!`, halts the system on return. The `:main` script. |
| `quel.system` | `config`, `system*` (defonce atom), `start!`, `stop!` - the wails-tasks `tasks.system` pattern, including the halted promise that makes `stop!` safe to call twice. |
| `quel.shell` | The `:quel.shell/app` and `:quel.shell/window` components. |
| `quel.menu` | The menu as data: app, File (Open Database… `CmdOrCtrl+O`, Run `CmdOrCtrl+Enter`, Quit), Edit, Window. Open shows a native file dialog and emits `menu:open-db` with `{"path": ...}`; Run emits `menu:run`. |
| `quel.dev` | `:quel.dev/loop`: nREPL and `w/watch-assets!` on `resources/public`, under `lgx run` only. |
| `quel.conn` | `:quel.conn/registry`: open SQLite databases keyed by `conn-id`, each with one lazily taken session (`*sql.Conn`). |
| `quel.exec` | `:quel.exec/registry`: running queries keyed by `query-id`; `run!` returns the first page; `cancel!`. |
| `quel.cells` | Pure: driver values to bridge-safe cells. |
| `quel.api` | `:quel.api/handlers`: the handlers, registered by var. |

**Deviation from DESIGN.md, deliberate:** the design puts the
`:quel.app/app` and `:quel.app/window` components in `quel.app`, which is
also the entry script. The entry script ends in
`(when-not *compiling-aot* (-main))`, so any namespace or test that
requires it would launch the app, and `quel.system` would need to require
it while it requires `quel.system`. The components therefore live in
`quel.shell`, and `quel.app` is required by nothing. Task 13 updates the
design's namespace table.

Integrant config (`quel.system/config`):

```clojure
{:quel.conn/registry {}
 :quel.exec/registry {:conns (ig/ref :quel.conn/registry)}
 :quel.api/handlers {:conns (ig/ref :quel.conn/registry)
                     :execs (ig/ref :quel.exec/registry)}
 :quel.shell/app {:name "Quel" :description "A database client"
                  :assets "public" :quit-on-last-window-closed true
                  :on-shutdown (fn [] (stop!))}
 :quel.shell/window {:app (ig/ref :quel.shell/app) :title "Quel"
                     :width 1200 :height 800 :min-width 720 :min-height 480}
 :quel.menu/menu {:app (ig/ref :quel.shell/app)}
 :quel.dev/loop {:window (ig/ref :quel.shell/window)}}
```

Halting runs in reverse dependency order: the dev loop, then the handlers
(nothing to halt), then `:quel.exec/registry` (cancels every running
query), then `:quel.conn/registry` (closes every session and database).
The exec registry's ref to the conn registry is what enforces that order:
without it the two are independent and integrant may close a session
first, and `*sql.Conn.Close` blocks until the running query ends - for the
runaway query, minutes. The halt cancels, then waits up to 5 s for the
registry to drain before returning.
Both registries are atoms holding plain maps; the registry value *is* the
atom.

`quel.conn`:

- `(open! registry path)` opens SQLite at `path` with `sqlite.core/open`
  and returns `{:conn-id <random-uuid string> :path path}`. A blank path
  is an error.
- `(session! registry conn-id)` returns the entry's `*sql.Conn`, taking it
  with `sql.shim/Conn` on first use and caching it in the entry. One
  session per open database in milestone 0 (milestone 1 makes it one per
  editor tab).
- `(close! registry conn-id)` closes the session (if taken), then the
  database, and removes the entry. Unknown ids are a no-op.
- Unknown `conn-id` in `session!` throws `"No open database <id>."`.

`quel.exec`:

- `(run! execs conns {:conn-id :query-id :sql :page-size})`; `page-size`
  defaults to 500.
- Refuses a `query-id` already in the registry, and a `conn-id` that
  already has a running query (`"A query is already running on this
  connection."`): one session cannot run two statements at once.
- Registers `{:ctx (shim/NewCtx) :conn-id ...}` under `query-id` before
  executing, so `cancel!` works before the first row arrives.
- Decides rows vs update count with `sql.core/returns-rows?`.
  - Rows: `shim/QueryCtx` on the session, `ColumnTypeNames` plus
    `.Columns` for the column list, read up to `page-size` rows with
    `shim/ScanRow`, each passed through `quel.cells/encode-row`, then one
    more `.Next` to learn `has-more`. Check `.Err` when `.Next` stops.
    Close the rows. Milestone 0 closes the cursor after the first page;
    `fetch-page` and cursor lifetime are milestone 1.
  - Update count: `shim/ExecCtx`, `.RowsAffected`.
- Always, in `finally`: cancel the ctx (releases it) and remove the
  `query-id` entry.
- An error after `(.Canceled ctx)` is true is rethrown as
  `"Query canceled."`; other errors keep the driver's message.
- `(cancel! execs query-id)` cancels and returns true, or false when the
  id is unknown (already finished).
- Halting the registry cancels every entry.

The `run` result, the shape the frontend codes against:

```json
{"columns": [{"name": "id", "type": "INTEGER"}, {"name": "id", "type": "INTEGER"}],
 "rows": [[1, 7], [2, null]],
 "has-more": false,
 "update-count": null,
 "elapsed-ms": 3}
```

For a statement without rows: `columns` and `rows` are empty, `has-more`
is false, `update-count` is the affected-row count. `elapsed-ms` is
measured with `System/nanoTime` around execution and reading. Keys are
keywords on the let-go side; the bridge lowers them to these strings.

`quel.cells/encode` for milestone 0 handles what SQLite produces:

- `nil`, booleans, floats and strings pass through;
- an integer outside `[-(2^53 - 1), 2^53 - 1]` becomes its decimal string,
  so JavaScript does not round it;
- anything else becomes `(str v)`, never an error.

Numeric strings, dates, hex previews and the 64 KB text cap arrive with
the engines that produce them (milestone 1 onward). modernc returns TEXT
and BLOB as `[]byte`, and the sql shim's boxing already surfaces both as
strings.

Handlers (`quel.api`), each a var taking the component map first:

| Handler | JS call | Returns |
|---|---|---|
| `ping` | `call("ping")` | `{"ok": true}` |
| `open-db` | `call("open-db", path)` | `{"conn-id": "...", "path": "..."}` |
| `close-db` | `call("close-db", connId)` | `null` |
| `run` | `call("run", connId, queryId, sql)` | the run result above |
| `cancel` | `call("cancel", queryId)` | `{"canceled": true\|false}` |

A thrown exception rejects the frontend's promise with its message.

### Quel frontend

`frontend/` is a Vite + React + TypeScript project. `vite build` writes
to `../resources/public` (`emptyOutDir: true`), which Wails serves through
the wails package's `:assets "public"`. `resources/public` is build
output and is gitignored.

**Dev loop decision:** in milestone 0 the frontend dev loop is
`vite build --watch` into `resources/public`, plus the backend's
`w/watch-assets!` reloading the window. DESIGN.md's "points the window at
the Vite dev server" does not work today: the wails package serves assets
through its own handler, which ignores Wails' `FRONTEND_DEVSERVER_URL`
proxy, and a page served from Vite's origin cannot reach the bridge. Real
HMR becomes an upstream wails-package change, recorded in the backlog
(Task 13). Build-and-reload costs a second per edit and needs no
upstream work.

- `src/lib/bridge.ts`: the one place that talks to Wails.

  ```ts
  export const BRIDGE = "github.com/abogoyavlensky/letgo-packages/wails/shim.Bridge.Call";
  export function call<T>(name: string, ...args: unknown[]): Promise<T>;  // Call.ByName(BRIDGE, name, args)
  export function onEvent(name: string, fn: (data: unknown) => void): () => void;  // Events.On
  ```

- `src/lib/types.ts`: `RunResult`, `Column`, `OpenResult` matching the
  shapes above.
- `@wailsio/runtime` is pinned to exactly `3.0.0-beta.30`, the version the
  wails package's shim pins, so the JS and Go halves speak the same
  protocol.
- Tailwind v4 through `@tailwindcss/vite`; shadcn initialised with the
  components the spike screen uses: `button`, `input`, `textarea`,
  `table`. TanStack, CodeMirror and React Flow arrive in milestone 1 when
  something uses them.
- The spike screen (`src/App.tsx`): a backend status line from `ping`; a
  database path input and Open/Close; an SQL textarea; Run and Cancel;
  a status line (running, elapsed ms, row count, `has-more`, update count
  or error); a plain shadcn table of the first page, `null` shown as a
  muted `NULL`. Run generates `query-id` with `crypto.randomUUID()`,
  Cancel calls `cancel` with it, and Run is disabled while a query runs.
  The `menu:run` event triggers Run; `menu:open-db` fills the path and
  opens it.
- Vitest covers `bridge.ts` (arguments forwarded to `Call.ByName` with the
  right bridge name), with `@wailsio/runtime` mocked.

### Testing

- `lgx test` (server mode on Linux) covers `quel.cells`, `quel.conn`,
  `quel.exec` (including cancel before the first row and the
  one-query-per-connection guard), `quel.api`, `quel.menu` (`check-menu`)
  and `quel.system` (config keys, refs).
- `npm test` in `frontend/` covers the bridge helper.
- `scripts/smoke.sh` runs the app in server mode and drives the real
  bridge over HTTP: the page is served, `ping`, `open-db` on a temp file,
  a `select 1 as id, 2 as id` that keeps both columns in order, a runaway
  query cancelled through `cancel`, and a handler redefined over the
  in-app nREPL.
- `.github/workflows/ci.yml` runs all three on Ubuntu.
- Task 12 is the manual macOS pass.

The runaway query used by tests and the smoke script (runs for minutes on
SQLite, so a cancel is the only way it ends in time):

```sql
WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 1000000000)
SELECT count(*) FROM c
```

### Tooling decisions

- **lgx 0.5.0, no `:go/build-tags`.** The `production` build tag needs
  `:go/build-tags`, which landed in lgx after the 0.5.0 release. Quel
  pins the released 0.5.0 and omits the tag, so `lgx build` keeps Wails'
  devtools for now. A backlog entry tracks adding
  `:targets {:bin {:go/build-tags ["production"]}}` once lgx ships it.
- **npm** for the frontend (node 24 via mise; no pnpm on the machine).
- **Go 1.27** in `.mise.toml`, as letgo-packages uses.

## File Structure

letgo-packages (`/home/agent/Projects/letgo-packages`):

| Path | Change |
|---|---|
| `sql/shim/shim.go` | Context-method `Connectable`, `Ctx`, `QueryCtx`, `ExecCtx`, `Conn`, `ColumnTypeNames` |
| `sql/lgx.edn` | Shim coord to `{:go/local "shim"}`, comment updated |
| `sql/README.md` | Document sessions, cancellation, column types, the `with-transaction` limit |
| `README.md` | "Releasing": `sql` joins the in-tree shims; only `duckdb` keeps a Go module tag |
| `.github/workflows/test.yml` | Comment: `sql` is in-tree now (the flip logic stays for `duckdb`) |
| `sqlite/test/sqlite/core_test.lg` | New: driver-level tests for the new shim fns |
| `sqlite/lgx.edn`, `postgres/lgx.edn`, `duckdb/lgx.edn`, `ragtime/lgx.edn` | PR 2: `sql-v0.3.0` |
| package READMEs showing coords | PR 2: tags bumped to `v0.3.0` |

Quel (`/home/agent/Projects/quel`):

| Path | Responsibility |
|---|---|
| `.gitignore` | `bin/`, `resources/public/`, `frontend/node_modules/`, `*.db`, `.nrepl-port`, `.tmp/` |
| `.mise.toml` | lg 1.13.0, lgx 0.5.0, go 1.27, node 24 |
| `lgx.edn` | Paths, `:main`, runtime, deps, `:targets`, `:tasks` |
| `README.md` | What Quel is, prerequisites, run, build, test, server mode |
| `AGENTS.md`, `CLAUDE.md` | Agent notes; `CLAUDE.md` is `@AGENTS.md` |
| `src/quel/app.lg` | Entry |
| `src/quel/system.lg` | Integrant config and lifecycle |
| `src/quel/shell.lg` | App and window components |
| `src/quel/menu.lg` | Menu spec and component |
| `src/quel/dev.lg` | Dev loop component |
| `src/quel/cells.lg` | Cell encoding |
| `src/quel/conn.lg` | Connection registry |
| `src/quel/exec.lg` | Query registry, run, cancel |
| `src/quel/api.lg` | Handlers |
| `test/quel/*_test.lg` | One test namespace per source namespace above, except `app` and `shell` |
| `frontend/` | Vite project: `package.json`, `vite.config.ts`, `tsconfig*.json`, `components.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/lib/bridge.ts`, `src/lib/bridge.test.ts`, `src/lib/types.ts`, `src/lib/utils.ts`, `src/components/ui/*` |
| `scripts/smoke.sh` | Server-mode smoke test |
| `.github/workflows/ci.yml` | CI |
| `docs/DESIGN.md` | Milestone 0 outcome (Task 13) |
| `docs/backlog/*` | Deferred items (Task 13) |

## Tasks

Part A runs in `/home/agent/Projects/letgo-packages`; Parts B and C in
`/home/agent/Projects/quel`. Part B's tasks 3-11 can be built against a
local `sqlite` override while Part A's PRs wait on CI, but Task 3's
committed `lgx.edn` names the released `sqlite-v0.3.0`.

### Task 1: `sql` context support (letgo-packages, PR 1)

**Files:**
- Modify: `sql/shim/shim.go`, `sql/lgx.edn`, `sql/README.md`, `README.md`, `.github/workflows/test.yml`
- Create: `sqlite/test/sqlite/core_test.lg`

- [x] **Step 1: Branch.** `git -C /home/agent/Projects/letgo-packages switch -c sql-context` from an up-to-date `master`.
- [x] **Step 2: Move the shim in-tree.** In `sql/lgx.edn` set the shim coord to `{:go/local "shim"}` and rewrite its comment the way `wails/lgx.edn` words it (ships inside the `sql-vX.Y.Z` package tag; `sql/shim/v0.1.0` stays as history).
- [x] **Step 3: Implement the shim additions** listed in the Design (exact signatures there). Register `QueryCtx`, `ExecCtx`, `Conn`, `ColumnTypeNames` and `NewCtx` in the `sql.shim` namespace next to the existing three. Update the package comment: the Connectable bullet now says it covers `*sql.DB`, `*sql.Tx` and `*sql.Conn`, and a new bullet explains why `Ctx` exists (let-go cannot build a `context.Context`).
- [x] **Step 4: Write `sqlite/test/sqlite/core_test.lg`.** Each test opens a temp-file database (`os/getenv "TMPDIR"` or `/tmp`, unique name via `random-uuid`) with `sqlite.core/open` and closes it. Tests:
  - `execute!` round-trip still works (create, insert, select) - the Connectable change is backward compatible.
  - Session: `(shim/Conn handle)`; `create temp table t (x)` and `insert` through `shim/ExecCtx` on it; a `shim/QueryCtx` select on the same Conn sees the row; `sql.core/execute!` with `{:sql/handle conn}` sees it too; the pool (`execute!` on the db) does not (`no such table`). Close the Conn.
  - `ColumnTypeNames` on `create table t (a integer, b text)` / `select a, b from t` is `["INTEGER" "TEXT"]`.
  - Cancel before the first row: run the runaway query (Design) with `QueryCtx` in a `future`; `sleep` 200 ms; `(.Cancel ctx)`; `deref` the future with a 5000 ms timeout. The future must have finished, with an exception whose message contains `interrupt`. `(.Canceled ctx)` is true.
  - Cancel mid-read: `QueryCtx` a recursive CTE yielding 1,000,000 rows; read one row; `(.Cancel ctx)`; `.Next` eventually returns false and `.Err` is non-nil.
  - `(.Cancel ctx)` twice does not throw.
- [x] **Step 5: Run the tests.**
  > Deviation: `sqlite/lgx.edn` gained `:lg-runtime :built` / `:lg-version "1.13.0"` (it had no tests before, so `lgx test` refused to run). The cancel-before-first-row error is `context canceled`, not "interrupted"; the test accepts either and the Design paragraph now says so.
  Run: `cd /home/agent/Projects/letgo-packages/sqlite && lgx test`
  Expected: all pass. The first run rebuilds the runtime (minutes). If a cancel test proves a semantic in the Design wrong (e.g. the error text), fix the Design paragraph in this plan and the README wording to match what the driver does - the test records reality, not a guess.
- [x] **Step 6: Also run** `cd ../sql && lgx test` and `cd ../ragtime && lgx test`. Expected: pass.
- [x] **Step 7: Docs.** `sql/README.md`: a "Sessions and cancellation" section (the `Ctx` lifecycle, `QueryCtx`/`ExecCtx`, `Conn`, the two cancel behaviours, `ColumnTypeNames`, `execute!` over a `*sql.Conn`, `with-transaction` not supported on one). Root `README.md` "Releasing": `sql` joins livekit, wails and nrepl as an in-tree shim; the Go-module-tag steps now apply to `duckdb` only. Update the CI comment in `.github/workflows/test.yml` to match.
- [x] **Step 8: Commit, push, open PR 1.** `git commit -m "sql: context-aware queries, sessions and column types; ship the shim in-tree"`, `git push -u origin sql-context`, `gh pr create` with a body summarising the API and the release plan (sql-v0.3.0, then the four dependents). Wait for CI (`gh pr checks --watch`). Expected: green.

### Task 2: Release `sql-v0.3.0` and its dependents (letgo-packages)

- [x] **Step 1: Merge PR 1** with a squash merge (the repo's history style), then `git switch master && git pull`.
- [x] **Step 2: Tag and push** `sql-v0.3.0` on the merge commit: `git tag sql-v0.3.0 && git push origin sql-v0.3.0`. Wait for the tag's CI run to pass.
- [x] **Step 3: PR 2.** Branch `sql-v0.3.0-dependents`; set the `abogoyavlensky/letgo-sql` coord in `sqlite/lgx.edn`, `postgres/lgx.edn`, `duckdb/lgx.edn` and `ragtime/lgx.edn` to `:git/tag "sql-v0.3.0"` (byte-identical in all four). Find README coord snippets with `grep -rnE '(sql|sqlite|postgres|duckdb|ragtime)-v0\.[0-9]+\.[0-9]+' */README.md README.md` and bump the ones that show a consumer what to depend on to `v0.3.0` (the root README's example currently shows `sqlite-v0.1.0`); leave historical mentions alone. Commit `"Pin letgo-sql sql-v0.3.0"`, push, `gh pr create`, wait for CI, squash-merge, pull `master`.
- [x] **Step 4: Tag and push** `sqlite-v0.3.0`, `postgres-v0.3.0`, `duckdb-v0.3.0`, `ragtime-v0.3.0` on PR 2's merge commit (`git push origin <tag>` each). Wait for each tag's CI run.
- [x] **Step 5: Verify a clean consumer resolves it:** in a scratch dir with an `lgx.edn` depending only on `sqlite-v0.3.0` and a `main.lg` that calls `(sql.shim/NewCtx)`, `lgx run` prints no `already resolved` warning and succeeds. Delete the scratch dir.

### Task 3: Quel repository scaffold

**Files:** Create `.gitignore`, `.mise.toml`, `lgx.edn`, `README.md`, `AGENTS.md`, `CLAUDE.md`

- [x] **Step 1: `.mise.toml`** with `lg = "1.13.0"`, `lgx = "0.5.0"`, `go = "1.27"`, `node = "24"`, the same `[tool_alias]` entries and `github_attestations = false` setting (with its comment) as `/home/agent/Projects/letgo-packages/.mise.toml`. Run `mise install`; `lgx --version` prints 0.5.0.
- [x] **Step 2: `.gitignore`** with the entries in File Structure.
- [x] **Step 3: `lgx.edn`**, modelled on wails-tasks' (keep its explanatory comments where they apply):
  - `:paths ["src"]`, `:resource-paths ["resources"]`, `:main "src/quel/app.lg"`, `:lg-runtime :built`, `:lg-version "1.13.0"`;
  - `:targets {:bin {:out "bin/quel"}}`, with a comment that the `production` build tag waits on an lgx release with `:go/build-tags`;
  - `:deps`: `wails-v0.2.0`, `nrepl-v0.1.0`, `sqlite-v0.3.0` (all `:deps/root` coords on `https://github.com/abogoyavlensky/letgo-packages`), `dev.weavejester/dependency` and `dev.weavejester/integrant` at `1.0.1` (with wails-tasks' comment on why both are listed);
  - `:tasks`:
    - `fe-install` - `{:sh "npm --prefix frontend ci"}`
    - `fe-build` - `{:sh "npm --prefix frontend run build"}`
    - `fe-watch` - `{:sh "npm --prefix frontend run watch"}`
    - `build` (overrides the built-in) - `[{:task fe-build} {:task lgx:build}]`
    - `smoke` - `{:sh "bash scripts/smoke.sh"}`
- [x] **Step 4: `README.md`**: one paragraph on Quel and a link to `docs/DESIGN.md`; prerequisites (mise tools; Xcode CLT on macOS; `libgtk-4-dev libwebkitgtk-6.0-dev` on Linux); develop (`lgx fe-install`, then `lgx fe-watch` in one terminal and `lgx run` in another; the nREPL port in `.nrepl-port`); server mode without a desktop (`CGO_ENABLED=0 GOFLAGS=-tags=server lgx run`, open `http://localhost:8080`); test (`lgx test`, `npm --prefix frontend test`, `lgx smoke`, each with the server-mode env on Linux without the webview headers); build (`lgx build && ./bin/quel`). Use /writing-clearly.
- [x] **Step 5: `AGENTS.md`**: the stack in three lines, where the design and plans live, the commands above, and the rules that bite: all app code is let-go (gaps go upstream to letgo-packages); handlers and menu clicks registered by var; `quel.app` is required by nothing; no `with-redefs`/`alter-var-root` in app code; no runtime data from resources; `os/getenv` returns `""` for unset vars. `CLAUDE.md` contains the single line `@AGENTS.md`.
- [x] **Step 6: Commit** `git add -A && git commit -m "Scaffold the Quel project"` (this also commits `docs/DESIGN.md` and this plan if they are still untracked).

> Deviation: Task 3 committed `lgx.edn` with `:local/root` coords for `sql`/`sqlite` while the release was in flight, then switched to `sqlite-v0.3.0` in a follow-up commit once Task 2 published it.

### Task 4: Backend skeleton - system, shell, menu, dev loop, ping

**Files:**
- Create: `src/quel/app.lg`, `src/quel/system.lg`, `src/quel/shell.lg`, `src/quel/menu.lg`, `src/quel/dev.lg`, `src/quel/api.lg`
- Test: `test/quel/system_test.lg`, `test/quel/menu_test.lg`, `test/quel/api_test.lg`

- [x] **Step 1: `quel.shell`, `quel.dev`, `quel.app`** - port `tasks.app`, `tasks.dev` and `main.lg` from wails-tasks, renamed. `quel.app` starts with `(ns quel.app ...)` and ends with `(when-not *compiling-aot* (-main))`.
- [x] **Step 2: `quel.menu`**: `spec` returns `[{:role :app-menu} {:label "File" :items [{:label "Open Database…" :accelerator "CmdOrCtrl+O" :on-click (partial #'open-db! env)} {:label "Run" :accelerator "CmdOrCtrl+Enter" :on-click (partial #'run! env)} {:separator true} {:role :quit}]} {:role :edit-menu} {:role :window-menu}]`. `run!` emits `menu:run` with `{}`; `open-db!` calls `w/open-file` (title "Open Database", filters `[["SQLite" "*.db;*.sqlite;*.sqlite3"] ["All files" "*"]]`) and, unless cancelled, emits `menu:open-db` with `{:path path}`. Wrap both in the `reporting` helper from `tasks.menu`. `install!` and the component as in `tasks.menu`.
- [x] **Step 3: `quel.api`** with `ping` only for now, the `handlers` map of vars, and the `:quel.api/handlers` component registering `(partial v env)` for each (env is the component's opts map).
- [x] **Step 4: `quel.system`**: the config from the Design (with the conn and exec registry keys commented out until Tasks 6-7 add their components, and `:quel.api/handlers` taking `{}` for now), `system*`, `halted*`, `start!`, `stop!` ported from `tasks.system`.
- [x] **Step 5: Tests.** `system_test`: `config` has the expected keys and refs (no `ig/init`: starting needs a window). `menu_test`: `(w/check-menu (menu/spec {:app nil}))` is true. `api_test`: `(api/ping {})` is `{:ok true}`; every value in `api/handlers` is a var. Port any helper patterns from wails-tasks' tests.
- [x] **Step 6: Run.** `cd /home/agent/Projects/quel && CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`. Expected: pass (the first run builds the runtime, minutes).
- [x] **Step 7: Run the app in server mode** with a placeholder `resources/public/index.html` (`<h1>Quel</h1>`, not committed - it is gitignored): `CGO_ENABLED=0 GOFLAGS=-tags=server WAILS_SERVER_PORT=8090 lgx run`, then `curl -fs localhost:8090/` returns the page and `.nrepl-port` exists. Stop it.
- [x] **Step 8: Commit** `"Add the integrant system, window, menu and dev loop"`.

> Deviation: port 8090 is taken on this machine by an unrelated process; server-mode checks use a free port picked at run time. `quel.menu` excludes `clojure.core/run!` (it defines its own `run!`).

### Task 5: `quel.cells`

**Files:** Create `src/quel/cells.lg`; Test `test/quel/cells_test.lg`

- [x] **Step 1: Write the tests**: `nil`, `true`, `1.5`, `"x"` pass through; `9007199254740991` and `-9007199254740991` stay integers; `9007199254740992` and `-9007199254740992` become `"9007199254740992"` / `"-9007199254740992"`; an opaque value (e.g. a boxed Go value or a keyword) becomes its `str`; `encode-row` maps over a vector and returns a vector.
- [x] **Step 2: Run them; expect failures** (`CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`).
- [x] **Step 3: Implement** `encode` and `encode-row` per the Design.
- [x] **Step 4: Run; expect pass. Commit** `"Add cell encoding for the bridge"`.

### Task 6: `quel.conn`

**Files:** Create `src/quel/conn.lg`; Modify `src/quel/system.lg`; Test `test/quel/conn_test.lg`

- [x] **Step 1: Write the tests** (temp-file databases, cleaned up): `open!` returns a `conn-id` and the path; a blank path throws; `session!` returns the same Conn on two calls; a temp table created on the session is visible on the session; `close!` removes the entry and a later `session!` throws `No open database`; `close!` of an unknown id is a no-op; `ig/halt-key!` closes every entry.
- [x] **Step 2: Run; expect failures.**
- [x] **Step 3: Implement** per the Design; `init-key` returns `(atom {})`. Enable `:quel.conn/registry` in `quel.system/config`.
- [x] **Step 4: Run; expect pass. Commit** `"Add the connection registry with one session per database"`.

> Deviation: `(str (random-uuid))` is `#uuid "..."` on let-go 1.13.0; `quel.conn/new-id` extracts the bare UUID (found by the smoke test; backlogged upstream). `quel.conn` excludes `clojure.core/close!`.

### Task 7: `quel.exec`

**Files:** Create `src/quel/exec.lg`; Modify `src/quel/system.lg`; Test `test/quel/exec_test.lg`

- [x] **Step 1: Write the tests** over a real conn registry and a temp database:
  - `select 1 as id, 2 as id` returns two columns named `id`, in order, and rows `[[1 2]]`.
  - Column types come through for a table (`INTEGER`, `TEXT`).
  - A 1,200-row table with `page-size` 500 returns 500 rows and `:has-more true`; a 3-row table returns `:has-more false`.
  - `insert` of 2 rows returns `:update-count 2`, empty columns and rows.
  - A syntax error throws with the driver's message, and the registry is empty afterwards.
  - Cancel: start the runaway query in a `future`; poll until its `query-id` is in the registry; `(cancel! execs query-id)` is true; the future throws `"Query canceled."` within 5 s; registry empty afterwards.
  - `cancel!` of an unknown id is false.
  - A second `run!` on the same `conn-id` while one runs throws `A query is already running on this connection.`
  - A duplicate `query-id` throws.
  - Halting the registry cancels a running query.
  - Shutdown order: `ig/init` the two registry keys from `quel.system/config` (`select-keys`), start the runaway query in a `future` on a session, then `ig/halt!` the pair. The halt returns within 5 s and the future throws `"Query canceled."`. This is the regression test for the exec -> conn ref.
- [x] **Step 2: Run; expect failures.**
- [x] **Step 3: Implement** per the Design. Keep the read loop in its own fn (`read-page`) so milestone 1's `fetch-page` can reuse it.
- [x] **Step 4: Run; expect pass. Commit** `"Add query execution with paging and cancellation"`.

> Deviation: codex found `sql.core/returns-rows?` misroutes `PRAGMA` (rows) and writing `WITH` statements (update count); `quel.exec/rows?` corrects both, classifying a `WITH` by its outer operation at parenthesis depth 0 with whole SQLite identifiers. The shutdown-order test passes with or without the exec -> conn ref (integrant happens to init `conn` before `exec`), so it guards the behaviour, not the ref; the ref stays to make the order explicit.

### Task 8: Handlers

**Files:** Modify `src/quel/api.lg`, `src/quel/system.lg`; Test `test/quel/api_test.lg`

- [x] **Step 1: Write the tests** calling the handler fns directly with `{:conns (atom {}) :execs (atom {})}`: `open-db` / `run` / `close-db` round-trip, `run` result keys exactly `:columns :rows :has-more :update-count :elapsed-ms`, `cancel` of an unknown id is `{:canceled false}`.
- [x] **Step 2: Implement** `open-db`, `close-db`, `run`, `cancel` as thin wrappers over `quel.conn` and `quel.exec`; add them to `handlers`. Wire `:quel.api/handlers` to both registries in `quel.system/config` (now the full config from the Design).
- [x] **Step 3: Run; expect pass. Commit** `"Expose open-db, close-db, run and cancel to the frontend"`.

> Deviation: `quel.cells` sends infinite and NaN floats as `"Infinity"`, `"-Infinity"`, `"NaN"` (codex: Go's JSON encoder rejects them; `select 1e999` produces one). `quel.app` exits 1 with the error when `w/run!` fails to start (codex: a busy port exited 0 silently).

### Task 9: Frontend scaffold

**Files:** Create everything under `frontend/` listed in File Structure.

- [x] **Step 1: Create the Vite project**: `npm create vite@latest frontend -- --template react-ts`, then remove the template's demo assets and CSS.
- [x] **Step 2: Tailwind v4 and shadcn.** `npm i -D tailwindcss @tailwindcss/vite @types/node`; add the plugin and the `@` alias to `vite.config.ts` and the `paths` to the tsconfigs, per shadcn's current Vite guide; `npx shadcn@latest init`, then `npx shadcn@latest add button input textarea table`. Follow /shadcn.
- [x] **Step 3: Vite build output and scripts.** `vite.config.ts`: `build.outDir: "../resources/public"`, `emptyOutDir: true`, `base: "/"`. `package.json` scripts: `build` (`tsc -b && vite build`), `watch` (`vite build --watch`), `test` (`vitest run`). Do not add a `dev` script: it would suggest a dev server that cannot reach the bridge.
- [x] **Step 4: Runtime.** `npm i -E @wailsio/runtime@3.0.0-beta.30`; `npm i -D vitest`.
- [x] **Step 5: `src/lib/bridge.ts`, `src/lib/types.ts`** per the Design.
- [x] **Step 6: `src/lib/bridge.test.ts`**: mock `@wailsio/runtime` with `vi.mock`; `call("run", "c", "q", "select 1")` invokes `Call.ByName` with `BRIDGE, "run", ["c", "q", "select 1"]` and resolves to its value; `onEvent` returns the unsubscribe fn from `Events.On`.
- [x] **Step 7: Run** `npm --prefix frontend test` (expect pass) and `lgx fe-build` (expect `resources/public/index.html` and hashed assets).
- [x] **Step 8: Commit** `"Scaffold the frontend: Vite, React, Tailwind, shadcn and the bridge"`.

### Task 10: Spike screen

**Files:** Modify `frontend/src/App.tsx`; possibly create small components under `frontend/src/components/`.

- [x] **Step 1: Build the screen** described in the Design. Keep state in `useState`; no state library yet. Errors from a rejected `call` show in the status line. Run and the `menu:run` listener share one `runQuery` fn; unsubscribe the listener on unmount.
- [x] **Step 2: Build and check in server mode.** `lgx fe-build`, then `CGO_ENABLED=0 GOFLAGS=-tags=server WAILS_SERVER_PORT=8090 lgx run`. Drive it in headless Chromium (the /run skill's browser-driven pattern, or a throwaway Playwright script under `.tmp/`): the ping status shows ok; open a temp `.db` path; run `create table t (id integer, name text)`, an insert, `select * from t` (rows shown), `select 1 as id, 2 as id` (two `id` columns); run the runaway query, click Cancel, see "Query canceled." within a few seconds; Run is disabled while running. Take a screenshot of the result grid for the summary.
- [x] **Step 3: Commit** `"Add the spike screen: open, run, cancel"`.

> Deviation: shadcn init needed `-t vite -b radix -p nova` to run non-interactively (TypeScript 7 template, Geist font). The ref updates live in an effect (oxlint `react(refs)`).

### Task 11: Smoke test and CI

**Files:** Create `scripts/smoke.sh`, `.github/workflows/ci.yml`

- [x] **Step 1: `scripts/smoke.sh`**, adapted from wails-tasks' `smoke.sh` (same process-group cleanup, port pick, wait loop, `call` helper and bridge name). It runs `lgx fe-build` first if `resources/public/index.html` is missing, then checks: `/` returns 200; `ping` contains `"ok":true`; `open-db` on a temp path returns a `conn-id` (extract with `python3 -c 'import json,sys; ...'`); `run` of `select 1 as id, 2 as id` contains `"rows":[[1,2]]`; the runaway query started in the background with a fixed query-id, `cancel` with that id returns `"canceled":true`, and the background call's response contains `Query canceled.` within 10 s; finally the nREPL redefinition of `quel.api/ping` (via `alter-var-root` from the client, as wails-tasks does - this is test code, not app code) changes the next `ping`. If `NREPL_CLIENT` does not exist, print `smoke: nREPL step skipped` and skip only that step.
- [x] **Step 2: Run** `lgx smoke` with the server-mode env. Expected: `smoke: ok`.
- [x] **Step 3: `.github/workflows/ci.yml`**: on push to `main` and pull requests; `actions/checkout@v4`, `jdx/mise-action@v3`, cache `~/.cache/go-build`, `~/go/pkg/mod`, `~/.lgx/runtimes` and `~/.npm` keyed on `lgx.edn` and `frontend/package-lock.json`; then `lgx fe-install`, `npm --prefix frontend test`, `lgx fe-build`, `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`, and `CGO_ENABLED=0 GOFLAGS=-tags=server lgx smoke`. Lint it with `actionlint`.
- [x] **Step 4: Commit** `"Add the server-mode smoke test and CI"`. The repo has no remote yet; CI runs once it is pushed to GitHub (not part of this plan).

> Deviation: codex found overlapping Open requests could leak a connection; opening and closing are now one serialized `switchDb` with the buttons disabled meanwhile. The browser check used a throwaway Playwright script in `.tmp/e2e/`.

### Task 12: macOS verification (by hand, on a Mac)

The executor on Linux stops here and hands this checklist to the user. Record each result (pass, or what failed and the error) in the summary for Task 13.

- [ ] **Step 1: Set up.** Clone the repo, `mise install`, `lgx fe-install`, `lgx fe-build`.
- [ ] **Step 2: `lgx run`** (first run builds the runtime with the Cocoa layer; minutes). A native window opens and the ping status shows ok.
- [ ] **Step 3: The bridge.** Open a `.db` file, run a create/insert/select, see rows; `select 1 as id, 2 as id` shows two columns.
- [ ] **Step 4: Cancel.** The runaway query; Cancel ends it within a few seconds; the app stays responsive while it runs.
- [ ] **Step 5: Menus and dialogs.** The Quel app menu, Edit (Cmd+C/V/A work in the textarea), Window; File > Run and Cmd+Enter run the query. File > Open Database… (and Cmd+O) shows the native open dialog; picking a `.db` file opens it in the screen; Cancel in the dialog does nothing.
- [ ] **Step 6: Dev loop.** With `lgx fe-watch` running, edit a string in `App.tsx`: the window reloads with it. Connect an editor (or `nreplctl`) to `.nrepl-port`, redefine `quel.api/ping` to return `{:ok false}`, reload the window: the status changes.
- [ ] **Step 7: Built binary.** `lgx build && ./bin/quel` opens the window with the embedded frontend; launching it from Finder (after wrapping or via `open bin/quel`) shows the page, not a blank window.
- [ ] **Step 8: Quit** with Cmd+Q: the process exits cleanly (no hang, no panic on stderr).

### Task 13: Record the outcome

**Files:** Modify `docs/DESIGN.md`; Create entries under `docs/backlog/`

- [x] **Step 1: Update `docs/DESIGN.md`**:
  - Milestones: milestone 0 is the SQLite spike plus project setup, done (date); milestone 1 starts with the Redshift checks the spike skipped (pgx connects and queries, a cancel reaches the cluster, the catalog sources).
  - Unverified: move the settled items to a short "Settled by milestone 0" list with dates and results - the bridge from a Vite-built page, `@wailsio/runtime` 3.0.0-beta.30 matching the shim, column types (via `sql.shim/ColumnTypeNames`), context cancel on SQLite, and the macOS items according to Task 12's results. The Redshift items stay.
  - Namespaces: replace `quel.app`'s component role with `quel.shell` and explain why (the entry script is required by nothing); integrant keys `:quel.shell/app`, `:quel.shell/window`.
  - Dev loop: `vite build --watch` plus window reload; dev-server HMR waits on the wails-package change.
  - Upstream work: the `sql` context and `ColumnTypes` rows are done in `sql-v0.3.0`; the wails row reflects Task 12.
- [x] **Step 2: Backlog** with /backlog: (a) Vite dev-server HMR - the wails package's asset handler should proxy `FRONTEND_DEVSERVER_URL` (upstream, letgo-packages/wails); (b) add `:go/build-tags ["production"]` to `:targets :bin` once an lgx release carries it; (c) any failures from Task 12 not fixed in this milestone.
- [x] **Step 3: Commit** `"Record the milestone 0 outcome"`.

## Completion summary

Implemented on branch `milestone-0`, Tasks 1-11 and 13. Task 12, the
macOS pass, is the user's: it needs a Mac and is unchecked above.

- **Upstream:** letgo-packages #9 (the `sql` shim: `NewCtx`, `QueryCtx`,
  `ExecCtx`, `Conn`, `ColumnTypeNames`, in-tree shim, first sqlite tests)
  and #10 (dependents pinned). Tags published: `sql-v0.3.0`,
  `sqlite-v0.3.0`, `postgres-v0.3.0`, `duckdb-v0.3.0`, `ragtime-v0.3.0`.
- **Quel:** the integrant system, shell, menu (with Open Database… and
  Run), dev loop, `conn`, `exec`, `cells`, `api`; the Vite/React/Tailwind/
  shadcn frontend with the bridge and the spike screen; `scripts/smoke.sh`;
  CI; `docs/DESIGN.md` updated; three backlog entries.
- **Verified:** 36 backend tests, 2 frontend tests, `lgx smoke` (including
  the cancel and the nREPL redefinition), headless Chromium driving the
  screen (cancel lands in under 100 ms, the session stays usable), and a
  server-mode `bin/quel` started from `/` serving the embedded frontend.
  CI has not run: the repo has no remote yet.

Deviations, in one place:

- The cancel error on SQLite is `context canceled`, not "interrupted".
- `sqlite/lgx.edn` gained `:lg-runtime :built` for its first tests.
- Quel used `:local/root` coords until the release, then the tags.
- Port 8090 is taken on this machine; checks pick a free port.
- `quel.exec/rows?` corrects `returns-rows?` for `PRAGMA` and writing
  `WITH` statements (three codex rounds refined it).
- Non-finite floats cross as strings; a failed `w/run!` exits 1.
- `(str (random-uuid))` is tagged on let-go; `quel.conn/new-id` works
  around it (backlogged).
- Opening and closing databases in the UI is serialized.
- `quel.menu`, `quel.exec` and `quel.conn` exclude the `clojure.core`
  names they redefine (`run!`, `close!`).
- The shutdown-order test cannot detect a missing exec -> conn ref.

**What the plan could have specified better:** statement routing. It
leaned on `sql.core/returns-rows?` without checking it against SQLite's
`PRAGMA` and CTE writes, which cost three review rounds. It also assumed
port 8090 was free and that `str` of a UUID matches Clojure: a plan should
not hard-code ports, and should verify the let-go behaviour it relies on.
