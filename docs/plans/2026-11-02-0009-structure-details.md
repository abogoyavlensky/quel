# Structure Details Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The structure tree shows a schema's functions, types and
standalone sequences, and an open table's indexes, keys and owned
sequences, with PK/FK markers on its columns.

**Tech Stack:** let-go (`quel.meta` multimethods over `sql.core`), SQLite
(modernc, `pragma_*` table-valued functions), Postgres/Redshift (pgx,
`pg_catalog`); React 19, TanStack Query, `@tanstack/react-virtual`,
lucide icons; Vitest, Playwright.

---

## Design

### Where this starts

The structure tree (`docs/plans/2026-10-23-2224-structure-tree.md`) shows
schema → Tables / Views → object → columns, one query per expand.
`docs/DESIGN.md` milestone 2 ("Structure") lists indexes, constraints,
functions, procedures and sequences next. This plan does the tree part
of it. Table info, DDL, `Cmd+K` and context menus stay out.

Work on the branch `structure-details` (already cut from master; it holds
two backlog commits from the planning discussion).

### What the tree shows

```
public                         schema
  Tables 2                     group (open with the schema, as now)
    orders                     object
      id        PK   bigint    column, badges after the name
      user_id   FK   bigint
      status         order_status
      Indexes 2                section, closed by default
        orders_pkey     unique btree (id)
        orders_user_idx btree (user_id)
      Keys 2                   section
        orders_pkey     PRIMARY KEY (id)
        orders_user_fk  FOREIGN KEY (user_id) REFERENCES users(id)
      Sequences 1              section: sequences a column owns
        orders_id_seq   id
  Views 1
  Functions 4                  group, closed by default
    add_order   (integer, text)
  Types 2                      group, closed by default
    order_status               enum: expands to its values
      new
      paid
    money_amount  numeric(12,2)   domain: its base type
  Sequences 1                  standalone sequences only (no OWNED BY)
    invoice_no
```

- Columns stay right under the table, so opening a table works as it does
  today. Sections come after them and show only when not empty.
- A schema group shows only when it has members, as Tables and Views do
  today. Opening a schema opens Tables and Views; Functions, Types and
  Sequences stay closed (a schema can hold many functions).
- Functions are single rows: name, argument types as the detail.
- Functions, types and sequences that belong to an extension are hidden
  (PostGIS in `public` would add a thousand functions).
- Each engine shows what it has:

  | | Functions | Types | Seqs (schema) | Indexes | Keys | Seqs (table) |
  |---|---|---|---|---|---|---|
  | Postgres | yes | enum, domain, composite | yes | yes | yes | yes |
  | SQLite | - | - | - | yes | PK, FK, unique | - |
  | Redshift | yes, unverified | - | - | - (dist/sort keys: backlog) | yes, unverified | - |

### Loading

- Opening a schema makes one call, `describe-schema`: its tables and
  views (as `list-objects` returned), functions, types with enum values,
  and standalone sequences. Counts and hidden empty groups need them all,
  and they are names only.
- Opening an object makes one call, `describe-object`: columns with PK/FK
  flags, indexes, keys and owned sequences. The badges need the keys, and
  the section counts need the rest; each part is a small catalog query.
- Nothing loads for the whole database. Completion is unchanged.
- Refresh and the spinner cover the new query keys, which start with
  `["meta", connId]` like the others.

`describe-schema` and `describe-object` replace the handlers
`list-objects` and `list-columns` (their only caller is the tree; DESIGN
already names `describe-object`). The multimethods `objects` and
`columns` stay: SQLite's `completion-rows` calls `columns`.

### Backend: `quel.meta`

New multimethods, each with a `:default` method returning `[]`, so an
engine without the thing needs no method:

```clojure
;; Schema level
(defmulti functions (fn [engine _db _schema] engine))
;; => [{:name "add_order" :kind "function" :args "integer, text"}]
;; :kind "function" or "procedure"; sorted by name, then args.
(defmulti types (fn [engine _db _schema] engine))
;; => [{:name "order_status" :kind "enum" :detail nil :values ["new" "paid"]}
;;     {:name "money_amount" :kind "domain" :detail "numeric(12,2)" :values []}]
;; :kind "enum", "domain" or "composite"; :detail a domain's base type.
(defmulti sequences (fn [engine _db _schema] engine))
;; => [{:name "invoice_no"}], standalone ones only

;; Object level
(defmulti indexes (fn [engine _db _schema _name] engine))
;; => [{:name "orders_user_idx" :definition "btree (user_id)" :unique false :primary false}]
(defmulti constraints (fn [engine _db _schema _name] engine))
;; => [{:name "orders_user_fk" :kind "foreign-key" :columns ["user_id"]
;;      :definition "FOREIGN KEY (user_id) REFERENCES users(id)"}]
;; :kind "primary-key", "unique", "foreign-key" or "check", in that order,
;; then by name. :name nil where the engine has none (SQLite).
(defmulti owned-sequences (fn [engine _db _schema _name] engine))
;; => [{:name "orders_id_seq" :column "id"}]
```

Two engine-independent functions build the replies:

```clojure
(defn describe-schema [engine db schema]
  {:objects (objects engine db schema)
   :functions (functions engine db schema)
   :types (types engine db schema)
   :sequences (sequences engine db schema)})

(defn describe-object [engine db schema name]
  ;; :columns are (columns ...) with :pk and :fk booleans: a column is :pk
  ;; when a "primary-key" constraint lists it, :fk when a "foreign-key" does.
  {:columns [...] :indexes [...] :keys (constraints ...) :sequences [...]})
```

Every list is a vector, also when empty. Group multi-row results (enum
values, constraint columns, index columns) in let-go: no `array_agg`,
`string_agg` or array columns go through the driver.

#### SQLite (`src/quel/meta/sqlite.lg`)

Pragma arguments go table first, then schema, as in `columns` today.

- `indexes`: `select name, "unique", origin, partial from
  pragma_index_list(?, ?) order by name`; each index's columns from
  `select name from pragma_index_info(?, ?) order by seqno` (index name,
  schema). An expression column has a null name: show it as `<expr>`.
  `:definition` is `"(a, b)"`, with ` partial` appended for a partial
  index; `:unique` is `"unique" = 1`; `:primary` is `origin = 'pk'`.
  `sqlite_autoindex_*` indexes (from `UNIQUE` and non-rowid `PRIMARY
  KEY`) are listed, not hidden: their names say what they are.
- `constraints`:
  - primary key: the `pk > 0` columns of `pragma_table_xinfo` in `pk`
    order, `"PRIMARY KEY (id)"`. A rowid `INTEGER PRIMARY KEY` counts.
  - unique: each `origin = 'u'` index from `pragma_index_list`,
    `"UNIQUE (email)"`.
  - foreign keys: `select id, seq, "table", "from", "to" from
    pragma_foreign_key_list(?, ?) order by id, seq`, grouped by `id`,
    `"FOREIGN KEY (t_id) REFERENCES t(id)"`; a null `to` (the parent's
    primary key) gives `"REFERENCES t"`.
  - `:name` is nil for all of them. Check constraints are not listed:
    SQLite exposes them only inside `sqlite_schema.sql`.
- No `functions`, `types`, `sequences`, `owned-sequences` methods (the
  defaults answer `[]`).

#### Postgres and Redshift (`src/quel/meta/postgres.lg`)

The namespace's rule holds: `"char"` columns (`prokind`, `typtype`,
`contype`, `deptype`, `relkind`) never come back raw; a `CASE` maps them
to strings, or they appear only in `where`. An object is found by
`schema` and `name` through one subquery, used by every object-level
query:

```sql
(select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = $1 and c.relname = $2)
```

Postgres:

- `functions`: `pg_proc` in the schema, `prokind in ('f', 'p')`,
  `:kind` from `case p.prokind when 'p' then 'procedure' else 'function'
  end`, `:args` from `pg_get_function_identity_arguments(p.oid)`. Leave
  out extension members: `not exists (select 1 from pg_depend d where
  d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype =
  'e')`.
