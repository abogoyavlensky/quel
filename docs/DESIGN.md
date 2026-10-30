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
| Grid | TanStack Virtual (rows and columns), a hand-written column model |
| App state | zustand; TanStack Query for metadata reads (from the structure browser on) |
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
| `quel.workspace` | Each profile's saved editor tabs and recently closed tabs, and the selected profile, in the app database. |
| `quel.secrets` | Passwords in the macOS Keychain, keyed by profile id. Never in the app database. |
| `quel.conn` | Opens a pool per connected profile, hands out sessions, tracks connection state. |
| `quel.exec` | Runs statements, owns the result registry, paging and cancellation. |
| `quel.cells` | Converts driver values into the cell encoding the grid renders. |
| `quel.classify` | Decides whether a statement reads or writes. |
| `quel.meta` | The introspection protocol: a multimethod per operation, dispatched on `:engine`. |
| `quel.meta.redshift`, `.sqlite`, `.postgres`, `.duckdb` | Catalog SQL and DDL generation per engine. `quel.meta.postgres` covers Redshift too until Redshift-only catalog work (dist and sort keys, external schemas) needs `quel.meta.redshift`. |
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
password lives in the Keychain under the profile id: the item's service is
`Quel` and its account the profile id. The profile row keeps only
`has_password`, so a profile without one never asks the Keychain, and a
SQLite profile never has one. Names are unique, ignoring case. Read-only
and the confirm policy arrive with milestone 2, in their own migration.

A Postgres or Redshift profile connects through a key/value DSN built
from its fields, every value quoted (`quel.conn/dsn-quote`), so no URL
encoding is involved. A profile with no saved password leaves the key out,
and pgx's `PGPASSWORD` and `.pgpass` fallbacks apply as in `psql`. Errors
are redacted with the password in its raw and DSN-escaped forms, and pgx's
own parse errors drop the DSN it quotes. Every SQLite file opens as a
`file:` URI, so a `?` or `#` in its path stays part of the name. A file
The UI connects only through profiles: File > Open Database… (`⌘O`)
turns the chosen SQLite file into a new profile, filled in for Save. The
`open-db` handler still opens a bare path or URL, for the smoke test.

### The app database

`quel.store` keeps SQLite at `~/Library/Application Support/Quel/quel.db`
on macOS (`$XDG_DATA_HOME/quel` or `~/.local/share/quel` elsewhere;
`QUEL_DATA_DIR` overrides both), migrated on start with ragtime from
`quel.migrations`, whose SQL is inline. The pragmas (`foreign_keys`,
`busy_timeout`, WAL) are in the DSN, so every pooled connection gets them.
Profile saves and deletes are serialised, since each changes the Keychain
and the table together. `QUEL_SECRETS=memory` swaps the Keychain for an
in-memory store; the smoke and e2e runs set it, with a temporary
`QUEL_DATA_DIR`.

