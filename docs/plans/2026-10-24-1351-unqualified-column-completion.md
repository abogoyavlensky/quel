# Unqualified Column Completion Implementation Plan

**Status: completed**

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor offers bare column names from the tables in the current statement (`select em▮ from customers` offers `email`), alongside lang-sql's own completions.

**Tech Stack:** CodeMirror 6 (`@codemirror/lang-sql` 6.10, `@codemirror/autocomplete`, `@codemirror/language`'s syntax tree), TypeScript, Vitest, Playwright. Frontend only.

---

## Design

### Where this starts

Backlog entry: `docs/backlog/unqualified-column-completion.md`. The
structure tree work (PR #8, `docs/plans/2026-10-23-2224-structure-tree.md`)
feeds `completion-schema` into lang-sql (`frontend/src/editor/setup.ts`,
`languageFor`). lang-sql completes along paths only: `customers.▮`,
`c.▮` for an alias, `main.customers.▮`. It never offers a column without
its table, so `select em▮ from customers` offers no `email`. DataGrip
and TablePlus both do.

Cut a branch `unqualified-column-completion` from master.

### Approach

Add a second completion source, `columnCompletionSource(schema, engine)`, in a
new pure module `frontend/src/editor/columns.ts`. It is registered as
language data on the SQL language next to lang-sql's sources, and
CodeMirror merges the results of every source. lang-sql keeps doing
everything it does today. The new source only adds bare columns where a
column can go.

It reads lang-sql's syntax tree (lezer), whose statements parse flat:

```
Statement  select em from public.customers c join "Orders" o on o.cid = c.id where x
  Keyword select · Identifier em · Keyword from · CompositeIdentifier public.customers
  Identifier c · Keyword join · QuotedIdentifier "Orders" · Identifier o · Keyword on · ...
Statement  select a from (select b from t) x
  Keyword select · Identifier a · Keyword from · Parens (select b from t) · Identifier x
    Parens: ( · Keyword select · Identifier b · Keyword from · Identifier t · )
Statement  update t set a = 1          Keyword update · Identifier t · Keyword set · ...
Statement  insert into t (a, b) ...    Keyword insert · Keyword into · Identifier t · Parens (a, b)
```

(Checked against lang-sql 6.10's parser; a comma is `Punctuation ","`.)

On each completion request the source:

1. **Decides whether to answer.** It takes the node before the cursor
   (`syntaxTree(state).resolveInner(pos, -1)`), and answers only when
   the cursor is on an `Identifier` or `QuotedIdentifier` (or on nothing
   with an explicit Ctrl+Space). It returns null when:
   - the identifier has a `.` before it (the qualified path is
     lang-sql's);
   - the cursor is in a `String` or a comment;
   - the token before is a table-position keyword (`from`, `join`,
     `update`, `into`, `table`) or a `,` inside a `FROM` list. Columns
     there would be noise.
2. **Finds the scope:** the nearest enclosing `Parens` that has a
   `select` keyword among its children (a subquery), else the enclosing
   `Statement`. A `Parens` without `select` (an `insert` column list,
   `count(...)`, a `where` group) is not a scope, so the search goes on
   outward. Inside a subquery, only the subquery's tables count.
3. **Collects the scope's tables** by scanning its direct children in
   order. An identifier node (`Identifier`, `QuotedIdentifier`,
   `CompositeIdentifier`) is a table when the meaningful token before it
   is `from`, `join`, `update` or `into`, or a `,` while in a `FROM`
   list. The `FROM` list starts at `from` and ends at `where`, `group`,
   `having`, `order`, `union`, `intersect`, `except`, `limit`, `offset`,
   `fetch`, `for`, `on`, `using`, `set` or `values`. A `Parens` in a
   table position (a derived table) is skipped. Aliases are not needed:
   a table's columns are offered bare whatever it is called. Names are
   unquoted as lang-sql's `idName` does (strip one pair of `"`, `` ` ``
   or `[]`), and a `CompositeIdentifier` gives a `[schema, table]` path.
4. **Resolves each table** in the raw completion schema
   (`CompletionSchema`, unescaped names). Each path component keeps
   whether it was quoted. A component is matched by the engine's rules:
   - quoted: exactly, on every engine;
   - unquoted on Postgres/Redshift: folded to lower case first, then
     matched exactly. So `FROM Customers` reads `customers` even when a
     `"Customers"` table exists too, as Postgres does;
   - unquoted on SQLite: case-insensitively (SQLite identifiers are),
     preferring an exact match.

   `[schema, table]` is looked up directly. A bare `table` is looked up
   in the default schema first; failing that, it is used if exactly one
   schema has that table, and skipped if several do (no guessing).
5. **Offers the columns** of every resolved table, de-duplicated by name
   in statement order. Each option has `type: "property"`, `detail` set
   to the table name (or `"a, b"` when several tables share the column)
   and `boost: 5`, so for a fair match it ranks above keywords and table
   names. A name is applied quoted when it is not a plain lower-case
   identifier (`/^[a-z_][a-z_\d]*$/`) or is a reserved word, with any
   `"` inside doubled: `Name` → `"Name"`, `order` → `"order"`, `a"b` →
   `"a""b"`. The reserved words are fixed sets in `columns.ts`, one per
   engine, each pinned to its documentation:
   - Postgres: the words marked "reserved" (and "reserved (can be
     function or type)") in the PostgreSQL 17 manual's Appendix C, *SQL
     Key Words*;
   - Redshift: that same set plus Amazon Redshift's *Reserved words*
     page (`open`, `tag`, `timestamp`, ...);
   - SQLite: the full list on sqlite.org's *SQLite Keywords* page
     (`lang_keywords.html`, 147 words, including `autoincrement`,
     `isnull` and `notnull`). SQLite accepts many of them as bare names,
     but quoting is always safe there;
   - no engine (no profile): the union of the three.

   Each set is a literal array with a comment naming its source. lang-sql's
   own keyword list is not used: it holds everyday names (`name`, `id`,
   `type`) that need no quotes. The label stays the bare name; only
   `apply` carries the quotes. When the cursor is inside a
   `QuotedIdentifier`, the result starts at the node, with labels quoted,
   as lang-sql does. `validFor: /^[\w"]*$/` lets
   CodeMirror filter while typing without asking again.

The source answers in microseconds over a statement's direct children:
no extra parsing, no backend call. The data is the `completion-schema`
the editor already has.

### Wiring

`Completion` (`setup.ts`) gains the raw schema next to lang-sql's
namespace:

```ts
export interface Completion {
  schema: SQLNamespace;          // namespaceOf(data): dots escaped, for lang-sql
  defaultSchema?: string;
  raw: CompletionSchema;         // as completion-schema returned it
}
```

`languageFor(engine, completion)` returns, with a completion,
`[support, support.language.data.of({ autocomplete:
columnCompletionSource(completion.raw, engine) })]`, where `support = sql({...})`
as today. A `Compartment` takes an array, so `language.reconfigure` in
`SqlEditor` is unchanged. `useCompletion` in `AppShell.tsx` adds `raw:
data` to the object it memoizes.

### Out of scope

CTE names (`with x as (...) select ▮ from x`; `x` is not in the
schema), columns of derived tables (`from (select ...) d`), `USING`
column lists, and completing in table positions (lang-sql's table
completion already does that). The refresh rule is unchanged: the
columns come from the same cached `completion-schema`, so a new table's
columns appear after the tree's refresh button.

### Testing

- Unit (`frontend/src/editor/columns.test.ts`): build an `EditorState`
  with `sql({ dialect: PostgreSQL })` (or `SQLite`). Put the cursor at a
  `▮` marker in the text and call the source with a `CompletionContext`
  (explicit or not). Cover:
  - `select em▮ from customers` offers `email`, `id` and `name`, with
    detail `customers`;
  - the cursor before or after `FROM`, and in `WHERE`, `ORDER BY`,
    `GROUP BY` and `ON` positions;
  - joins with aliases offer both tables' columns, and a shared column
    once with both table names in its detail;
  - `schema.table` and quoted names;
  - unquoted mixed case resolves to the lower-case table on Postgres
    even when a mixed-case table exists too, and quoted `"Mixed"`
    resolves exactly; on SQLite, unquoted `MIXED` resolves to `Mixed`;
  - a table missing from the schema is ignored, and an ambiguous one
    across schemas without the default is skipped;
  - a subquery scope sees only its own tables;
  - `update t set ▮` and `insert into t (▮` offer `t`'s columns;
  - null for `t.▮`, in a string, in a comment, after `from`, after
    `join`, after a `,` in the `FROM` list, and on an empty position
    without an explicit request;
  - a name that needs quotes is applied quoted: mixed case, a reserved
    word (`order` on Postgres; `autoincrement` and `notnull` on SQLite,
    unquoted on Postgres), an embedded `"` doubled;
  - columns do not leak between `;`-separated statements;
  - inside an open quote, the result starts at the quote.
- E2E (`frontend/e2e/structure.spec.ts`): in the existing test, after
  the `t.` check, `select na▮ from t` with Ctrl+Space offers `name`.

## File Structure

| File | Change |
|---|---|
| `frontend/src/editor/columns.ts` | Create: `columnCompletionSource(schema: CompletionSchema, engine: Engine \| null): CompletionSource` and its helpers |
| `frontend/src/editor/columns.test.ts` | Create: unit tests |
| `frontend/src/editor/setup.ts` | Modify: `Completion.raw`; `languageFor` adds the source |
| `frontend/src/components/AppShell.tsx` | Modify: `useCompletion` adds `raw` |
| `frontend/e2e/structure.spec.ts` | Modify: a bare column check |
| `docs/backlog/unqualified-column-completion.md` | Modify: status planned, then done |
| `docs/DESIGN.md` | Modify: one sentence on completion |

## Commands

On Linux without GTK4/WebKitGTK headers, prefix `lgx` commands with
`CGO_ENABLED=0 GOFLAGS=-tags=server`. Use lgx 0.5.1 (`.mise.toml`).

- `npm --prefix frontend test`, `npm --prefix frontend run lint`,
  `npm --prefix frontend run build`
- `lgx e2e`

---

### Task 1: The completion source

**Files:**
- Create: `frontend/src/editor/columns.ts`, `frontend/src/editor/columns.test.ts`

- [x] **Step 1: Branch.** `git switch -c unqualified-column-completion master`.
- [x] **Step 2: Write the failing tests** listed under Testing. A helper
  `complete(text, { dialect, explicit })` finds `▮` in `text`, removes
  it, builds the state with that dialect's `sql()` (no schema: only the
  syntax tree is needed), and returns the source's result, or null. A
  fixed `CompletionSchema` serves every case:
  `{ "default-schema": "public", schemas: { public: { customers: ["id",
  "name", "email"], orders: ["id", "customer_id", "total", "order"],
  mixed: ["low"], Mixed: ["Col", 'a"b'] }, sales: { orders: ["id",
  "region"], leads: ["id"] }, other: { leads: ["id", "source"] } } }`.
  Here `leads` is the ambiguous one (two non-default schemas), `mixed`
  and `Mixed` test case folding, and `order`, `Col` and `a"b` need
  quotes. For the SQLite cases, a second schema `{ "default-schema":
  "main", schemas: { main: { Mixed: ["Col", "autoincrement", "notnull"]
  } } }`. Assert on
  labels, `apply`, `detail` and `from`.
- [x] **Step 3: Run** `npm --prefix frontend test`. Expected: the new
  tests fail (no module).
- [x] **Step 4: Implement `columns.ts`** as in the Design's five steps.
  Keep each step a small named function (`shouldAnswer`, `scopeOf`,
  `tablesIn`, `resolve`, `options`). A file comment says what lang-sql
  covers and what this adds. Match the module style of
  `editor/namespace.ts`.
- [x] **Step 5: Run** `npm --prefix frontend test`. Expected: PASS.
- [x] **Step 6: Commit.** `git commit -m "Complete bare column names from the statement's tables"`

> Deviation: `Keyword` and `Type` nodes count as names, both at the cursor and in table positions. lang-sql's Postgres dialect parses `name`, `id`, `type`, `user`, `data`, `source` as keywords and `text`, `date` as types, so the plan's Identifier-only rule would miss a table named `user` and an explicit request on `select name▮`. lang-sql's own `sourceContext` accepts `Keyword` too.
> Deviation: `notnull` is applied quoted on Postgres too. The plan's test said unquoted, but PostgreSQL 17's Appendix C marks `notnull` and `isnull` "reserved (can be function or type)", which the plan's own rule includes. The Postgres test checks `autoincrement` unquoted and `notnull` quoted.
> Deviation: `table` is a table position for collecting as well as for declining (one state machine for both); a quoted name's doubled closing quote is undoubled when read, to match how `apply` doubles it.

### Task 2: Wire it into the editor

**Files:**
- Modify: `frontend/src/editor/setup.ts`, `frontend/src/components/AppShell.tsx`

- [x] **Step 1: `Completion.raw`, `languageFor`.** Add `raw:
  CompletionSchema` to `Completion`. With a completion, `languageFor`
  returns `[support, support.language.data.of({ autocomplete:
  columnCompletionSource(completion.raw, engine) })]`, else `support` alone.
  Update the comment above `language` to mention bare columns.
- [x] **Step 2: `useCompletion`** adds `raw: data`.
- [x] **Step 3: Run** build, lint, tests. Expected: PASS.
- [x] **Step 4: Check by hand** in server mode, never against the real
  profiles or Keychain (AGENTS.md): `CGO_ENABLED=0 GOFLAGS=-tags=server
  WAILS_SERVER_PORT=34567 LGX_RUN=1 QUEL_SECRETS=memory
  QUEL_DATA_DIR=$(mktemp -d) lgx run`, with a SQLite profile on a
  throwaway file holding
  `customers(id, name, email)` and `orders(id, customer_id, total)`):
  - `select em` + Ctrl+Space before `from customers` offers `email` first;
  - `select * from customers c join orders o on o.` still offers
    `orders`' columns (lang-sql's);
  - `select * from cu` still offers `customers`;
  - `select * from customers where na` offers `name` without Ctrl+Space
    once typing starts.
