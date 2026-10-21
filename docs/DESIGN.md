# Quel - design

Quel is a desktop database client: a day-to-day workhorse for writing SQL
and browsing database structure, in the spirit of TablePlus with a touch of
the JetBrains database console. It is free to use. macOS comes first; Linux
and Windows follow when the stack allows.

This document records the decisions made before the first line of code and
the reasons behind them. It is the reference for the implementation plans
in `docs/plans/`.

## Goals

- **SQL editor**: syntax highlighting and schema-aware autocomplete; run
  the statement under the cursor, the selection, or the whole script.
- **Structure browser**: schemas, tables, views, columns, indexes, keys,
  constraints, functions and procedures - whatever each engine has.
- **Results**: a fast grid that pages through large results, several result
  tabs, and pinning to keep a result while running new queries.
- **Structure export**: the DDL of one object or a whole schema, viewed or
  saved to a file.
- **Diagrams**: ER diagrams of a schema's tables, exportable.
- **Safety**: an optional confirmation before a statement that changes
  data or structure, and read-only connection profiles.
- **Robust**: a runaway query can always be cancelled, a huge result never
  freezes the app, and a lost connection is reported, not fatal.

## Non-goals (for now)

- Inline cell editing that generates `UPDATE`s. It needs primary-key
  detection and change tracking, and it is the riskiest feature in this
  class of app; it comes after the read path is solid.
- Database administration: users, grants, server settings, monitoring.
- Visual query builders, schema migration tooling, data import wizards.
- Windows: let-go does not build for `GOOS=windows` yet.

## Engines, in priority order

| Priority | Engine | Driver (letgo-packages) | Notes |
|---|---|---|---|
| 1 | Redshift | `postgres` (pgx, pure Go) | Postgres wire protocol, its own catalog |
| 1 | SQLite | `sqlite` (modernc, pure Go) | a file, opened by path |
| 2 | PostgreSQL | `postgres` (pgx, pure Go) | |
| 2 | DuckDB | `duckdb` (cgo) | a file, locked by the process that opens it |
| later | Redis | `go-redis` (new package) | a key browser, not a SQL client |

Redshift and SQLite are the first targets. Postgres comes almost free once
Redshift works (same driver, a different catalog). DuckDB is cgo and adds
about 75 MB to the binary; Wails is cgo already, so the only real cost is
size.

## Stack