Besides `profiles`, it has `editor_tabs` (each profile's tabs: title,
text, pinned, position, selection, and `closed_at`, set while the tab is
in the recently closed list), `workspaces` (each profile's active tab and
next "Query N" number) and `settings` (app-wide values: the selected
profile). Tabs and the workspace row go with their profile (`on delete
cascade`). See [Saved tabs](#saved-tabs).

Connecting a profile opens one `database/sql` pool. Two kinds of work use
it:

- **Metadata** (the structure tree, completion, DDL) takes any pooled
  connection.
- **Each editor tab gets its own session**: a dedicated `*sql.Conn` taken
  on the tab's first run and held while the tab is open; the tab's id is
  its session-id. Session state (`BEGIN` ... `COMMIT`, `SET search_path`,
  temp tables) therefore behaves the way it does in `psql`. The editor is
  to show when a tab's session is inside an open transaction, and closing
  such a tab is to ask first; that needs the driver's transaction state
  through a shim (backlog: `open-transaction-indicator.md`).

Sessions come from a second pool per connection that keeps no idle
connections (`SetMaxIdleConns 0`). Closing a session then closes its
connection rather than parking it, so a closed tab's settings, temp tables
or (on SQLite) open transaction never reach whoever takes that connection
next. pgx alone discards a connection returned inside a transaction, but
not one with changed settings, and modernc discards neither.

A closed tab's session-id is retired, and the backend refuses it from then
on. Bridge calls run concurrently, so a run the frontend sent just before
closing the tab can arrive after the close; without the tombstone it would
open a session nothing owns. Closing a session goes in this order: retire
the id, close its query or cursor, then close the connection.

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
of single statements. The editor marks the statement `Cmd+Enter` will run
with a soft block behind its lines, as wide as the longest line (none while
text is selected). The editor's face is JetBrains Mono (bundled, OFL). The Run
button in the editor runs it too, and becomes Stop (`Cmd+.`) after 300ms
of a run.

### Running

`run` takes the tab's session-id and a frontend-generated `query-id`, so
the query can be cancelled before its first row arrives:

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
stored cancel fn. On SQLite, modernc interrupts the statement. On
Postgres and Redshift, pgx sends a protocol cancel request, so the query
stops server-side. pgx's default would then close the connection, killing
the tab's session (its temp tables, `SET`s, open transaction). Quel opens
pools with `{:postgres/cancel :request}` (letgo-packages `postgres-v0.4.0`),
which keeps the connection, as `psql` does after Ctrl+C.

After any failed run, Quel probes the session with `select 1` (bounded by
5 s). A dead connection - a dropped network, a restarted server - is then
dropped, the next run takes a fresh one, and the error ends "The session
was reset." The failed run's own error cannot be trusted to say so: pgx
may report a server `FATAL` or an EOF first. Any other probe failure,
such as an aborted transaction's SQLSTATE 25P02, keeps the session, since
the user still has to `ROLLBACK`.

### Cursor lifetime

An open cursor holds its session's connection, cluster resources on
Redshift, and a read lock on SQLite. The latter means a write from another
tab gets `SQLITE_BUSY` until the cursor is gone. A result with more rows
than its first page keeps its cursor open under its query-id, and
`fetch-page` reads on from it. A session has one cursor at most, since a
connection with open rows cannot run another statement. The cursor closes
when:

- it is read to the end;
- the session runs another statement, so a script's earlier results keep
  the rows they have;
- its result tab is closed or replaced (`close-result`), or its tab closes;
- the database closes;
- it sits unread for five minutes (a sweeper checks every 30 s).

A result whose cursor closed early stays visible and says "Showing N rows:
run again for more".

Closing a cursor differs by engine. SQLite resets the statement, which is
instant. pgx's `Rows.Close` reads and discards the rest of the result. A
cancel would be faster, but inside an explicit transaction it aborts the
transaction, and a script of `begin; select <big>; insert ...` must not
fail because the insert closed the select's cursor. So Quel drains first
and cancels only if draining takes more than a second. A cursor with a lot
left unread is then cancelled after all. Inside a transaction the user
then sees "current transaction is aborted" on the next statement, as after
a cancel in psql. A page that is being read when its cursor closes is
cancelled at once.

### Results and pinning

Each row-returning statement of a run gets its own result tab. A run
first drops the editor tab's unpinned results, so a script's results are
replaced together. A **pinned** tab is never replaced and keeps its rows
until closed; its cursor closes on the next run in its tab, as above.
Every statement's outcome (rows, rows affected, or the error) goes to the
tab's Messages log. An update count shows only for statements that write
rows: SQLite leaves its change counter alone for DDL, and Postgres answers
0. Others say "Done". The first error, or a cancel, stops a script. A
result loads at most 100,000 rows; past that, its cursor is closed and the
result says so.

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
- dates and timestamps (pgx hands them over as Go `time.Time`) become
  ISO-8601 strings shaped by the column type: `DATE` as `2026-10-21`,
  `TIMESTAMP` as `2026-10-21T10:00:00.5`, `TIMESTAMPTZ` with its offset;
- binary values show as `(binary)` for now: the `sql` shim turns `[]byte`
  into a string, which loses Postgres `bytea` bytes. The intended
  truncated hex preview waits on the shim keeping binary values (see the
  backlog);
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

For now Redshift is read through the same `pg_catalog` queries as
Postgres, written in the subset both accept, rather than the `svv_all_*`
views above: Redshift can only be tested once Quel ships as a Homebrew
package, and a wrong query would stay broken for a release cycle. The
Postgres tests run those queries against Postgres. What `pg_catalog`
misses on Redshift (external schemas and datashares, late-binding view
columns) is in `docs/backlog/`, waiting for a cluster.

The structure tree loads lazily, one level per expand. Its queries run on
the connection's pool, not a tab's session, so temp tables and SQLite
`ATTACH`es made in a tab do not show (backlogged). `completion-schema`
returns `{schema {table [columns]}}` for the connected database. From it
the editor completes schema, table and qualified column names (`lang-sql`),
and the bare columns of the tables in the statement under the cursor
(`editor/columns.ts`). Schemas and tables carry their kind, so the popup
marks database objects (S, T, C) and leaves keywords bare. The frontend
caches it and the
tree's levels per connection (TanStack Query) and reloads them only with
the tree's refresh button: running DDL does not refresh anything.

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
┌─────────────────────────────────────────────────────────────────────────┐
│ ● ● ●                     ( ● Prod  Redshift )                          │
├──────────────┬───────────────────────────────────────────┬──────────────┤
│ ● Prod   🔌  │ [Query 1 ×] [Query 2 ×] [+]          [◫]  │ Row 3 of 500 │
│ ○ Local  🔌  │  CodeMirror editor                         │ [filter]     │
│ (selected:   ├───────────────────────────────────────────┤ id           │
│  its tabs →) │ [Messages] [select … 📌 ×] [select … ×]    │ 3            │
│ structure    │  virtualized grid                          │ doc  jsonb ⧉ │
│ tree         │                                           │ { … }        │
└──────────────┴───────────────────────────────────────────┴──────────────┘
 status bar: state (Ready / Running… 12s / Not connected)
```

The strip across the top names the selected connection; the status bar
says only what is happening. The editor has a Run/Stop button at its
bottom right, and the grid footer has the rows and the time.

### Look

- **Layout.** The workspace (tabs, editor, results) is white. The
  sidebar, the top strip and the status bar share one light grey,
  `--chrome`, with hairlines between them. There are no cards; rounding
  is for small pieces: the editor tabs' track, the result chips, the
  statement block, the Run button, the selected connection.
- **One accent.** Indigo is `--primary`. It marks selection, focus, the
  caret, the active result chip, the selected row and connection, and
  Run, a soft indigo tint like the active chip. Toasts, dialogs and menus
  share the same card shape and the soft accent for their actions.
- **Tag colours.** A profile's tag shows as its dot everywhere, and as a
  tint only in the top strip, where it also colours the name. Text uses
  the tag's ink token (`--color-tag-*-ink`, about L 0.5), because the
  tags are tuned as dots and yellow cannot be read as text. Selection
  and focus never take a tag's colour.
- **Sizes.** Small text is 14.5px (`--text-xs`) and body text 15.5px
  (`--text-sm`). The editor is JetBrains Mono at 16px with ligatures
  off, so `<>` and `>=` read as typed. Grid rows are 34px with every
  other row banded; tree rows 32px; connection rows 38px.
- **Connections.** Each row always shows its button: a plug to connect,
  a grey stop to disconnect (play is Run's icon, so it is not reused). The pencil shows on hover, and a
  right-click offers Connect or Disconnect, Edit… and Delete….
- **The window.** On macOS the title bar is hidden (`:mac-title-bar
  :hidden`): the top strip is the drag area
  (`--wails-draggable: drag`) and the traffic lights float over its left
  end. The strip is 36px, the status bar's height, so the tint shows
  around the connection pill; the standard title bar's lights sit a few
  pixels above its centre. Its content is centred, so it needs no room for them, and
  fullscreen needs nothing.
- **Light only**, for now; themes come later as a setting
  (`docs/backlog/themes-setting.md`). Mix colours in `oklab`: an `oklch`
  mix of a tag into the cool grey swings the hue through blue.

The values live in `frontend/src/index.css`.

The right-hand column is the row details panel, there only while open
(see [Row details](#row-details)).

The sidebar lists the saved profiles, each with its status mark (filled
when connected, a hollow ring when not, pulsing while connecting) and a
Connect/Disconnect button.

App state lives in a zustand store. The run flow (`state/runner.ts`) is
plain async functions over it and the handlers, so menu events and
keymaps call the same code and tests mock only the bridge. One statement
or page is in flight per editor tab: a run while one is in flight is
dropped, which also makes a shortcut that both the native menu and the
editor see harmless. After every await, the runner checks that the tab
still exists, and a closed tab's late reply is dropped. Each tab's
CodeMirror `EditorState` (document, selection, undo history) is kept
outside the store and swapped into the one editor on tab change.
TanStack Query is for metadata reads, from the structure browser on.

The frontend splits statements itself (`sql/split.ts`): quotes,
dollar quotes, comments, Postgres arrays versus SQLite `[identifiers]`,
and the bodies of SQLite triggers and `BEGIN ATOMIC` functions, where a
`;` does not end the statement.

- `Cmd+K` (shadcn `Command`) jumps to any table, view or function and
  opens its structure, data or DDL.
- Context menus on tree nodes: "Select top 100", "Show DDL", "Copy name",
  "Show in diagram".
- Context menus on the grid: copy cell / row / column, copy as CSV, JSON
  or `INSERT`.
- Workspace state - open tabs, their text, the selected profile - is
  saved to the app database (debounced) and restored on launch; see
  [Saved tabs](#saved-tabs).
- The schema tree is built with a headless tree on shadcn primitives;
  shadcn has no tree component.

### Row details

A click on a result row selects it, and ↑/↓ move the selection while the
grid has focus. The selection belongs to the result (`selectedRow`, in
memory): each result tab keeps its own, a pinned result keeps it across
runs, and a new run's results start without one.

The row details panel shows the selected row of the active result, one
read-only block per column, and follows the selection, the result tab,
the editor tab and the profile. It opens and closes with the tab bar's
button, `⌘I` (`Ctrl+I`), or a double-click on a row, which only opens.
A single click never opens it. `⌘I` is caught on `window` in the capture
phase rather than made a native menu item: CodeMirror binds `Mod-i`
itself, and a toggle cannot take the double delivery (menu plus page)
that Run tolerates. The panel's open state is app-wide and in memory.

JSON values are formatted and highlighted: values of `JSON`, `JSONB` and
`SUPER` columns, and in SQLite text that starts with `{` or `[`.
Formatting re-indents the value's own text (`grid/json.ts`) instead of
`JSON.stringify(JSON.parse(v))`, which would round big integers and
rewrite `1.10` as `1.1`; `JSON.parse` only checks validity. Values over
256 KiB, or whose formatted text would pass 1 MiB (deep nesting), show
as plain text. Highlighting is `@lezer/json` through `highlightCode`
with the SQL editor's colour variables.

Each value's copy button copies it as stored (never the formatted
JSON) and is disabled for NULL. "Copy row as JSON" maps column names to
cells, with a suffix on repeated names (`id`, `id_2`). Copying tries
`navigator.clipboard` and falls back to the Wails runtime's clipboard.

### Workspaces

Each profile has a **workspace**: its connection status and conn-id, its
editor tabs, and each tab's results and messages. Workspaces live in
memory for the app's run; a profile's is loaded from the app database the
first time it is selected and dropped when the profile is deleted. Its
tabs are saved as they change (see [Saved tabs](#saved-tabs)); its
results, messages and connection are not.

- **Select** (a click on a profile row) shows that workspace, connected
  or not; it never connects. The editor's dialect comes from the
  profile's engine, so a disconnected workspace is still editable.
- **Connect** and **Disconnect** (the row's button, or the structure
  panel's Connect) act on one profile and leave the selection and every other
  workspace alone, so several profiles can be connected at once.
  Disconnecting closes the profile's database on the backend (its
  sessions, cursors and pool) and marks its open results closed; the tabs
  and their text stay.
- **Running** (⌘Enter, ⌘⇧Enter, the Run button, the menu) on a workspace
  that is not connected sends nothing and says so, at once in a toast with
  a Connect button, and in the results: the
  empty tab's message, or a banner above the results, with a Connect
  button that only connects. The banner stays until the profile connects.
  While connecting, a run is dropped.
- The menu's tab actions (new, close, run, cancel) act on the selected
  workspace's active tab.
- A connect error shows under its profile's row.

Tab ids stay globally unique (they are backend session ids), so the
runner addresses a tab by id and finds its workspace by scanning. A run
checks the tab's own workspace's conn-id after every await: if the
profile disconnected (or reconnected) meanwhile, its cursor is gone.

Every editor tab that has run something holds one backend session, and
so one connection, per connected profile. Disconnecting a profile
releases all of them; there is no idle release yet.

### Saved tabs

Per profile, `quel.workspace` keeps each open tab's id, title, text,
pinned flag, position and selection; the active tab; the next "Query N"
number; and the 20 most recently closed tabs. App-wide, it keeps the
selected profile. Results, messages, undo history and running state are
not saved, and nothing connects on launch: the last selected profile's
workspace shows, disconnected (the first profile when that one is gone).

- **Loading.** A workspace's tabs are read the first time its profile is
  selected; each is seeded with its text and selection, which become its
  CodeMirror state when it is first shown. If the read fails, the
  workspace shows the error and a Retry, and is never saved, so a failed
  read cannot overwrite the saved tabs.
- **Saving.** Each profile has a queue of operations (save, close,
  reopen) that run in order, one at a time. An edit, a selection change
  or any tab change schedules a save 800 ms later; the save is built from
  the state when it runs. Pending saves go out at once when the window
  hides or the page goes away. A failed save shows in the status bar and
  is retried on the next change. The selected profile is written only on
  a user's click, never by the start-up fallback.
- **Closing** sends the tab's title and text as they are at that moment
  (`close-tab`), after any pending save, so the text typed just before
  closing is what is kept; a blank tab is deleted rather than kept. A run
  in flight is cancelled, and the tab's session closes only once the
  close has worked: if it fails, the tab comes back as it was.
- **Reopening** (the history menu at the end of the tab bar, or ⌘⇧T for
  the most recent) runs on the same queue, after the close that listed
  the tab. The backend gives the tab a new id: the old one is a retired
  session id on a connection that may still be open.
- **Pinned** tabs come first and cannot be closed (⌘W, the middle click
  and Close say "Unpin the tab to close it."). Tabs are renamed by a
  double-click or the tab's context menu; names need not be unique.

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
| Profiles | `list-profiles`, `save-profile`, `delete-profile`, `test-connection` (the form as it stands, saved or not; saves nothing), `choose-file` (a SQLite file, through a native dialog) |
| Connections | `connect` (a profile id), `close-db` (disconnect), `connection-status`; `open-db` (a bare path or URL, used by the smoke test, not the UI) |
| Structure | `list-schemas`, `list-objects` (a schema's tables and views), `list-columns`, `completion-schema`; later `describe-object` (table info), `object-ddl`, `schema-ddl`, `diagram-model` |
| Execution | `classify`, `run`, `fetch-page`, `cancel`, `close-result`, `close-session` |
| Export | `export-ddl`, `export-result` (both open a save dialog) |
| History | `list-history`, `clear-history` |
| Workspace | `load-workspace`, `save-workspace` (a profile's tabs), `close-tab` (a tab into the closed list, with its final text), `reopen-tab` (out of it, under a new id), `selected-profile`, `select-profile` |

Backend-to-frontend events: menu actions (`menu:new-tab`, `menu:run`,
...), `connection-lost`, `query-finished` for runs the user navigated
away from.

## Development and builds

### Dev loop

`lgx run` starts the app with an nREPL inside it (as in wails-tasks), so
backend handlers are redefined from the editor without a restart. On the
frontend side, `lgx dev` runs Vite's dev server and the app with
`FRONTEND_DEVSERVER_URL` pointing at it. The wails package (v0.3.0) then
proxies the page's assets from Vite through Wails' own handler, so the
page keeps Wails' origin and reaches the bridge, while Vite's HMR
websocket goes to Vite directly (`server.ws.clientPort`). An edit applies
in place and keeps React state. Without the dev server, `lgx fe-watch`
rebuilds into `resources/public` and the running app reloads the window,
about a second per edit.

### Builds

`lgx build` compiles the app natively (`:target :native`, lgx 0.5.2): let-go
lowers Quel's own namespaces to Go, its dependencies run as embedded
bytecode, and `go build` links the result with the custom runtime's Go
packages. The binary is a plain Go executable, so it can be codesigned;
an `lg -b` bundle appends its payload after the executable and fails
`codesign --verify --strict`. `resources/public` is embedded through
`go:embed`, and the `production` build tag (`:go/build-tags`) drops Wails'
devtools and dev asset server and makes the wails package ignore
`FRONTEND_DEVSERVER_URL`. `:lg-version` pins a let-go `main` commit, because
`lg compile -module` and `-import` came after 1.13.0.

Only Quel's namespaces are lowered (lgx's default `:lower :project`).
Lowering a dependency that uses syntax-quoted macros from its own namespace
fails to compile today (nooga/let-go#1098). `lgx run`, `dev` and the tests
run bytecode, so a native-only failure shows up in `lgx build`.

The code has to stay compatible with the native build:

- the entry namespace is `quel.app`, not `main` (`lg compile` rejects a
  namespace whose last segment is `main`);
- `:main` starts with an `ns` form and calls `(-main)` inside
  `(when-not *compiling-aot* ...)`;
- no `with-redefs` / `alter-var-root` in application code;
- no SQL or other runtime data loaded from resources.

### Releases

Quel ships as a signed and notarized `Quel.app` for Apple Silicon and
macOS 15+, installed through a Homebrew cask in `abogoyavlensky/homebrew-tap`;
[RELEASE.md](RELEASE.md) is the procedure. `lgx package-macos` wraps the
native binary into the bundle (bundle ID `io.github.abogoyavlensky.quel`,
version from `VERSION`, deployment target 15.0 for cgo, the linker and
`Info.plist` alike, the icon from `build/macos/icon.png`).
`scripts/sign-macos.sh` signs with Developer ID, hardened runtime and a
secure timestamp, with no entitlements: none proved necessary. It
notarizes, staples, and only then writes the zip and `checksums.txt`. A
`v*` tag runs it on a `macos-15` runner with the certificate in a
temporary keychain, publishes the GitHub Release and regenerates
`Casks/quel.rb`. The cask has no `zap`, so an uninstall keeps profiles,
tabs and passwords. No Intel or universal build, DMG, in-app updater or
App Store: users upgrade through Homebrew.

### Testing

- **Backend**: `lgx test` against SQLite (and later DuckDB) in-process.
  `lgx test-pg` runs the same suite with a throwaway Postgres in Docker
  (`scripts/with-postgres.sh` sets `QUEL_PG_URL`); without it the Postgres
  tests skip. CI runs `test-pg`.
- **Redshift**: no Docker image runs it. LocalStack's Redshift is a paid
  plan that emulates the AWS API, not the SQL engine. Postgres covers
  what Quel does over pgx (connect, query, sessions, cancel, value types);
  the Redshift-specific questions under [Unverified](#unverified) wait for
  a real cluster.
- **Frontend**: Vitest for logic: the splitter, statement targeting, cell
  display and widths, and the runner against a mocked bridge.
- **End to end**: `lgx smoke` drives the app in Wails' server mode over
  HTTP; `lgx smoke-pg` adds Postgres (open, cancel, the session
  surviving, paging). `lgx e2e` drives the UI with Playwright in server
  mode: paging as the grid scrolls, scripts, pinning, cancel, and one
  session per tab. CI runs all three.
- **The macOS app**: server mode never compiles the desktop build, so it
  is checked on its own. `lgx package-macos && lgx verify-macos` on an
  Apple Silicon Mac builds the real app, checks the bundle, architecture,
  deployment target, linked libraries and build tags, and launches an
  ad-hoc signed copy with `QUEL_SECRETS=memory` and a scratch
  `QUEL_DATA_DIR`. CI's `macos` job runs it on every PR. The launch
  check is liveness only; the window, frontend and bridge need a manual
  pass (`open -n --env QUEL_SECRETS=memory --env QUEL_DATA_DIR=...`).
  `lgx test-release` covers the signing, cask, publishing and tap scripts
  with stand-ins for Apple's tools and GitHub.

## Upstream work

Quel depends on these changes outside this repo. Each is a reusable
package feature, not app glue.

| Where | Change | Needed by |
|---|---|---|
| `letgo-packages/sql` | Done in `sql-v0.3.0`: `NewCtx`/`QueryCtx`/`ExecCtx` (cancellable queries), `Conn` (sessions), a `Connectable` covering `*sql.Conn`, `ColumnTypeNames`; the shim ships in-tree | cancellation, per-tab sessions, column types |
| `letgo-packages/postgres` | Done in `postgres-v0.4.0`: `:postgres/cancel :request` (a cancel keeps the connection), a 10 s connect timeout unless one is set | sessions that survive a cancel |
| `letgo-packages/sql` | `ScanRow` keeps binary values as bytes (today `[]byte` becomes a string) | the bytea / BLOB preview |
| `letgo-packages/wails` | Done in `wails-v0.3.0`: the asset handler proxies `FRONTEND_DEVSERVER_URL` (dev builds only) | Vite HMR in the dev loop |
| `letgo-packages/keyring` | Done in `keyring-v0.1.0`: `put!`, `get`, `delete!` over `zalando/go-keyring` (macOS Keychain, Secret Service), and `use-memory!` for tests | saved passwords |
| new `letgo-packages/ssh` | SSH tunnels over `x/crypto/ssh` (shim-only: struct config and callbacks) | later |
| `lgx` | Done in lgx 0.5.2: `:target :native` embeds `:resource-paths`, lowers only project namespaces, and takes `:go/build-tags` under `:targets :bin` | the native build |

## Milestones

0. **Spike and project setup - SQLite.** The project skeleton, and a
   Vite + React page that calls let-go handlers through
   `@wailsio/runtime`: open a SQLite file, run a query on a session,
   cancel a runaway one. Land the `sql` context support. The spike ran
   against SQLite rather than Redshift to stay local. Done 2026-10-21:
   automated checks in server mode on 2026-10-19, the native macOS pass
   on 2026-10-21.
1. **Workhorse core - Redshift and SQLite.** First slice done 2026-10-22:
   Postgres and Redshift URLs open, run and cancel with the session
   surviving, tested against Postgres in Docker. The Redshift-specific
   checks (see [Unverified](#unverified)) wait for a cluster. Second
   slice done 2026-10-22: editor tabs with a session each; CodeMirror
   with highlighting and keyword completion; run statement, selection or
   script; a virtualized grid paging through open cursors, with cancel;
   result tabs with pinning; the messages log; HMR in the dev loop;
   checked in the native macOS window as well. Third slice done
   2026-10-23: connection profiles in the app database, their passwords
   in the Keychain, created, tested, edited and connected from the
   database panel. Structure tree done 2026-10-24: schemas, tables,
   views and columns in the sidebar, schema completion in the editor,
   one refresh button; Redshift through `pg_catalog`, unverified. Then
   history. Workspace restore done
   2026-10-23: each profile's editor tabs, their names, pins and text,
   and recently closed tabs, saved as they change and restored on
   launch with the selected profile. Row details done 2026-10-24: a
   selectable row in the grid and a read-only panel of its values, JSON
   formatted and highlighted, values and rows copied.
2. **Structure.** Indexes / dist and sort keys, constraints, functions,
   procedures, table info; DDL view and export; write confirmation and
   read-only profiles; `Cmd+K`.
3. **PostgreSQL and DuckDB.**
4. **Diagrams and export.** ER diagrams with export; results to CSV and
   JSON; copy-as formats.
5. **Later.** SSH tunnels, Redshift IAM authentication, inline editing,
   Redis, Linux.

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
- The structure tree on Redshift (first released build, against a real
  cluster, as a non-superuser): `list-schemas`, `list-objects`,
  `list-columns` and `completion-schema` answer; Redshift's internal
  schemas stay hidden (the filter drops `pg_*` and
  `information_schema` only); and how long `completion-schema` takes on
  a large cluster.
- The released app, installed from the cask and launched from Finder,
  saves and reads a profile's password in the Keychain under the hardened
  runtime (checked at the first release, with a scratch profile).

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

- **Redshift authentication** beyond user and password: IAM
  (`GetClusterCredentials`, Serverless `GetCredentials`) or SSO - which
  ones, and when.