- `types`: `pg_type` in the schema with `typtype in ('e', 'd')`, or
  `typtype = 'c'` whose `typrelid` is a `pg_class` row with `relkind =
  'c'` (a `CREATE TYPE ... AS (...)`; every table, view and sequence has a
  composite row type too, which must not show). Extension members out
  the same way (`classid = 'pg_type'::regclass`). `:detail` is
  `format_type(t.typbasetype, t.typtypmod)` for a domain, else null.
  Enum values come from a second query over the whole schema,
  `pg_enum` joined to `pg_type`, `order by t.typname, e.enumsortorder`,
  grouped by type name in let-go. Range types are left out.
- `sequences`: `pg_class` with `relkind = 'S'` in the schema, without a
  `pg_depend` row of `deptype in ('a', 'i')` pointing at a table
  (`classid` and `refclassid` both `'pg_class'::regclass`): those are
  `serial` and identity sequences, shown under their table. Extension
  members out too.
- `indexes`: `pg_index` joined to the index's `pg_class` row, `indrelid`
  the object; `pg_get_indexdef(i.oid)` gives `CREATE [UNIQUE] INDEX name
  ON schema.table USING btree (col)`. `:definition` is the text from
  `USING ` on (`"btree (col)"`, a partial index keeps its `WHERE`), or
  the whole text when there is no `USING`. `:unique` and `:primary` from
  `indisunique` and `indisprimary` (booleans, fine).
- `constraints`: `pg_constraint` with `conrelid` the object and `contype
  in ('p', 'u', 'f', 'c')`, mapped by `CASE` to the kind strings;
  `:definition` is `pg_get_constraintdef(c.oid)`. Columns: `left join
  pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)`,
  one row per column, `order by c.conname, a.attnum`, grouped in let-go
  (a check constraint over no column has `:columns []`). Sort by kind
  (primary-key, unique, foreign-key, check), then name.
- `owned-sequences`: `pg_depend d` with `d.refobjid` the object,
  `deptype in ('a', 'i')`, both class ids `'pg_class'::regclass`, joined
  to the sequence (`relkind = 'S'`) and to `pg_attribute` on
  `attnum = d.refobjsubid` for the column.