- [x] **Step 5: Commit.** `git commit -m "Offer bare columns in the editor"`

> Deviation: the hand check ran on port 34611 (34567 was held by a server-mode instance left from an earlier session) and was driven by a throwaway Playwright script rather than by hand; all four checks held.

### Task 3: End to end, docs

**Files:**
- Modify: `frontend/e2e/structure.spec.ts`, `docs/backlog/unqualified-column-completion.md`, `docs/DESIGN.md`, this plan

- [x] **Step 1: E2E.** After the `select t.` check in
  `structure.spec.ts`, add: completions for `select na` with ` from t`
  after the cursor contain `name`. Run `lgx e2e`. Expected: all specs
  pass.
- [x] **Step 2: Commit.** `git commit -m "E2E: bare column completion"`
- [x] **Step 3: Docs.** In DESIGN's Introspection section, the
  `completion-schema` sentence: completion offers schema, table and
  qualified column names (lang-sql), and bare columns of the tables in
  the statement under the cursor (`editor/columns.ts`). Set the backlog
  entry to `**Status: done**` with a line naming this plan and the PR.
  Mark this plan `**Status: completed**` with a summary.
- [x] **Step 4: Commit.** `git commit -m "Record bare column completion"`
- [ ] **Step 5: Review and PR.** Run the full frontend checks and `lgx
  e2e`, review the branch (/review-with-codex against master), fix what
  is real, push, and open a PR against master titled "Complete bare
  column names".

