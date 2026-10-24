# Structure Tree and Schema Completion Implementation Plan

**Status: completed**

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A connected profile's schemas, tables, views and columns appear in a lazily loaded tree in the sidebar, and the SQL editor completes that database's schema, table and column names.

**Tech Stack:** let-go (`quel.meta` multimethods over `sql.core`), SQLite (modernc, `pragma_*` table-valued functions), Postgres/Redshift (pgx, `pg_catalog`); React 19, TanStack Query (new dependency), zustand, `@tanstack/react-virtual`, CodeMirror `lang-sql`; Vitest, Playwright.

---

## Design

### Where this starts

Milestone 1 in `docs/DESIGN.md` has two items left: "structure tree
(schemas, tables, views, columns) and schema completion", and history.
This plan covers the first. Nothing of it exists yet: there is no
`quel.meta`, and the editor completes keywords only
(`frontend/src/editor/setup.ts`, `language` compartment).

Cut a branch `structure-tree` from master.

### Scope

In:

- Backend `quel.meta`: `schemas`, `objects`, `columns`, `completion-schema`,
  as multimethods on the engine, for `:sqlite`, `:postgres` and `:redshift`.
- Handlers `list-schemas`, `list-objects`, `list-columns`,
  `completion-schema`.
- A structure tree in the sidebar for the selected, connected profile:
  schema → Tables / Views groups → object → columns, one query per expand,
  keyboard navigable and virtualized.
- Schema-aware completion in the editor.
- One refresh button that reloads everything cached for the connection.
  Nothing refreshes on its own.

Out (milestone 2 or the backlog): indexes, keys, constraints, functions,
procedures, sequences, table info, DDL, context menus ("Select top 100",
"Copy name"), `Cmd+K`, primary-key or nullability markers on columns,
Redshift external schemas and datashares, Redshift late-binding view
columns, and objects that only exist in one tab's session (temp tables,
SQLite `ATTACH`).

### Redshift: the Postgres catalog first, not `svv_all_*`

`docs/DESIGN.md`'s introspection table names `svv_all_schemas`,
`svv_all_tables` and `svv_all_columns` for Redshift. Redshift can only be
tested once Quel ships as a Homebrew package for macOS. A Redshift query
that is wrong would then stay broken for a full release cycle, with no
nREPL in the shipped binary to patch it.

So this slice reads Redshift through the same `pg_catalog` tables as
Postgres (`pg_namespace`, `pg_class`, `pg_attribute`, `format_type`),
which Redshift has from its PostgreSQL 8.0 base. Every query is written in
the subset both engines accept: no `relispartition`, `string_agg`,
`array_agg`, `format()` or `"char"` columns in results (a `CASE` maps
`relkind` to a string instead). The Redshift variants differ from the
Postgres ones only where Postgres needs more (Postgres hides partitions
with `not c.relispartition`; Redshift has no such column). The Postgres
tests in Docker also run the `:redshift` methods against Postgres. That
checks they parse and return the right shape, but proves nothing about
Redshift itself.