Redshift, all unverified (DESIGN's Unverified section gets a line):

- `functions`: the same `pg_proc` query without `prokind` (Postgres 11+)
  and without the extension filter (Redshift has no extensions); every
  row is a `"function"`; `:args` from `oidvectortypes(p.proargtypes)`.
  The tests run it against Postgres (`oidvectortypes` is there on
  `postgres:17-alpine`: `integer` for `add_one(x int)`).
- `constraints`: the Postgres query; it stays in the shared subset
  (`any(conkey)`, `pg_get_constraintdef`, a `CASE`).
- No `types`, `sequences`, `indexes` or `owned-sequences` methods:
  Redshift has no user types, its sequences are `IDENTITY` columns, and it
  has no indexes. Dist and sort keys are backlogged
  (`docs/backlog/redshift-dist-sort-keys.md`).

### Handlers (`src/quel/api.lg`)

```clojure
(defn describe-schema [{:keys [conns]} conn-id schema] ...)  ; meta/describe-schema
(defn describe-object [{:keys [conns]} conn-id schema name] ...)  ; meta/describe-object
```

`list-objects` and `list-columns` go away. `list-schemas` and
`completion-schema` stay.

### Frontend

`src/lib/types.ts`:

```ts
export interface ColumnInfo { name: string; type: string; pk: boolean; fk: boolean }
export interface FunctionInfo { name: string; kind: "function" | "procedure"; args: string }
export interface TypeInfo { name: string; kind: "enum" | "domain" | "composite"; detail: string | null; values: string[] }
export interface SequenceInfo { name: string }
export interface SchemaContents { objects: ObjectInfo[]; functions: FunctionInfo[]; types: TypeInfo[]; sequences: SequenceInfo[] }
export interface IndexInfo { name: string; definition: string; unique: boolean; primary: boolean }
export type KeyKind = "primary-key" | "unique" | "foreign-key" | "check";
export interface KeyInfo { name: string | null; kind: KeyKind; columns: string[]; definition: string }
export interface OwnedSequence { name: string; column: string }
export interface ObjectDetails { columns: ColumnInfo[]; indexes: IndexInfo[]; keys: KeyInfo[]; sequences: OwnedSequence[] }
```

`src/lib/api.ts`: `describeSchema(connId, schema)` and
`describeObject(connId, schema, name)`. The bridge lowers an empty list
to `{}` or `null` at any depth, and nil to `null` or a missing key, so
both normalize every list (`objects`, `functions`, `types`, each type's
`values`, `sequences`, `columns`, `indexes`, `keys`, each key's
`columns`) with one `arr()` helper, and `detail` / `name` with `?? null`.

`src/lib/query.ts`: `metaKeys.schema(connId, schema)` =
`["meta", connId, "schema", schema]` and `metaKeys.object(connId, schema,
name)` = `["meta", connId, "object", schema, name]` replace `objects` and
`columns`.

`src/state/tree.ts`:

- `TreeData` holds `contents: Record<schema, Loaded<SchemaContents>>` and
  `details: Record<objectKey, Loaded<ObjectDetails>>` in place of
  `objects` and `columns`.
- Groups: `"tables" | "views" | "functions" | "types" | "sequences"`, in
  that order, labels "Tables", "Views", "Functions", "Types",
  "Sequences". Tables and Views are still cut from `objects` (a
  materialized view goes with the views); the others come from their own
  lists, so a function never lands under Views. An open schema with all
  five empty says "Empty schema".
- Row kinds, added to the union:
  - `column` gains `badges: ("PK" | "FK")[]`.
  - `section`: expandable, under an object, `section: "indexes" | "keys"
    | "sequences"`, label "Indexes" / "Keys" / "Sequences", count as
    `detail`, closed by default.
  - `enum`: expandable type row, its values as `item` rows under it.
  - `item`: a leaf with `label`, `detail` and an `icon` naming what it is
    (`"function" | "procedure" | "domain" | "composite" | "sequence" |
    "index" | "key" | "value"`).
  - An open object with no columns and no sections says "No columns".
- Keys are JSON arrays with a prefix per kind, so names shared across
  kinds (a function named like a table) and overloads stay apart. The
  existing `s`, `g`, `o` and `c` encodings do not change.

  | Row | Key |
  |---|---|
  | section | `["d", schema, object, section]` |
  | function | `["fn", schema, name, args]` |
  | type (enum or not) | `["ty", schema, name]` |
  | enum value | `["ev", schema, type, index]` |
  | sequence (schema) | `["sq", schema, name]` |
  | index | `["ix", schema, object, name]` |
  | key | `["k", schema, object, index]` (SQLite keys have no name) |
  | owned sequence | `["os", schema, object, name]` |

- Item labels and details:
  - function: name, `(args)`.
  - domain: name, base type; composite: name, `composite`.
  - index: name, `unique ` + definition when unique, else definition.
  - key: name, or "Primary key" / "Unique" / "Foreign key" / "Check"
    when it has none; the definition as detail.
  - owned sequence: name, its column.
  - enum value: the value, no detail.
- `toggle` and `initialExpanded` still open Tables and Views with a
  schema, nothing else. `openObjects` keeps its meaning (the objects
  whose details to load).

`src/components/StructureTree.tsx`: the two `useQueries` call
`describeSchema` and `describeObject`; `RowBody` renders the new kinds.
A section row looks like a group row; an enum row like an object row; an
item row is an icon, the label, and the detail muted and right-aligned in
mono like a column's type, with `title` holding both. Column badges come
right after the column's name, as small text (`PK`, `FK`) with a `title`
("Primary key", "Foreign key"): after the name, so the row's accessible
name still starts with it (the e2e helpers match `^name\s`). Icons are
lucide ones; pick names that exist in the installed `lucide-react`
(for example `SquareFunctionIcon`, `ShapesIcon`, `HashIcon`,
`KeyRoundIcon`, `ListIcon`).

### Testing

- `test/quel/meta_test.lg` (SQLite): the fixture gains a table with a
  rowid PK, a FK to `t`, a `UNIQUE` column and an explicit index; tests
  for `indexes`, `constraints`, `describe-object`'s badges, and
  `describe-schema` with empty functions/types/sequences.
- `test/quel/pg_test.lg`: `with-meta-schema` gains an enum, a domain, a
  composite type, two overloads of one function, a procedure, a
  standalone sequence, a `serial` column, an identity column, an index,
  a FK, a unique and a check constraint, and `create extension citext
  with schema <schema>` (contrib ships in `postgres:17-alpine`; citext is
  trusted, and `drop schema ... cascade` removes it; all checked on
  `postgres:17-alpine`, where citext adds 48 functions to the schema). Tests prove table
  row types and extension members stay hidden, owned sequences show under
  their table only, and the Redshift methods parse on Postgres.
- `test/quel/api_test.lg`: the handler set and the structure test.
- `scripts/smoke.sh`: `describe-schema` and `describe-object` on `t`.
- `frontend/src/lib/api.test.ts`: normalization of empty lists and nils.
- `frontend/src/state/tree.test.ts`: the new groups, sections, enums,
  items and keys.
- `frontend/e2e/structure.spec.ts`: a SQLite table with an index, a FK
  and a unique column shows its badges, Indexes and Keys.

## File Structure

| File | Change |
|---|---|
| `src/quel/meta.lg` | new multimethods with `:default` methods; `describe-schema`, `describe-object` |
| `src/quel/meta/sqlite.lg` | `indexes`, `constraints` |
| `src/quel/meta/postgres.lg` | `functions`, `types`, `sequences`, `indexes`, `constraints`, `owned-sequences` (Postgres); `functions`, `constraints` (Redshift) |
| `src/quel/api.lg` | `describe-schema`, `describe-object` replace `list-objects`, `list-columns`; handler map |
| `test/quel/meta_test.lg` | SQLite fixture and tests |
| `test/quel/pg_test.lg` | Postgres fixture and tests |
| `test/quel/api_test.lg` | handler set, structure test |
| `scripts/smoke.sh` | the renamed calls |
| `frontend/src/lib/types.ts` | the shapes above |
| `frontend/src/lib/api.ts` / `api.test.ts` | `describeSchema`, `describeObject`, normalization |
| `frontend/src/lib/query.ts` | `metaKeys.schema`, `metaKeys.object` |
| `frontend/src/state/tree.ts` / `tree.test.ts` | the row model |
| `frontend/src/components/StructureTree.tsx` | queries and rendering |
| `frontend/e2e/structure.spec.ts` | indexes, keys, badges |
| `docs/DESIGN.md`, `README.md` | what the tree shows, handlers, roadmap, Unverified |

## Tasks

### Task 1: The protocol in `quel.meta`

**Files:**
- Modify: `src/quel/meta.lg`
- Test: `test/quel/meta_test.lg`

- [ ] **Step 1: Write the failing test.** In `meta_test.lg`, a test that
  `(meta/describe-schema :sqlite db "main")` returns the same `:objects`
  as `meta/objects`, and `[]` for `:functions`, `:types`, `:sequences`;
  and that `(meta/describe-object :sqlite db "main" "t")` has `:columns`
  with `:pk`/`:fk` keys and vectors under `:indexes`, `:keys`,
  `:sequences`.
- [ ] **Step 2: Run it.** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`
  (drop the prefix where GTK headers exist). Expected: FAIL, no such var.
- [ ] **Step 3: Implement.** The six `defmulti`s with docstrings in the
  style of the existing ones, each with a `:default` method returning
  `[]`; `describe-schema` and `describe-object` as in the Design. Keep
  the namespace comment current.
- [ ] **Step 4: Run the tests.** Expected: PASS (the SQLite object-level
  lists are empty until Task 2).
- [ ] **Step 5: Commit.** `git commit -am "Add describe-schema and describe-object to quel.meta"`

### Task 2: SQLite indexes and keys

**Files:**
- Modify: `src/quel/meta/sqlite.lg`
- Test: `test/quel/meta_test.lg`

- [ ] **Step 1: Extend the fixture.** Add
  `create table child (id integer primary key, t_id int references t(id), code text unique, n int)`,
  `create index child_n on child (n)`,
  `create index child_expr on child (n + 1)` (an expression column),
  `create index child_partial on child (code) where n > 0`, and a table with a composite
  primary key and a FK with no target column
  (`create table pair (a int, b int, t_ref int references t, primary key (a, b))`).
  Update `sqlite-objects` and the completion test for the new tables.
- [ ] **Step 2: Write the failing tests.**
  - `indexes` on `child`: `child_n` with `"(n)"`, `child_expr` with
    `"(<expr>)"`, `child_partial` with `"(code) partial"`, and
    `sqlite_autoindex_child_1` with `"(code)"`, unique; on `pair` the
    PK autoindex is `:primary true`; on `t` (rowid PK) none.
  - `constraints` on `child`: primary key `(id)`, unique `(code)`,
    foreign key `"FOREIGN KEY (t_id) REFERENCES t(id)"`, in that order,
    `:name nil`; on `pair`: `"PRIMARY KEY (a, b)"` and
    `"FOREIGN KEY (t_ref) REFERENCES t"`.
  - `describe-object` on `child`: `id` is `:pk true`, `t_id` `:fk true`,
    `code` neither.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement** `indexes` and `constraints` as in the
  Design. Quote `"unique"`, `"table"`, `"from"`, `"to"` in the SQL.
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -am "List SQLite indexes and keys"`

### Task 3: Postgres schema contents

**Files:**
- Modify: `src/quel/meta/postgres.lg`
- Test: `test/quel/pg_test.lg`

- [ ] **Step 1: Extend `with-meta-schema`.** Add to its statements (all
  schema-qualified):
  `create type mood as enum ('sad', 'ok', 'happy')`,
  `create domain amount as numeric(12,2)`,
  `create type pair as (a int, b text)`,
  `create function add_one(x int) returns int language sql as 'select x + 1'`,
  `create function add_one(x int, y int) returns int language sql as 'select x + y'`,
  `create procedure noop() language sql as ''`,
  `create sequence invoice_no`,
  `create extension citext with schema <schema>`,
  and change `items` to
  `create table items (id serial primary key, label varchar(20) unique, price numeric(10,2) check (price >= 0))`
  plus `create table orders (id int generated always as identity primary key, item_id int references items(id), status mood)`
  and `create index orders_item on orders (item_id)`.
  Update `postgres-introspection` and the Redshift test for the new
  objects and columns (`orders` joins the objects; the column types of
  `items` change only for `id`, still `integer`).
- [ ] **Step 2: Write the failing test** `postgres-schema-contents`:
  - `functions`: exactly the two `add_one` rows (args `x integer` and
    `x integer, y integer`) and `noop` as `"procedure"`, nothing from
    citext.
  - `types`: `amount` (domain, `"numeric(12,2)"`), `mood` (enum,
    `["sad" "ok" "happy"]`), `pair` (composite); no `items`, `orders`,
    `citext` or sequence row types.
  - `sequences`: `["invoice_no"]` (not `items_id_seq`, not the identity
    sequence).
- [ ] **Step 3: Run it.** `lgx test-pg`. Expected: FAIL.
- [ ] **Step 4: Implement** `functions`, `types`, `sequences` for
  `:postgres` as in the Design.
- [ ] **Step 5: Run.** `lgx test-pg`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -am "List Postgres functions, types and sequences"`

### Task 4: Postgres indexes, keys and owned sequences

**Files:**
- Modify: `src/quel/meta/postgres.lg`
- Test: `test/quel/pg_test.lg`

- [ ] **Step 1: Write the failing test** `postgres-object-details`:
  - `indexes` on `orders`: `orders_item` (`"btree (item_id)"`) and
    `orders_pkey` (unique, primary).
  - `constraints` on `items`: primary key, unique on `label`, check on
    `price`, in that order, with Postgres's names and
    `pg_get_constraintdef` text; on `orders`: the FK with `:columns
    ["item_id"]` and `"FOREIGN KEY (item_id) REFERENCES <schema>.items(id)"`
    (match the text Postgres gives; it qualifies the table when the
    schema is not on the search path).
  - `owned-sequences`: `items` → `items_id_seq` on `id`; `orders` → its
    identity sequence on `id`.
  - `describe-object` on `orders`: `id` `:pk`, `item_id` `:fk`,
    `status` neither, type `mood` qualified as `format_type` gives it.
  - On a view (`item_labels`), `indexes`, `constraints` and
    `owned-sequences` return `[]`, and `describe-object` returns its
    columns with `:pk false :fk false` and empty lists elsewhere. On an
    unknown name, `describe-object` returns the same map with every list
    empty.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** `indexes`, `constraints`,
  `owned-sequences` for `:postgres`, sharing the object subquery.
- [ ] **Step 4: Run.** `lgx test-pg`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "List Postgres indexes, keys and owned sequences"`

### Task 5: Redshift variants

**Files:**
- Modify: `src/quel/meta/postgres.lg`
- Test: `test/quel/pg_test.lg`

- [ ] **Step 1: Write the failing test.** Extend
  `redshift-introspection-parses-on-postgres`: `(meta/functions :redshift
  ...)` names `add_one` twice and `noop` (args as `oidvectortypes` gives
  them; extension functions may show, since the Redshift query has no
  extension filter: assert on the user functions only);
  `(meta/constraints :redshift ...)` equals the Postgres result;
  `types`, `sequences`, `indexes`, `owned-sequences` for `:redshift`
  are `[]`; `describe-object :redshift` on `orders` still marks `:pk` and
  `:fk`.
- [ ] **Step 2: Run it.** `lgx test-pg`. Expected: FAIL.
- [ ] **Step 3: Implement** the two Redshift methods as in the Design.
- [ ] **Step 4: Run.** `lgx test-pg`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "Read Redshift functions and keys through pg_catalog"`

### Task 6: Handlers

**Files:**
- Modify: `src/quel/api.lg`, `test/quel/api_test.lg`, `scripts/smoke.sh`

- [ ] **Step 1: Update the tests.** In `every-handler-is-a-var`, replace
  `"list-objects" "list-columns"` with `"describe-schema"
  "describe-object"`. In `structure-of-an-open-database`, check
  `(api/describe-schema env conn-id "main")` and
  `(api/describe-object env conn-id "main" "t")` (columns with `:pk
  false :fk false`, empty lists elsewhere).
- [ ] **Step 2: Run.** `lgx test`. Expected: FAIL.
- [ ] **Step 3: Implement.** The two handlers in place of the old ones,
  and the handler map. In `smoke.sh` (lines 77-80), call
  `describe-schema` (`["$conn","main"]`, still contains `"name":"t"`)
  and add `describe-object` on `t` (contains `"name":"id"`).
- [ ] **Step 4: Run.** `lgx test`, then `lgx smoke`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "Replace list-objects and list-columns with describe-schema and describe-object"`

### Task 7: Frontend types, API and the tree model

**Files:**
- Modify: `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`,
  `frontend/src/lib/query.ts`, `frontend/src/state/tree.ts`
- Test: `frontend/src/lib/api.test.ts`, `frontend/src/state/tree.test.ts`

- [ ] **Step 1: Write the failing API tests.** `describeSchema` and
  `describeObject` turn `{}`, `null` and missing lists (top level and
  nested: a type's `values`, a key's `columns`) into `[]`, and a missing
  `detail`/`name` into `null`; they call `describe-schema` /
  `describe-object` with their arguments.
- [ ] **Step 2: Write the failing tree tests.** Adapt the existing ones
  to `contents`/`details`, then add:
  - a schema's groups in order, each only when not empty, Functions /
    Types / Sequences closed after `toggle` opens the schema;
  - "Empty schema" when all lists are empty;
  - an open object: columns with badges, then only the non-empty
    sections, closed; an open section's items with their labels and
    details (unique index, unnamed SQLite key labeled "Foreign key");
  - an enum expands to its values; a domain is an item with its base
    type;
  - two overloads of a function and a function named like a table get
    distinct keys;
  - `openObjects` still lists only open objects whose schema and group
    are open.
- [ ] **Step 3: Run.** `npm --prefix frontend test`. Expected: FAIL.
- [ ] **Step 4: Implement** the types, `describeSchema`,
  `describeObject` (with `arr()`), the new `metaKeys`, and the row model
  as in the Design. Remove `listObjects`, `listColumns` and the old keys.
- [ ] **Step 5: Run.** `npm --prefix frontend test`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -am "Model functions, types, sequences, indexes and keys in the tree"`

### Task 8: Render the tree

**Files:**
- Modify: `frontend/src/components/StructureTree.tsx`
- Test: `frontend/e2e/structure.spec.ts`

- [ ] **Step 1: Implement.** Switch the queries to `describeSchema` /
  `describeObject` and the new keys, rename `objects`/`columns` to
  `contents`/`details`, and render `section`, `enum` and `item` rows and
  column badges as in the Design. `npm --prefix frontend run build`
  must pass (it runs `tsc -b`), and `npm --prefix frontend run lint`.
- [ ] **Step 2: Write the e2e test** "a table's keys and indexes" in
  `structure.spec.ts`: with a fresh table name `child_<ts>`, run
  `create table child_<ts> (id integer primary key, t_id int references t(id), code text unique)`
  and `create index child_<ts>_t on child_<ts> (t_id)`, press Refresh,
  open the table: `id` row contains `PK`, `t_id` row contains `FK`;
  open Indexes: `child_<ts>_t` and a `sqlite_autoindex_` row; open Keys:
  "Primary key", "Unique", "Foreign key" rows. Drop the table at the
  end. The existing test must still pass unchanged.
- [ ] **Step 3: Run.** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e`.
  Expected: PASS.
- [ ] **Step 4: Look at it.** Run the app against a Postgres with the
  pg test's objects (or any database with enums and functions) and
  check the tree by eye: alignment of badges, long definitions truncate
  with the full text in the tooltip, the keyboard walks into sections
  and enums.
- [ ] **Step 5: Commit.** `git commit -am "Show functions, types, sequences, indexes and keys in the structure tree"`

### Task 9: Docs

**Files:**
- Modify: `docs/DESIGN.md`, `README.md`

- [ ] **Step 1: DESIGN.** In Introspection, describe the tree's new
  groups and sections, the two calls per expand, extension members
  hidden, and what Redshift gets. Opening a schema makes one call
  (`describe-schema`), opening an object one more (`describe-object`). In the handler table (Structure row),
  `list-schemas`, `describe-schema`, `describe-object`,
  `completion-schema`; later `object-ddl`, `schema-ddl`,
  `diagram-model`. In the roadmap, milestone 2: "Indexes, keys,
  functions, types and sequences in the tree done <date>; dist and sort
  keys backlogged." In Unverified, the Redshift `functions`
  (no `prokind`, `oidvectortypes`) and `constraints` queries.
- [ ] **Step 2: README.** The Structure feature line (line 31) and the
  "Next up" paragraph (around line 86).
- [ ] **Step 3: Commit.** `git commit -am "Document structure details"`

### Task 10: Full check

- [ ] **Step 1:** `lgx test`, `lgx test-pg`, `npm --prefix frontend test`,
  `lgx smoke`, `lgx smoke-pg`, `lgx e2e` (with the server-mode prefix on
  Linux). Expected: all PASS.
- [ ] **Step 2:** Mark this plan `**Status: completed**` under its title
  and commit: `git commit -am "Plan: structure details completed"`.
