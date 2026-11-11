# Redshift SUPER Type Name Implementation Plan

**Status: completed (Tasks 1-2); Task 3 is the manual check on a real cluster, left for the user.**

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Redshift `SUPER` column reports the type `SUPER` instead of `4000`, so its JSON is formatted in the row details panel and exported as raw JSON.

**Tech Stack:** let-go (`src/quel/cells.lg`, `src/quel/exec.lg`), let-go tests through `lgx test`.

---

## Design

### The bug

A small JSON value in a Redshift `SUPER` column shows as plain text in the
row details panel, and the column's type label reads `4000`.

Result column types come from `sql.shim/ColumnTypeNames`
(`src/quel/exec.lg`, `run-rows`), which asks pgx. pgx names only the types
in its type map; for any other type it returns the type's OID as a decimal
string (`stdlib/sql.go`, `ColumnTypeDatabaseTypeName`). Redshift's `SUPER`
has OID 4000 and is not in pgx's map, so the column's type is `"4000"`.

Everything downstream decides by type name:

- `frontend/src/grid/json.ts` `isJsonType` (`/^(JSONB?|SUPER)$/i`) gates
  formatting in the row details panel;
- `frontend/src/grid/export.ts` `rawJson` uses the same check to write the
  cell as raw JSON in a JSON export;
- the grid header and the panel show the name as it is.

So the frontend already handles `SUPER`; it never receives that name.

### The fix

Translate the driver's type names in the backend, once, where they are
read. A static map per engine, in `quel.cells` (the namespace that already
turns driver output into what the grid can render):

```clojure
;; pgx names only the types in its type map and reports any other as its
;; OID. These are the ones worth a name.
(def ^:private oid-names
  {:redshift {"4000" "SUPER"}})

(defn type-names
  "The driver's column type names as the grid shows them: an OID pgx has
   no name for becomes its type's name, anything else stays as it is."
  [engine names]
  (let [known (get oid-names engine)]
    (mapv #(get known % %) names)))
```

`run-rows` takes the engine and passes the driver's names through
`cells/type-names`. The translated names are the ones kept with the cursor
(`:types`) and sent in `:columns`, so the first page and later pages agree.

### Decisions

- **Redshift only.** The map is keyed by engine and has no `:postgres`
  entry: on Postgres OID 4000 is not `SUPER`, and a wrong name is worse
  than a number. A Redshift cluster reached through a tunnel must be
  opened as Redshift (a profile with the Redshift engine, or a
  `redshift://` URL), as the rest of the app already requires.
- **Only `SUPER`.** It is the reported bug and the one OID confirmed by
  the report. Other unnamed types (Redshift `GEOMETRY`, `VARBYTE`,
  `HLLSKETCH`; Postgres enums, domains, extension types) keep showing
  their OID. The general fix, resolving unknown OIDs from `pg_type` per
  session, goes to the backlog (Task 1).
- **Backend, not frontend.** One place fixes the panel, the header and the
  export; the frontend keeps deciding by name.
- **No frontend change, no size-limit change.** The 256 KiB input and
  1 MiB formatted limits in `grid/json.ts` stay.
- `cells/encode` is unaffected: it looks at `BYTEA`, `BLOB` and the time
  types only.

### Testing

`type-names` is a pure function, tested in `test/quel/cells_test.lg`.
Redshift itself cannot run in the test suite (the Postgres tests in Docker
have no `SUPER`), so the end-to-end check is manual: on a real cluster,
select a `SUPER` column and open row details.

## File Structure

- `docs/backlog/pg-unnamed-types-show-oid.md` — new backlog entry for the
  general fix.
- `src/quel/cells.lg` — `oid-names` and `type-names`.
- `src/quel/exec.lg` — `run-rows` takes the engine and translates the
  names; its one caller passes the engine.
- `test/quel/cells_test.lg` — tests for `type-names`.
- `docs/DESIGN.md` — a sentence where column types are described.

## Tasks

### Task 1: Backlog the general fix

**Files:**
- Create: `docs/backlog/pg-unnamed-types-show-oid.md`