| Layer | Choice |
|---|---|
| Language | [let-go](https://github.com/nooga/let-go), managed by [lgx](https://github.com/abogoyavlensky/lgx) |
| Desktop shell | [Wails v3](https://v3.wails.io) through the `wails` package in letgo-packages |
| Database access | the `sql` layer and its driver packages in letgo-packages |
| App wiring | integrant |
| App storage | SQLite in the per-user data dir, migrated with ragtime |
| Frontend build | Vite, TypeScript, React |
| UI components | shadcn/ui (Tailwind) |
| Data and grid | TanStack Query, TanStack Table, TanStack Virtual |
| SQL editor | CodeMirror 6 with `@codemirror/lang-sql` |
| Diagrams | React Flow (`@xyflow/react`) with elkjs for layout |

`examples/wails-tasks` in the lgx repo is the reference for how these
pieces fit: integrant system, handlers registered by var, menu as data,
an nREPL inside the running app under `lgx run`.

### Why this stack

The alternatives considered were Go + Wails, Rust + Tauri and Rust + egui.

- **egui was rejected** because the editor is the heart of the app and
  egui has no mature code editor: completion popups, undo grouping, IME
  and macOS-native text behaviour would all be hand-built. A webview gets
  CodeMirror for free.
- **Tauri** is the more mature shell and was the pick for a pure "just the
  tool" decision. **let-go + Wails** won because Quel is also meant to be
  a real application on the let-go stack: every gap it hits becomes an
  improvement to letgo-packages or lgx rather than app-local glue.

### All application code is let-go

The app has no Go code of its own. What let-go cannot reach goes into
letgo-packages as a reusable package feature (see
[Upstream work](#upstream-work)). The `sql` layer already exposes what a
database client needs below `execute!`: `shim/Query` returns a live
`*sql.Rows`, `shim/ScanRow` returns one row as a vector in column order,
and `.Columns`, `.Next` and `.Close` are callable from let-go. Quel builds
its own cursor on those instead of `sql.core/execute!`, whose
vector-of-maps result loses column order and collides on duplicate column
names (`select a.id, b.id`).

Performance is not a reason to drop to Go: results are fetched in pages of
a few hundred rows, so per-cell work is small, and query time is spent
waiting on the network inside Go, not in bytecode.

## Architecture

```
┌──────────────────────────── Quel.app ────────────────────────────┐
│  WKWebView                                                       │
│  React + shadcn + TanStack + CodeMirror  (resources/public)      │
│           │  Call.ByName(bridge, name, args)   ▲ Events          │
│           ▼                                     │                │
│  wails package bridge ─── handlers (quel.api, by var) ───────────│
│                              │                                   │
│   quel.store   quel.secrets  quel.conn   quel.exec   quel.meta.* │
│   (app sqlite) (Keychain)    (sessions)  (cursors)   (catalogs)  │
│                              │                                   │
│        letgo-packages: sql, sqlite, postgres, duckdb             │
└──────────────────────────────┼───────────────────────────────────┘
                               ▼
              Redshift · SQLite · PostgreSQL · DuckDB
```

### Namespaces

| Namespace | Responsibility |
|---|---|
| `quel.app` | Entry point: starts the system, runs the Wails loop. Not `main` - see [Builds](#builds). Required by nothing: it ends in `(-main)`, so loading it starts the app. |
| `quel.shell` | The Wails app and window components. |
| `quel.system` | The integrant config and the running system (`defonce`). |
| `quel.store` | App database: connection profiles, query history, saved workspace. Migrations in `quel.migrations`. |
| `quel.secrets` | Passwords in the macOS Keychain, keyed by profile id. Never in the app database. |
| `quel.conn` | Opens a pool per connected profile, hands out sessions, tracks connection state. |
| `quel.exec` | Runs statements, owns the result registry, paging and cancellation. |
| `quel.cells` | Converts driver values into the cell encoding the grid renders. |
| `quel.classify` | Decides whether a statement reads or writes. |
| `quel.meta` | The introspection protocol: a multimethod per operation, dispatched on `:engine`. |
| `quel.meta.redshift`, `.sqlite`, `.postgres`, `.duckdb` | Catalog SQL and DDL generation per engine. |
| `quel.export` | Writing DDL and results to files. |
| `quel.api` | The handlers the frontend calls, registered by var so the nREPL can redefine them. |
| `quel.menu` | The application menu as data; items emit events the frontend acts on. |
| `quel.dev` | nREPL and the window reload on frontend rebuilds, under `lgx run` only. |

Integrant components: `:quel.store/db`, `:quel.conn/registry`,
`:quel.exec/registry`, `:quel.api/handlers`, `:quel.shell/app`,
`:quel.shell/window`, `:quel.menu/menu`, `:quel.dev/loop`. Halting the system
cancels running queries, closes open cursors, closes every pool, then the
app database. `:quel.exec/registry` refs `:quel.conn/registry` to fix that
order: closing a session that is still running a query waits for it.

## Connections and sessions

A **profile** is the saved description of a database: name, engine, host
/ port / database / user or a file path, SSL mode, a colour tag
(e.g. red for production), `:read-only?` and the confirm policy. The
password lives in the Keychain under the profile id.

Connecting a profile opens one `database/sql` pool. Two kinds of work use
it:

- **Metadata** (the structure tree, completion, DDL) takes any pooled
  connection.
- **Each editor tab gets its own session**: a dedicated `*sql.Conn` taken
  from the pool on first run and held while the tab is open. Session
  state (`BEGIN` ... `COMMIT`, `SET search_path`, temp tables) therefore
  behaves the way it does in `psql`. The editor shows when a tab's session
  is inside an open transaction, and closing such a tab asks first.

Statements run in autocommit unless the user opens a transaction.

SQLite and DuckDB profiles are file paths. DuckDB locks the file for the
process, so a DuckDB file is opened once and shared across tabs; a second
open of the same file reuses the pool.

## Query execution

### Splitting and what gets sent

The frontend owns splitting because it knows the cursor: `Cmd+Enter` runs
the statement under the cursor (or the selection), `Cmd+Shift+Enter` runs
the whole script. The splitter is a small tokenizer that respects
`'...'`, `"..."`, `$tag$...$tag$` (Postgres and Redshift procedure
bodies), and `--` / `/* */` comments. The backend always receives a list
of single statements.

### Running

`run` takes a frontend-generated `query-id`, so the query can be cancelled
before its first row arrives:

1. `quel.classify` checks the statement. On a read-only profile a write is
   refused; with confirmation on, the frontend has already shown the
   dialog (it calls `classify` first).
2. A cancellable context is created and stored under `query-id`.
3. The statement runs on the tab's session. Row-returning statements open
   a cursor; others return an update count. `quel.exec/rows?` decides:
   the `sql` layer's `returns-rows?` heuristic, corrected for the cases it
   misses (SQLite `PRAGMA`, a `WITH` whose outer statement writes).
4. The first page (default 500 rows) and the column metadata come back in
   the reply, with `:has-more`.

`fetch-page` reads the next page from the open cursor. `cancel` calls the
stored cancel fn; pgx turns that into a protocol cancel request, so
Redshift and Postgres stop the query server-side.

### Cursor lifetime

An open cursor holds a connection and, on Redshift, cluster resources. A
cursor is closed when it is fully read, when the user cancels, when its
result tab is closed or replaced, or after five idle minutes. A result
whose cursor closed early stays visible and says "showing N rows - run
again for more". Cancelling before close matters: draining an unread
million-row result just to close it would be slow.

### Results and pinning

Each run of a row-returning statement produces a result tab. The newest
unpinned tab is replaced by the next run, as in JetBrains; a **pinned**
tab is never replaced and keeps its rows until closed. Running a script
produces one tab per row-returning statement, and one summary for the
update counts.

### Cell encoding

The grid receives arrays, not maps:

```json
{"columns": [{"name": "id", "type": "INT8"}, {"name": "id", "type": "INT8"}],
 "rows": [[1, 7], [2, null]],
 "has-more": true, "elapsed-ms": 412}
```

`quel.cells` converts every value before it crosses the bridge:

- integers beyond ±2^53 become strings, so JavaScript does not round them;
- `numeric` / `DECIMAL` stay exact strings;
- dates and timestamps become ISO-8601 strings shaped by the column type;
- binary values become a truncated hex preview;
- text longer than 64 KB is truncated, with a flag, and the full value is
  fetched on demand;
- anything opaque falls back to its string form, never an error.

## Introspection

`quel.meta` defines operations as multimethods on the profile's
`:engine`: `schemas`, `objects` (tables, views, materialized views,
functions, procedures, sequences - per engine), `columns`, `indexes`,
`constraints`, `foreign-keys`, `table-info`, `ddl`, and
`completion-schema`. Catalog queries are plain SQL strings in the engine
namespaces, not resources, so they survive a `:native` build.

| | Redshift | SQLite | PostgreSQL | DuckDB |
|---|---|---|---|---|
| Schemas | `svv_all_schemas` (local, external, datashare) | `pragma_database_list` (main, temp, attached) | `pg_namespace` | `duckdb_schemas()` |
| Tables, views | `svv_all_tables`, `pg_class` | `sqlite_schema` | `pg_class` | `duckdb_tables()`, `duckdb_views()` |
| Columns | `svv_all_columns`; `pg_get_late_binding_view_cols()` for late-binding views | `pragma_table_info` | `pg_attribute` | `duckdb_columns()` |
| Indexes | none - dist style, dist key and sort keys instead | `pragma_index_list` | `pg_index` + `pg_get_indexdef` | `duckdb_indexes()` |
| Keys | `pg_constraint` (declared, not enforced) | `pragma_foreign_key_list` | `pg_constraint` | `duckdb_constraints()` |
| Functions | `pg_proc`; procedures via `pg_proc_info` | `pragma_function_list` (built-ins only) | `pg_proc` + `pg_get_functiondef` | `duckdb_functions()` |
| Table info | `svv_table_info`: rows, size, skew, unsorted % | page count | `pg_class` stats, `pg_total_relation_size` | `duckdb_tables()` estimated size |
| DDL | `SHOW TABLE` / `SHOW VIEW` / `SHOW PROCEDURE` | `sqlite_schema.sql` | assembled from the catalog | `sql` column of `duckdb_tables()` |

Redshift specifics worth designing around:

- `pg_table_def` only lists schemas on the `search_path`; do not use it
  for browsing.
- `svv_table_info` omits empty tables; join it, never drive from it.
- The structure tree shows "Dist / sort keys" where other engines show
  "Indexes": the section list is engine-defined, not fixed.

The structure tree loads lazily, one level per expand. `completion-schema`
returns `{schema {table [columns]}}` for the connected database, cached
per connection, refreshed on demand and after DDL runs, and fed straight
into `lang-sql`'s completion.

## Write safety

`quel.classify` returns `:read`, `:write` or `:unknown`. It reads the
first keyword past comments: `SELECT`, `SHOW`, `EXPLAIN`, `VALUES`,
`TABLE`, `DESCRIBE` are reads; a `WITH` is a read unless an `INSERT`,
`UPDATE`, `DELETE` or `MERGE` appears outside literals; SQLite `PRAGMA x`
is a read and `PRAGMA x = y` a write; everything else is a write.
`:unknown` is treated as a write.

Per profile:

- **Confirm policy**: `:never`, `:writes` (the default for profiles tagged
  production) or `:always`. The dialog shows the statement and the
  profile's name and colour.
- **Read-only**: writes are refused before they are sent. Where the
  engine can enforce it too, it does: `default_transaction_read_only` on
  Postgres, `mode=ro` for SQLite, `access_mode=READ_ONLY` for DuckDB.
  Redshift relies on the client check and on the user's grants.

## Frontend

The frontend is a Vite project in `frontend/` that builds into
`resources/public`. It talks to the backend through `@wailsio/runtime`'s
`Call.ByName` on the wails package's bridge, wrapped in one typed
`call(name, ...args)` helper; every handler is a TanStack Query query or
mutation.

Layout, in resizable panes (shadcn `Resizable`):

```
┌──────────┬───────────────────────────────────────────┐
│ profiles │ [tab: sales.sql] [tab: scratch] [+]        │
│ ──────── │  CodeMirror editor                         │
│ structure│                                            │
│ tree     ├───────────────────────────────────────────┤
│          │ [result 1 📌] [result 2] [messages]         │
│          │  TanStack Table + Virtual grid             │
└──────────┴───────────────────────────────────────────┘
 status bar: profile · session state · rows · elapsed · cancel
```

- `Cmd+K` (shadcn `Command`) jumps to any table, view or function and
  opens its structure, data or DDL.
- Context menus on tree nodes: "Select top 100", "Show DDL", "Copy name",
  "Show in diagram".
- Context menus on the grid: copy cell / row / column, copy as CSV, JSON
  or `INSERT`.
- Workspace state - open tabs, their text, the selected profile - is
  saved to the app database (debounced) and restored on launch.
- The schema tree is built with a headless tree on shadcn primitives;
  shadcn has no tree component.

### Diagrams

The diagram view takes a schema (or a selection of tables), loads
columns and foreign keys through `quel.meta`, lays them out with elkjs
and renders them with React Flow. Export: SVG and PNG of the view, and
text as Mermaid `erDiagram` or DBML. Redshift keys are informational but
declared, so its diagrams work the same way.

## Handler API

The bridge contract. Arguments arrive as let-go values (objects as maps
with string keys); errors reject the frontend's promise with the message.

| Area | Handlers |
|---|---|
| Profiles | `list-profiles`, `save-profile`, `delete-profile`, `test-connection` |
| Connections | `connect`, `disconnect`, `connection-status` |
| Structure | `list-schemas`, `list-objects`, `describe-object`, `object-ddl`, `schema-ddl`, `completion-schema`, `diagram-model` |
| Execution | `classify`, `run`, `fetch-page`, `cancel`, `close-result`, `close-session` |
| Export | `export-ddl`, `export-result` (both open a save dialog) |
| History | `list-history`, `clear-history` |
| Workspace | `load-workspace`, `save-workspace` |

Backend-to-frontend events: menu actions (`menu:new-tab`, `menu:run`,
...), `connection-lost`, `query-finished` for runs the user navigated
away from.

## Development and builds

### Dev loop

`lgx run` starts the app with an nREPL inside it (as in wails-tasks), so
backend handlers are redefined from the editor without a restart. On the
frontend side, `lgx fe-watch` runs `vite build --watch` into
`resources/public`, and the running app reloads the window when it
changes - about a second per edit.

Pointing the window at the Vite dev server (real HMR) does not work yet:
the wails package serves assets through its own handler, which ignores
Wails' `FRONTEND_DEVSERVER_URL` proxy, and a page served from Vite's origin
cannot reach the bridge. That is an upstream change to the wails package,
tracked in the backlog.

### Builds

`lgx build` bundles the app (`lg -b`) with `resources/public` embedded
and the `production` build tag (once an lgx release carries
`:go/build-tags`; lgx 0.5.0 does not, so builds keep Wails' devtools for
now). Packaging into a `.app`, icons, a dmg,
signing and notarization is the `wails3` CLI's job on the built binary.

`:target :native` is a later goal, not on the critical path. It cannot
build Quel today: native binaries do not embed `:resource-paths`, and
`:go/build-tags` under `:targets :bin` is rejected for native targets. The
code stays native-compatible so switching later is cheap:

- the entry namespace is `quel.app`, not `main` (`lg compile` rejects a
  namespace whose last segment is `main`);
- `:main` starts with an `ns` form and calls `(-main)` inside
  `(when-not *compiling-aot* ...)`;
- no `with-redefs` / `alter-var-root` in application code;
- no SQL or other runtime data loaded from resources.

### Testing

- **Backend**: `lgx test` against SQLite and DuckDB in-process, and
  Postgres in Docker. Redshift has no local stand-in: its catalog tests
  run against a real cluster, gated on an environment variable.
- **Frontend**: Vitest for pure logic (the splitter, cell rendering).
- **End to end**: Playwright against the app in Wails' server mode, the
  way wails-tasks' smoke test runs.

## Upstream work

Quel depends on these changes outside this repo. Each is a reusable
package feature, not app glue.

| Where | Change | Needed by |
|---|---|---|
| `letgo-packages/sql` | Done in `sql-v0.3.0`: `NewCtx`/`QueryCtx`/`ExecCtx` (cancellable queries), `Conn` (sessions), a `Connectable` covering `*sql.Conn`, `ColumnTypeNames`; the shim ships in-tree | cancellation, per-tab sessions, column types |
| `letgo-packages/wails` | Proxy `FRONTEND_DEVSERVER_URL` in the asset handler | Vite HMR in the dev loop |
| new `letgo-packages/keyring` | Keychain access, e.g. over `zalando/go-keyring` | saved passwords |
| new `letgo-packages/ssh` | SSH tunnels over `x/crypto/ssh` (shim-only: struct config and callbacks) | later |
| `lgx` / let-go | Resource embedding and per-target build tags for `:target :native` | the native build |

## Milestones

0. **Spike and project setup - SQLite.** The project skeleton, and a
   Vite + React page that calls let-go handlers through
   `@wailsio/runtime`: open a SQLite file, run a query on a session,
   cancel a runaway one. Land the `sql` context support. The spike ran
   against SQLite rather than Redshift to stay local. Done 2026-10-21:
   automated checks in server mode on 2026-10-19, the native macOS pass
   on 2026-10-21.
1. **Workhorse core - Redshift and SQLite.** Starts with the Redshift
   checks the spike skipped (see [Unverified](#unverified)): pgx connects
   and queries, a cancel reaches the cluster, the catalog sources behave.
   Then profiles and Keychain;
   structure tree (schemas, tables, views, columns); editor with
   highlighting and completion; run statement, selection or script; paged
   grid with cancel; result tabs with pinning; errors; history; workspace
   restore.
2. **Structure.** Indexes / dist and sort keys, constraints, functions,
   procedures, table info; DDL view and export; write confirmation and
   read-only profiles; `Cmd+K`.
3. **PostgreSQL and DuckDB.**
4. **Diagrams and export.** ER diagrams with export; results to CSV and
   JSON; copy-as formats.
5. **Later.** SSH tunnels, Redshift IAM authentication, inline editing,
   Redis, `:target :native`, Linux, signed and notarized releases.

## Unverified

Assumptions this design rests on that have not been checked yet. The spike
settles them; update this section when it does.

- pgx (through `database/sql`) connects to Redshift and runs queries
  without type or protocol errors. Fallback:
  `default_query_exec_mode=simple_protocol` in the DSN.
- Cancelling a context sends a cancel request that Redshift honours.
- The Redshift catalog sources in the introspection table behave as
  described, including `SHOW TABLE` and `svv_all_*` permissions for
  non-superusers.

### Settled by milestone 0 (2026-10-19 and 2026-10-21)

- The bridge works from a Vite-built page served by the wails package,
  with `@wailsio/runtime` 3.0.0-beta.30 from npm (the version the package
  pins): handlers answer, events arrive, a thrown error rejects the
  promise with its message. Checked in server mode with headless Chromium.
  The Vite dev server is not used; see [Dev loop](#dev-loop).
- Column types: `sql.shim/ColumnTypeNames` returns them as strings.
- Cancelling a context stops a running SQLite query promptly (modernc
  calls `sqlite3_interrupt`; the error is `context canceled`), and a
  cancel can arrive before the first row. The session stays usable.
- `sql.core/returns-rows?` misroutes two SQLite cases: `PRAGMA` returns
  rows, and a `WITH` whose outer statement writes does not.
  `quel.exec/rows?` handles both; `quel.classify` will build on it.
- let-go 1.13.0's `(str (random-uuid))` is the tagged `#uuid "..."` form,
  unlike Clojure's; `quel.conn` extracts the bare UUID.
- The native macOS window (macOS 26.7.1, arm64; 2026-10-21): the wails
  package's v0.2.0 window, menus (app, File, Edit, Window), the open-file
  dialog and accelerators work; cancel ends the runaway query with the
  window responsive; `fe-watch` reloads the window and an nREPL
  redefinition takes effect on the next call; `lgx build && ./bin/quel`
  and `open bin/quel` show the embedded page; `Cmd+Q` exits cleanly.

## Open questions

- **Distribution.** Signing and notarization need a paid Apple Developer
  account. Without it, the app ships unsigned and users clear the
  quarantine flag. Decide before the first public release.
- **Frontend state outside TanStack Query** (tabs, layout): plain React
  context or a small store such as zustand.
- **Redshift authentication** beyond user and password: IAM
  (`GetClusterCredentials`, Serverless `GetCredentials`) or SSO - which
  ones, and when.