> Deviation: `lgx e2e` ran with mise's lgx 0.5.1 first on PATH (the shell's `lgx` was 0.4.2; `scripts/server-mode.sh` runs `$LGX` as one word, so `LGX="mise exec -- lgx"` does not work).

## Summary

Implemented `columnCompletionSource` (`frontend/src/editor/columns.ts`), a
second completion source next to lang-sql's that offers the bare columns of
the statement's FROM / JOIN / UPDATE / INSERT INTO tables, resolved by each
engine's case rules, quoted when not plain lower case or reserved (word lists
pinned to the PostgreSQL 17, Redshift and SQLite pages). Wired through
`Completion.raw` and `languageFor`; unit tests (20), an e2e check, and a hand
check in server mode. The Codex reviews found real gaps, fixed in follow-up
commits: tables leaking between a compound query's SELECTs and an INSERT's
target and source, `from only t`, a FROM list after a join condition, SQLite's
quoted-name case, and a mid-name quoted completion that corrupted the text.

Deviations, all in place above:
- `Keyword` and `Type` nodes count as names (lang-sql parses `name`, `user`,
  `data`, `text` and others so on Postgres).
- `notnull` is quoted on Postgres (Appendix C reserves it; the plan's test
  said otherwise).
- `table` is a table position for collecting too; a quoted name's doubled
  quote is undoubled when read.
- Added past the plan from review: set-operation branches and an INSERT's
  SELECT scope their own tables (RETURNING and ON CONFLICT go back to the
  target); `only` / `lateral` keep the table position;
  `ON` / `USING` no longer end the FROM list; completing inside a closed
  quoted name replaces all of it.
- SQLite matches quoted names case-insensitively too (SQLite identifiers
  are, quoted or not); the plan's "quoted: exactly, on every engine" holds
  for Postgres and Redshift only.
- The hand check ran on another port through a throwaway Playwright script;
  e2e ran with lgx 0.5.1 put on PATH.

What the plan could have specified better: check how lang-sql tokenises
everyday names (many are `Keyword` nodes on Postgres) and check the reserved-word
claims against the cited pages before pinning test expectations; and name
compound queries (UNION) as in or out of scope.