- [x] **Step 1: Write the entry**
  Follow the shape of the other entries (`docs/backlog/redshift-dist-sort-keys.md`):
  title, `**Status: open**`, `## Problem`, `## Proposed fix`, `## Origin`.
  - Title: "Postgres and Redshift types pgx cannot name show as an OID".
  - Problem: pgx returns the OID as a string for a type outside its type
    map (`ColumnTypeDatabaseTypeName`), and `run-rows` passes it on. The
    result grid's header and the row details panel then show a number for
    Postgres enums, domains, composite and extension types (`citext`,
    `hstore`), and for Redshift types other than `SUPER` (`GEOMETRY`,
    `VARBYTE`, `HLLSKETCH`). Anything that decides by type name misses
    them. `SUPER` alone is mapped by hand in `quel.cells/type-names`.
  - Proposed fix: when a result has a type name made only of digits,
    look the OIDs up in `pg_type` (`select oid, typname from pg_type where
    oid = any(...)`) on the same connection and cache the answers per
    connection. Upper-case the name like pgx does. Note the costs: one
    more query the first time a type appears, it must not run on the
    user's session inside their transaction in a way that changes its
    state, and it must be cancellable with the run. Check on a real
    Redshift cluster that `pg_type` lists its own types. Once it lands,
    the static map can go.
  - Origin: found 2026-11-11 while fixing unformatted JSON in a Redshift
    `SUPER` column; the static map was chosen as the small fix.

- [x] **Step 2: Commit, alone**
  `git add docs/backlog/pg-unnamed-types-show-oid.md && git commit -m "Backlog: types pgx cannot name show as an OID"`

### Task 2: Translate type names in the backend

**Files:**
- Modify: `src/quel/cells.lg`
- Modify: `src/quel/exec.lg`
- Test: `test/quel/cells_test.lg`

- [x] **Step 1: Write the failing tests**
  In `test/quel/cells_test.lg`, a `deftest` for `cells/type-names`:
  - `(cells/type-names :redshift ["INT4" "4000" "TEXT"])` is
    `["INT4" "SUPER" "TEXT"]`;
  - `:postgres` and `:sqlite` leave `["4000"]` as it is;
  - an unknown OID on Redshift (`"3000"`) stays;
  - `[]` gives `[]`, and the result is a vector.

- [x] **Step 2: Run them to see them fail**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test` (plain `lgx test` on macOS)
  Expected: FAIL, `type-names` is not defined.

- [x] **Step 3: Implement `type-names`**
  Add `oid-names` and `type-names` to `src/quel/cells.lg` as in the Design
  section, after `time-layouts`. Update the `encode` docstring: the type
  name is the one `type-names` returns.

- [x] **Step 4: Use it in `run-rows`**
  In `src/quel/exec.lg`, give `run-rows` the engine as its first argument
  (`[engine session ctx q page-size]`), bind
  `types (cells/type-names engine (shim/ColumnTypeNames rows))`, and pass
  `engine` at the one call site in the run function (it is already bound
  there from `conn/engine`). Mention in the `run-rows` docstring that
  `:types` are the translated names. Nothing else changes: `:columns`,
  `read-page` and `open-cursor!` already take `types` from this binding.

- [x] **Step 5: Run the tests**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`
  Expected: PASS, including the existing `exec_test.lg` (SQLite names are
  untouched).

- [x] **Step 6: Update the design doc**
  In `docs/DESIGN.md`, at "Column types: `sql.shim/ColumnTypeNames` returns
  them as strings." (near line 1188), add that pgx reports a type it
  cannot name as its OID, and that `quel.cells/type-names` gives Redshift's
  `SUPER` (OID 4000) its name; other unnamed types are in
  `docs/backlog/pg-unnamed-types-show-oid.md`.

- [x] **Step 7: Commit**
  `git commit -am "Name Redshift SUPER columns so their JSON is formatted"`

### Task 3: Check on a real cluster (manual, for the user)

- [ ] **Step 1:** `lgx run`, connect to Redshift, run a query that returns
  a `SUPER` column, and open row details. Expected: the type label reads
  `super`, the value is indented and highlighted, and a JSON export writes
  it as a nested object, not a string. If the label still shows a number,
  that number is the OID to put in `oid-names`.

## Completion summary

**Implemented:** `quel.cells/type-names` with a Redshift-only `oid-names` map
(`"4000"` becomes `"SUPER"`). `quel.exec/run-rows` now takes the engine and runs
the driver's names through it, so `:columns` and the cursor's `:types` agree
from the first page on. Added tests in `test/quel/cells_test.lg`, a note in
`docs/DESIGN.md`, and a backlog entry for the general fix
(`docs/backlog/pg-unnamed-types-show-oid.md`). Commits: `6bdd12c` (backlog,
alone) and `7844ded` (code).

**Verification:** `lgx test` 210 tests, 0 failures. `lgx test-pg` 0 failures.
`lgx smoke-pg` ok. Frontend 616 tests passed. `lgx e2e` 61 passed, 1 skipped.
Codex found nothing in either commit. Redshift was not available here, so Task 3
has not been run.

**Issues:** none.

**Deviations:** none from the design. TaskCreate/TaskUpdate were not available
in this session, so this document was the only progress tracker.

**What the plan could have specified better:** nothing.