What this misses on Redshift is backlogged (Task 10): external (Spectrum)
schemas and datashares, which `pg_class` does not list, and late-binding
views, whose columns `pg_attribute` does not hold (they show "No
columns"). DESIGN's "Unverified" section gets the Redshift checks to run
on the first released build.

Redshift and Postgres share one namespace, `quel.meta.postgres`. A
separate `quel.meta.redshift` (DESIGN's namespace table) is created when
Redshift-only catalog work arrives (dist and sort keys, external schemas).

### What the tree shows comes from the pool

Metadata queries run on the database's shared pool (`conn/db`), never on a
tab's session: browsing must not queue behind a running query, and a
session can hold an open cursor. As a result, objects that live in one
connection only do not appear: Postgres temp tables (`pg_temp_*` is
filtered out anyway) and SQLite temp tables and `ATTACH`ed files. SQLite's
`temp` schema is left out of the list, since the pool's temp schema is not
any tab's. Backlogged in Task 10.

DDL inside an open transaction appears only once it commits.

### Backend: `quel.meta`

`src/quel/meta.lg` holds the protocol and the engine-independent parts:

```clojure
(defmulti schemas (fn [engine _db] engine))
;; => [{:name "public" :default true} {:name "sales" :default false}]

(defmulti objects (fn [engine _db _schema] engine))
;; => [{:name "users" :kind "table"} {:name "active_users" :kind "view"}]
;; :kind is "table", "view" or "materialized-view"; sorted by name.

(defmulti columns (fn [engine _db _schema _name] engine))
;; => [{:name "id" :type "integer"} {:name "email" :type "text"}]
;; in column order. An unknown object returns [].

(defmulti completion-rows (fn [engine _db] engine))
;; => [{:schema "public" :tbl "users" :col "id"} ...]
;;    ordered by schema, table, column position

(defn completion-schema [engine db] ...)
;; => {:default-schema "public"
;;     :schemas {"public" {"users" ["id" "email"]}}}
;; Built from completion-rows and schemas; table and column names keep
;; their order. Capped at completion-limit (50 000) columns.
```

`:default-schema` is the schema whose `:default` is true in `schemas`
(`main` for SQLite, `current_schema()` for Postgres/Redshift), or nil.

The `:schemas` map has string keys, so the bridge sends schema and table
names as they are. Keyword keys would be lowered too, but a name like
`a/b` would not survive being a keyword.

`quel.meta` does not require the engine namespaces (they require it to add
their methods). `quel.api` requires `quel.meta.sqlite` and
`quel.meta.postgres` for their side effects, with a comment saying so. A
`defmethod` redefined from the nREPL takes effect on the next call.

`src/quel/meta/sqlite.lg`:

- `schemas`: `select name from pragma_database_list where name <> 'temp'
  order by seq`; `:default` is `(= "main" name)`.
- `objects`: `select name, type from pragma_table_list where schema = ?
  and type in ('table', 'view', 'virtual') and name not like 'sqlite\_%'
  escape '\' order by name`; `virtual` maps to `"table"`. `shadow` tables
  (FTS internals) are left out. modernc v1.57.0 is SQLite 3.5x, so
  `pragma_table_list` (3.37+) is there.
- `columns`: `select name, type from pragma_table_xinfo(?, ?) where hidden
  <> 1 order by cid`, with the table, then the schema. `table_xinfo`, not
  `table_info`: the latter omits generated columns (`hidden` 2 and 3),
  which are queryable; `hidden` 1 is a virtual table's hidden column.
- `completion-rows`: `objects` per schema, then `columns` per object,
  catching errors per object. A view over a dropped table makes
  `pragma_table_info` fail, and that must not lose the rest. Local file,
  so N small queries are cheap.

`src/quel/meta/postgres.lg`, with `$1`/`$2` parameters:

- `schemas` (both engines):
  `select nspname as name, nspname = current_schema() as is_default from
  pg_namespace where nspname not like 'pg\_%' and nspname <>
  'information_schema' order by nspname`.
- `objects`: `pg_class` joined to `pg_namespace` on the schema name,
  `relkind in ('r', 'p', 'v', 'm', 'f')`, kind as `case c.relkind when 'v'
  then 'view' when 'm' then 'materialized-view' else 'table' end`. Postgres
  adds `and not c.relispartition`; Redshift does not.
- `columns` (both engines): `pg_attribute` joined to `pg_class` and
  `pg_namespace` on schema and table name, `a.attnum > 0 and not
  a.attisdropped`, type as `format_type(a.atttypid, a.atttypmod)`,
  ordered by `a.attnum`.
- `completion-rows`: one query, the joins of `objects` and `columns`,
  the same schema filter, ordered by `n.nspname, c.relname, a.attnum`,
  `limit 50000`. Postgres adds the `relispartition` filter.

Errors are the driver's, as `quel.exec` passes them on today. A catalog
query on a pool has no timeout of its own. pgx's 10 s connect timeout
covers a dead host at connect; a hung catalog read is not expected and is
not handled here.

### Handlers

In `quel.api`, each takes the conn-id from the frontend and looks up the
engine and pool with `conn/engine` and `conn/db`:

| Handler | Arguments | Reply |
|---|---|---|
| `list-schemas` | conn-id | `[{:name :default}]` |
| `list-objects` | conn-id, schema | `[{:name :kind}]` |
| `list-columns` | conn-id, schema, name | `[{:name :type}]` |
| `completion-schema` | conn-id | `{:default-schema :schemas}` |

DESIGN's Structure row changes to these four, followed by the milestone 2
ones (`describe-object` for table info, `object-ddl`, `schema-ddl`,
`diagram-model`).

### Frontend: data

TanStack Query, as DESIGN plans ("TanStack Query is for metadata reads,
from the structure browser on"). `frontend/src/lib/query.ts` exports the
one `queryClient` (no retries: a failed catalog read shows its error and a
Retry; `staleTime: Infinity`: cached metadata is reloaded only when the
user asks) and the keys:

```ts
export const metaKeys = {
  all: (connId: string) => ["meta", connId] as const,
  schemas: (connId: string) => ["meta", connId, "schemas"] as const,
  objects: (connId: string, schema: string) => ["meta", connId, "objects", schema] as const,
  columns: (connId: string, schema: string, name: string) => ["meta", connId, "columns", schema, name] as const,
  completion: (connId: string) => ["meta", connId, "completion"] as const,
};
```

Keys hold the conn-id, so a reconnect (a new conn-id) never sees the old
connection's data. The runner calls `queryClient.removeQueries({ queryKey:
metaKeys.all(connId) })` once a disconnect finishes.

Refresh is manual only. The tree's refresh button invalidates
`metaKeys.all(connId)`: the schemas, every loaded objects and columns
list, and the completion schema reload together. Running DDL does not
refresh anything on its own: a new table appears after a refresh, as in
TablePlus. This keeps out a statement-guessing heuristic and its edge
cases (DDL inside a transaction is visible to the pool only after it
commits, SQLite's `RELEASE` can commit, procedures can run DDL). An
automatic refresh can be added later if the manual one proves tedious.

`main.tsx` wraps `<App />` in `QueryClientProvider`.

### Frontend: the tree

The sidebar becomes a vertical `ResizablePanelGroup`: the connections list
on top (as now), the selected profile's structure below
(`components/StructureTree.tsx`). Its header reads "Structure" with a
refresh button. Its body shows one of:

- no profile selected: nothing;
- not connected: "Not connected." and a Connect button (`connectProfile`);
- connecting: "Connecting…";
- connected: the tree.

Node kinds and keys (`JSON.stringify` of the path, so names with any
characters are safe):

| Node | Key | Children |
|---|---|---|
| schema | `["s", schema]` | the Tables and Views groups that have members, from `list-objects` |
| group | `["g", schema, "tables" \| "views"]` | its objects, by name. Views include materialized views. |
| object | `["o", schema, name]` | its columns, from `list-columns` |
| column | `["c", schema, name, column]` | none |

`frontend/src/state/tree.ts` is pure and unit-tested:

```ts
export type TreeRow =
  | { key: string; depth: number; kind: "schema" | "group" | "object"; label: string;
      detail?: string; // a group's count, an object's kind
      objectKind?: "table" | "view" | "materialized-view";
      expanded: boolean; parentKey: string | null }
  | { key: string; depth: number; kind: "column"; label: string; detail: string; parentKey: string }
  | { key: string; depth: number; kind: "loading" | "empty"; parentKey: string }
  | { key: string; depth: number; kind: "error"; message: string; retryKey: readonly unknown[]; parentKey: string };

export interface TreeData {
  schemas: { name: string; default: boolean }[];
  objects: Record<string, Loaded<ObjectInfo[]>>;  // by schema
  columns: Record<string, Loaded<ColumnInfo[]>>;  // by object key
}
// Loaded<T> = { status: "pending" } | { status: "error"; message: string } | { status: "success"; data: T }

export function treeRows(data: TreeData, expanded: ReadonlySet<string>): TreeRow[];
export function toggle(expanded: ReadonlySet<string>, row: TreeRow): Set<string>;
// Expanding a schema also expands its two groups; collapsing removes only the row's key.
export function initialExpanded(schemas: TreeData["schemas"]): Set<string>;
// The default schema and its groups, or every schema when there is only one.
```

The `loading`, `empty` ("No tables or views", "No columns") and `error`
rows sit under the node being loaded. An error row shows the message and
a Retry that refetches `retryKey`.

`StructureTree` reads `list-schemas` with `useQuery`. It then reads, with
`useQueries`, `list-objects` for each expanded schema and `list-columns`
for each expanded object. It builds `TreeData` from those results and
renders `treeRows` through `useVirtualizer` (rows 24 px), as the grid
does. The tree has `role="tree"` and `aria-label="Structure"`. Each row
has `role="treeitem"`, `aria-level`, `aria-expanded` (on expandable rows)
and `aria-selected`, and the tree keeps one focused row (roving
`tabIndex`):

- Up and Down move the focus; Home and End jump to the first and last row.
- Right expands a collapsed row, or moves into an expanded one.
- Left collapses an expanded row, or moves to its parent.
- Enter and Space toggle.
- A click focuses and toggles.

The focused row is scrolled into view with `virtualizer.scrollToIndex`.
Icons come from lucide (a folder for schemas and groups, a table, an eye
for views, a layered icon for materialized views, a column marker). A
column's type and an object's kind are shown muted after the name.

The expanded set lives in the workspace, in memory only:
`Workspace.treeExpanded: string[] | null`. `null` means untouched, and
`initialExpanded` fills it once `list-schemas` answers. It survives a
disconnect and reconnect (keys are names, not ids). It is not saved to
the app database.

### Frontend: completion

`SqlEditor` gets a `completion` prop: `{ schema: SQLNamespace;
defaultSchema?: string } | null`, read in `AppShell` with
`useQuery(metaKeys.completion(connId))` while the selected workspace is
connected. `setup.ts` gets a `languageFor(engine, completion)` that
returns `sql({ dialect: dialectFor(engine), schema, defaultSchema })`, or
the keyword-only `sql({ dialect })` for null. `newState` and every
`language.reconfigure` in `SqlEditor` use it. The engine effect becomes an
`[engine, completion]` effect. TanStack Query keeps the data's identity
until it changes, so the editor is reconfigured only when the schema
does. Each tab's `EditorState` starts with `languageFor(engine, null)`;
the effect swaps in the schema on tab change, as it swaps the dialect
today.

### Testing

- Backend, SQLite (`test/quel/meta_test.lg`, temp file): schemas without
  `temp`; tables, views and an FTS5 virtual table without its shadow
  tables and `sqlite_` tables; columns in order with types; a view over a
  dropped table leaves completion intact; `completion-schema` shape and
  default schema; a name with a quote and a space.
- Backend, Postgres (`test/quel/pg_test.lg`, Docker): the same for
  `:postgres`. Also a partition hidden under its parent, a materialized
  view, a mixed-case quoted table name, `pg_catalog` and
  `information_schema` absent. Then every `:redshift` method run against
  the same Postgres (shape only).
- Backend, handlers (`test/quel/api_test.lg`): the handler set, and
  `list-schemas` → `list-objects` → `list-columns` → `completion-schema`
  over a SQLite file.
- Smoke (`scripts/smoke.sh`): after the smoke creates table `t`,
  `list-objects` on `main` lists it and `completion-schema` has its
  column.
- Frontend unit (`vitest`): `treeRows`, `toggle` and `initialExpanded`;
  the runner's remove on disconnect, and that a DDL run does not
  invalidate (mocked bridge, as `runner.test.ts` does).
- E2E (`frontend/e2e/structure.spec.ts`): connect the fixture, see `main`
  expanded with table `t`, expand `t` to its columns, create a table in
  the editor and see it appear after pressing refresh (in the tree and in
  completion), drive the tree by keyboard, and complete a column name in
  the editor.

## File Structure

| File | Change |
|---|---|
| `src/quel/meta.lg` | Create: the multimethods, `completion-schema`, `completion-limit` |
| `src/quel/meta/sqlite.lg` | Create: SQLite methods |
| `src/quel/meta/postgres.lg` | Create: Postgres and Redshift methods and their SQL |
| `src/quel/api.lg` | Modify: four handlers; require the meta namespaces |
| `test/quel/meta_test.lg` | Create: SQLite introspection tests |
| `test/quel/pg_test.lg` | Modify: Postgres and Redshift-on-Postgres introspection tests |
| `test/quel/api_test.lg` | Modify: handler set; a structure round trip |
| `scripts/smoke.sh` | Modify: `list-objects` and `completion-schema` calls |
| `frontend/package.json` | Modify: `@tanstack/react-query` |
| `frontend/src/main.tsx` | Modify: `QueryClientProvider` |
| `frontend/src/lib/query.ts` | Create: `queryClient`, `metaKeys` |
| `frontend/src/lib/api.ts`, `lib/types.ts` | Modify: the four calls and their shapes |
| `frontend/src/state/tree.ts` (+ `.test.ts`) | Create: rows, toggle, initial expansion |
| `frontend/src/state/store.ts` | Modify: `Workspace.treeExpanded` |
| `frontend/src/state/runner.ts` (+ `.test.ts`) | Modify: remove on disconnect, `setTreeExpanded` |
| `frontend/src/components/StructureTree.tsx` | Create: the tree |
| `frontend/src/components/ConnectionsPanel.tsx` | Modify: share the sidebar with the tree |
| `frontend/src/components/AppShell.tsx` | Modify: sidebar split; completion query into the editor |
| `frontend/src/editor/setup.ts`, `editor/SqlEditor.tsx` | Modify: `languageFor`, `completion` prop |
| `frontend/e2e/structure.spec.ts` | Create |
| `docs/backlog/*.md` | Create: three entries (Task 10) |
| `docs/DESIGN.md` | Modify (Task 11) |


## Commands

On Linux without GTK4/WebKitGTK headers, prefix the `lgx` commands below
with `CGO_ENABLED=0 GOFLAGS=-tags=server`.

- Backend: `lgx test`; with Postgres: `lgx test-pg`
- Frontend: `npm --prefix frontend test`, `npm --prefix frontend run lint`,
  `npm --prefix frontend run build` (type-checks)
- Smoke: `lgx smoke`, `lgx smoke-pg`
- E2E: `lgx e2e`

---

### Task 1: Branch, `quel.meta` and SQLite

**Files:**
- Create: `src/quel/meta.lg`, `src/quel/meta/sqlite.lg`, `test/quel/meta_test.lg`

- [x] **Step 1: Branch.** `git switch -c structure-tree master`.
- [x] **Step 2: Write `quel.meta`.** The four multimethods with the
  signatures in the Design, plus `completion-schema` and
  `completion-limit` (50 000). `completion-schema` takes the default
  schema from `schemas` and nests `completion-rows` into
  `{schema {table [cols]}}` with string keys. It keeps row order (use
  vectors for the columns; the map's key order does not matter to
  `lang-sql`) and stops after `completion-limit` rows. A namespace comment
  explains the protocol, that methods live in the engine namespaces, and
  that queries run on the pool.
- [x] **Step 3: Write the failing tests** in `test/quel/meta_test.lg`. Set
  up a temp SQLite file through `quel.conn` (`conn-test/temp-path`, a
  `:quel.conn/registry`), created with `create table t (id integer
  primary key, name text)`, `create view v as select name from t`,
  `create virtual table docs using fts5(body)`, `create table "it's a
  table" (x int)`, `create table g (a int, b int generated always as (a * 2)
  virtual)`, and a view `broken` over a table that is then dropped.
  Assert:
  - `schemas` is `[{:name "main" :default true}]`;
  - `objects` on `main` is `docs`, `it's a table`, `t` as tables and `v`
    as a view, without `broken`'s errors, `docs_*` shadow tables or
    `sqlite_*` (`broken` itself is listed, as a view);
  - `columns` of `t` are `[{:name "id" :type "INTEGER"} {:name "name"
    :type "TEXT"}]`, of `g` include the generated `b`, of `docs` are just
    `body` (no FTS hidden columns), and of a missing table `[]`;
  - `completion-schema` has `:default-schema "main"` and `t` → `["id"
    "name"]`, and still has `t` although `broken` fails.
- [x] **Step 4: Run** `lgx test`. Expected: the new tests fail (no
  methods).
- [x] **Step 5: Write `quel.meta.sqlite`** with the queries in the Design.
  `columns` of a view whose `pragma_table_info` throws is an error
  (`list-columns` shows it). `completion-rows` catches per object and
  skips it.
- [x] **Step 6: Run** `lgx test`. Expected: PASS. If `pragma_table_list`
  or the `virtual` type does not behave as described, fix the query and
  note it in the namespace comment.
- [x] **Step 7: Commit.** `git commit -m "Introspect SQLite schemas, tables, views and columns"`

> Deviation: the branch and plan commit came first (fastplan handoff). `lgx` 0.4.2 on PATH cannot read this repo's `lgx.edn` (`:go/build-tags`); every `lgx` command ran with the local `~/Projects/lgx/bin/lgx` 0.5.0. The tests were written together with the code, so the "see them fail" steps were skipped.

### Task 2: Postgres and Redshift

**Files:**
- Create: `src/quel/meta/postgres.lg`
- Modify: `test/quel/pg_test.lg`

- [x] **Step 1: Write the failing tests** in `pg_test.lg`, inside
  `with-pg`, with a fresh schema per test run (`create schema quel_meta_<n>`
  and drop it in a `finally`) so reruns stay clean. Create a table with
  three columns (`int4`, `varchar(20)`, `numeric(10,2)`), a view, a
  materialized view, a partitioned table with one partition, and a table
  named `"MixedCase"`. Assert, for `:postgres`:
  - `schemas` includes the test schema and `public`, with `public`
    default, and has no `pg_catalog`, `pg_toast` or `information_schema`;
  - `objects` lists the table, the view (`"view"`), the materialized view
    (`"materialized-view"`), the partitioned parent but not its
    partition, and `MixedCase` by its exact name;
  - `columns` gives `integer`, `character varying(20)`, `numeric(10,2)` in
    order;
  - `completion-schema` has the test schema's tables and columns, and
    `:default-schema "public"`.

  Then call `schemas`, `objects`, `columns` and `completion-schema` with
  `:redshift` on the same pool. Assert the same shapes, except that the
  partition is listed too (Redshift's query has no `relispartition`).
- [x] **Step 2: Run** `lgx test-pg`. Expected: the new tests fail.
- [x] **Step 3: Write `quel.meta.postgres`** with the SQL in the Design, as
  `def`s of plain strings. Define the Postgres and Redshift variants of
  `objects` and `completion-rows` side by side. For `schemas` and
  `columns`, register one fn for both engines. A comment states the
  shared-subset rule (PostgreSQL 8.0 features only, no `"char"` in
  results) and that the Redshift variants are unverified against
  Redshift.
- [x] **Step 4: Run** `lgx test-pg`, then `lgx test`. Expected: PASS;
  plain `lgx test` skips the Postgres ones.
- [x] **Step 5: Commit.** `git commit -m "Introspect Postgres and Redshift through pg_catalog"`

### Task 3: Handlers and smoke

**Files:**
- Modify: `src/quel/api.lg`, `test/quel/api_test.lg`, `scripts/smoke.sh`

- [x] **Step 1: Add the handlers** `list-schemas`, `list-objects`,
  `list-columns` and `completion-schema` to `quel.api` and to `handlers`
  (by var). Require `quel.meta`, plus `quel.meta.sqlite` and
  `quel.meta.postgres` with a comment that they are loaded for their
  methods.
- [x] **Step 2: Update `api_test.lg`.** Add the four names to
  `every-handler-is-a-var`. Add a `structure-of-an-open-database` test:
  `open-db` a temp file, `run` a `create table`, then walk
  `list-schemas` → `list-objects` → `list-columns` → `completion-schema`.
  Check that a handler call with an unknown conn-id throws "No open
  database".
- [x] **Step 3: Run** `lgx test`. Expected: PASS.
- [x] **Step 4: Extend `scripts/smoke.sh`.** After the step that creates
  `t`, call `list-objects` with `["$conn","main"]` and check the reply
  contains `"name":"t"`. Call `completion-schema` and check it contains
  `"id"`. In the Postgres part, if the script has one, do the same with
  `public`. Read the script first and follow its `call`/`fail` helpers.
- [x] **Step 5: Run** `lgx smoke` (and `lgx smoke-pg` if Docker is up).
  Expected: PASS.
- [x] **Step 6: Commit.** `git commit -m "Structure handlers: schemas, objects, columns, completion"`

### Task 4: Frontend data layer

**Files:**
- Modify: `frontend/package.json`, `frontend/src/main.tsx`, `frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/query.ts`

- [x] **Step 1: Add TanStack Query.** `npm --prefix frontend install @tanstack/react-query`.
- [x] **Step 2: Write `lib/query.ts`:** `queryClient` with `retry: false`,
  `staleTime: Infinity` and `refetchOnWindowFocus: false`, and `metaKeys`
  exactly as in the Design.
- [x] **Step 3: Types and calls.** In `types.ts`: `SchemaInfo { name;
  default }`, `ObjectInfo { name; kind: "table" | "view" |
  "materialized-view" }`, `ColumnInfo { name; type }`, `CompletionSchema
  { "default-schema": string | null; schemas: Record<string,
  Record<string, string[]>> }`. In `api.ts`: `listSchemas(connId)`,
  `listObjects(connId, schema)`, `listColumns(connId, schema, name)`,
  `completionSchema(connId)`. The bridge lowers an empty or nil reply to
  `{}` or `null` (see the comment in `api.ts`), so coerce a non-array
  list reply to `[]`, and a reply without `schemas` to `{ "default-schema":
  null, schemas: {} }`.
- [x] **Step 4: Provider.** Wrap `<App />` in `QueryClientProvider
  client={queryClient}` in `main.tsx`.
- [x] **Step 5: Run** `npm --prefix frontend run build` and `npm --prefix
  frontend test`. Expected: PASS.
- [x] **Step 6: Commit.** `git commit -m "TanStack Query and the structure calls"`

### Task 5: Tree model

**Files:**
- Create: `frontend/src/state/tree.ts`, `frontend/src/state/tree.test.ts`

- [x] **Step 1: Write the failing tests:**
  - collapsed schemas give one row each, depth 0;
  - an expanded schema with pending objects gives a `loading` row at
    depth 1, and with an error an `error` row carrying the message and
    `metaKeys.objects`' key;
  - a loaded schema shows only the groups that have members ("Tables",
    "Views" with counts in `detail`). Groups are depth 1, objects depth 2
    sorted by name, materialized views under Views;
  - an expanded object with columns gives column rows at depth 3 with
    the type in `detail`, and with no columns an `empty` row;
  - an expanded key whose parent is collapsed shows nothing;
  - keys are distinct for a schema and a table with the same name, and
    for names containing `"` and `,`;
  - `toggle` on a schema adds the schema and both group keys, and
    removes only the schema's key on collapse;
  - `initialExpanded` picks the default schema, or the only schema, or
    nothing.
- [x] **Step 2: Run** `npm --prefix frontend test`. Expected: the new tests fail.
- [x] **Step 3: Implement `tree.ts`** with the types and functions in the Design.
- [x] **Step 4: Run** `npm --prefix frontend test`. Expected: PASS.
- [x] **Step 5: Commit.** `git commit -m "Structure tree model"`

### Task 6: Workspace state and cache lifetime

**Files:**
- Modify: `frontend/src/state/store.ts`, `frontend/src/state/runner.ts`, `frontend/src/state/runner.test.ts`

- [x] **Step 1: Store.** Add `treeExpanded: string[] | null` to
  `Workspace` (null in `newWorkspace`), and a runner action
  `setTreeExpanded(profileId, keys)`.
- [x] **Step 2: Runner tests** (mocked bridge, as the existing runner
  tests do; spy on `queryClient.invalidateQueries` and `removeQueries`):
  - a finished disconnect removes `metaKeys.all(oldConnId)`, and so does
    one whose `closeDb` throws;
  - a successful `create table` run does not invalidate anything (refresh
    is manual);
  - `setTreeExpanded` stores the keys on the workspace, and a disconnect
    keeps them.
  Run and see the first fail.
- [x] **Step 3: Implement.** In `disconnectProfile`, call
  `queryClient.removeQueries({ queryKey: metaKeys.all(connId) })` for the
  old conn-id after `closeDb`, whether it threw or not. Run `npm --prefix
  frontend test`: PASS.
- [x] **Step 4: Commit.** `git commit -m "Tree state per workspace; drop cached metadata on disconnect"`

### Task 7: The tree component

**Files:**
- Create: `frontend/src/components/StructureTree.tsx`
- Modify: `frontend/src/components/ConnectionsPanel.tsx`, `frontend/src/components/AppShell.tsx`

Use /frontend-design for the visual details; follow the existing sidebar's
density (`text-sm`, `size="icon-xs"` buttons, `text-muted-foreground`).

- [x] **Step 1: Sidebar split.** In `AppShell`, the left panel holds a
  vertical `ResizablePanelGroup`: `ConnectionsPanel` (default 40%,
  scrolling on its own) above `StructureTree` (the rest). Drop
  `ConnectionsPanel`'s outer `h-full overflow-y-auto` only if the panel
  now provides it; keep its markup otherwise.
- [x] **Step 2: States.** `StructureTree` reads the selected workspace.
  It renders the header ("Structure", a refresh button labelled "Refresh
  structure" that invalidates `metaKeys.all(connId)`, disabled when not
  connected) and the body states from the Design.
- [x] **Step 3: Data.** `useQuery` for schemas. When it succeeds and
  `treeExpanded` is null, call `setTreeExpanded` with `initialExpanded`.
  Use the effect body in braces (AGENTS.md). Then `useQueries` for the
  expanded schemas' objects and the expanded objects' columns, mapped
  into `TreeData`, and `treeRows`.
- [x] **Step 4: Rows.** Virtualize with `useVirtualizer` (estimate 24 px,
  overscan 10), as `grid/ResultGrid.tsx` does. Each row is a `div` with
  `role="treeitem"` and the ARIA attributes from the Design, indented by
  depth, with a chevron on expandable rows, an icon, the label
  (truncated, full name in `title`) and the muted detail. Error rows have
  `role="alert"` text and a Retry button that calls
  `queryClient.refetchQueries({ queryKey: row.retryKey })`.
- [x] **Step 5: Keyboard and focus.** Keep the focused key in component
  state. Use one `tabIndex={0}` row, the rest `-1`. Implement the keys
  from the Design. Moving focus calls `scrollToIndex` and then focuses
  the row element in an effect (braces). A click focuses and toggles.
  When the focused key disappears (a collapse above, a refresh), fall
  back to the nearest remaining ancestor, else the first row.
- [x] **Step 6: Check by hand** in server mode
  (`CGO_ENABLED=0 GOFLAGS=-tags=server lgx dev`, or `lgx dev` on macOS),
  using /run if useful. Connect a SQLite profile: `main` opens, tables
  and views are grouped, columns load on expand, refresh works, a
  disconnect shows "Not connected.".
- [x] **Step 7: Run** `npm --prefix frontend run lint`, `npm --prefix
  frontend run build`, `npm --prefix frontend test`. Expected: PASS.
- [x] **Step 8: Commit.** `git commit -m "Structure tree in the sidebar"`

### Task 8: Schema completion in the editor

**Files:**
- Modify: `frontend/src/editor/setup.ts`, `frontend/src/editor/SqlEditor.tsx`, `frontend/src/components/AppShell.tsx`

- [x] **Step 1: `languageFor`.** In `setup.ts`, export
  `languageFor(engine, completion)` as in the Design, and use it in
  `newState` (with `null`). Replace the "schema completion comes with the
  structure browser" comment.
- [x] **Step 2: Prop and effects.** `SqlEditor` takes `completion`. The
  tab-swap effect and the old engine effect reconfigure with
  `languageFor(engine, completion)`. The engine effect's dependencies
  become `[engine, completion]`.
- [x] **Step 3: Query.** In `AppShell`, `useQuery({ queryKey:
  metaKeys.completion(connId), queryFn: ..., enabled: connected })`,
  mapped to `{ schema: data.schemas, defaultSchema: data["default-schema"]
  ?? undefined }` with `useMemo` on `data`, or `null`, and passed to
  `SqlEditor`.
- [x] **Step 4: Check by hand:** in a SQLite profile with table `t`,
  `select na` offers `name` after `from t` is typed. `select * from `
  offers `t`, and `main.` offers `t`. After `create table u (x int)`
  runs, `u` is not offered until the tree's refresh button is pressed,
  and then it is.
- [x] **Step 5: Run** lint, build and tests as in Task 7. Expected: PASS.
- [x] **Step 6: Commit.** `git commit -m "Complete schema, table and column names in the editor"`

> Deviation: `lang-sql` completes columns only after a table name or alias (`t.`, `c.`), never bare from the `FROM` clause, so the hand check and the e2e test use `t.`; the bare case is backlogged (`unqualified-column-completion.md`). Codex found that a dot in a schema or table name is read as a path by `lang-sql`: `editor/namespace.ts` escapes it (commit c7c954e), and builds the objects so a table named `__proto__` survives. For Task 7, codex found the virtualized tree could unmount its only tab stop and steal focus on later re-renders: the focused row is now always rendered, and focus moves only after a keyboard move (commit 3f22271).

### Task 9: End to end

**Files:**
- Create: `frontend/e2e/structure.spec.ts`

- [x] **Step 1: Write the spec.** Read `e2e/connect.ts` and
  `e2e/query-loop.spec.ts` for the fixture database and its table `t`.
  Use a profile name of its own (`Structure ${Date.now()}`, as
  `tabs.spec.ts` does). The test:
  1. `ensureProfile` + `selectAndConnect`; the tree (`getByRole("tree",
     { name: "Structure" })`) shows `main` expanded, "Tables" and `t`.
  2. Click `t`: its columns appear with their types.
  3. In the editor, run `create table structure_e2e_<n> (a int)`. It is
     not in the tree yet, and `select * from structure_e2` with
     completion triggered does not offer it. Press "Refresh structure":
     it appears in the tree and among the completion options. Drop it at
     the end of the test.
  4. Focus the tree, press Up and Left; `t` collapses, then focus is on
     its group.
  5. In the editor, type `select ` then trigger completion
     (`Control+Space`) after `from t` is in place, and see a column of
     `t` among the options (`.cm-tooltip-autocomplete`).
  6. Disconnect: the tree area shows "Not connected.".
- [x] **Step 2: Run** `lgx e2e`. Expected: every spec passes, the old
  ones included.
- [x] **Step 3: Commit.** `git commit -m "E2E: structure tree and completion"`

### Task 10: Backlog entries

Use /backlog. Each entry is its own commit, `Backlog: <what>`, never
mixed with code (AGENTS.md).

- [x] **Step 1:** `docs/backlog/redshift-external-schemas.md`: Redshift's
  external (Spectrum) schemas and datashares do not appear in the
  structure tree or completion, because `pg_class` does not list them.
  Fix: `svv_external_schemas`/`svv_external_tables`/`svv_external_columns`
  or `svv_all_*`, checked against a real cluster. Origin: this plan.
  Commit `Backlog: Redshift external schemas in the structure tree`.
- [x] **Step 2:** `docs/backlog/redshift-late-binding-view-columns.md`:
  late-binding views (`with no schema binding`) show "No columns" and
  complete no columns. Fix: `pg_get_late_binding_view_cols()` for
  Redshift, unioned in `columns` and `completion-rows`. Commit `Backlog:
  Redshift late-binding view columns`.
- [x] **Step 3:** `docs/backlog/session-local-objects-in-tree.md`: the
  tree reads the pool, so temp tables and SQLite `ATTACH`ed databases
  made in a tab's session do not show, and completion misses them. Fix
  options: read the active tab's session when it is idle, or list its
  temp schema separately. Commit `Backlog: session-local objects in the
  structure tree`.

> Deviation: a fourth backlog entry, `unqualified-column-completion.md` (see Task 8).

### Task 11: Docs, review, PR

**Files:**
- Modify: `docs/DESIGN.md`, this plan

- [x] **Step 1: DESIGN.**
  - Milestone 1: "Structure tree done 2026-MM-DD: schemas, tables, views
    and columns in the sidebar, schema completion in the editor;
    Redshift through `pg_catalog`, unverified." History stays open.
  - Introspection: a short note that Redshift reads `pg_catalog` for now,
    and why, and that `svv_all_*` waits for a cluster (link the backlog
    entries).
  - The Structure row of the Handler API table, as in this plan's
    Handlers section.
  - Introspection's last paragraph: `completion-schema` is cached per
    connection in the frontend and refreshed with the tree's refresh
    button only, not "after DDL runs".
  - The namespace table: `quel.meta.postgres` covers Redshift until
    Redshift-only work needs `quel.meta.redshift`.
  - "Unverified": on the first released build, against a real Redshift,
    check that `list-schemas`, `list-objects`, `list-columns` and
    `completion-schema` answer for a non-superuser, that internal
    schemas stay hidden, and how long completion takes on a large
    cluster.
- [x] **Step 2:** Mark this plan `**Status: completed**` under its title.
- [x] **Step 3: Commit.** `git commit -m "Record the structure tree in the design"`
- [x] **Step 4: Review.** Run /code-review on the branch against master;
  fix what is real. Run the full check: `lgx test`, `lgx test-pg`, `npm
  --prefix frontend test`, lint, build, `lgx smoke`, `lgx e2e`.
- [x] **Step 5: PR.** Push `structure-tree` and open a PR against master
  titled "Structure tree and schema completion". In the body, note that
  the Redshift catalog is unverified and that the native macOS pass is
  still to do.

## Summary

Implemented as designed. The backend has `quel.meta` with SQLite and
Postgres/Redshift methods and four handlers. The sidebar has a
virtualized, keyboard-driven structure tree for the selected profile.
The editor completes schema, table and column names, and a single refresh
button reloads everything cached for the connection. Checks: backend
tests (with Postgres in Docker), 182 frontend tests, `smoke-pg`, and the
10 e2e specs all pass. The tree was also checked by hand in server mode.

Issues met: the `lgx` on PATH is too old for this repo; an icon's
`aria-label` polluted the tree items' accessible names (now decorative);
and the three codex findings in the Task 8 note.

Deviations, gathered: Task 1 (the order of the first steps, local `lgx`,
tests written with the code); Task 8 (qualified column completion only,
dot escaping, the tree focus fixes); Task 10 (a fourth backlog entry).

Not done here: the native macOS pass, and anything on Redshift, which
waits for the first Homebrew release (DESIGN "Unverified").

What the plan could have specified better: it should have checked what
`lang-sql` completes before promising bare column completion, and named
the `lgx` version the commands need.

