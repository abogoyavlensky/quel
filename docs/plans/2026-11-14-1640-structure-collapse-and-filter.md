# Structure Collapse and Filter Implementation Plan

**Status: completed** (2026-11-14)

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The sidebar's Structure section folds to its header like a VS Code
sidebar section, and an always-shown input filters the tree to the tables
and views whose names match.

**Tech Stack:** React + TypeScript (frontend), TanStack Query, react-resizable-panels v4
(shadcn `Resizable`), let-go backend (`quel.workspace`, `quel.api`), Vitest,
Playwright e2e in server mode.

---

## Design

### Collapsing the Structure section

The sidebar is a vertical split today: Connections on top, Structure below
(`frontend/src/components/AppShell.tsx`). Only Structure collapses.

- **The header is the toggle.** Structure's title row becomes a disclosure
  button: a chevron (right when collapsed, down when expanded) and the
  word "Structure", inside the `h2`
  (`<h2><button aria-expanded aria-controls>…</button></h2>`). Click,
  Enter and Space toggle it. The Refresh button shows only while expanded,
  as VS Code hides a collapsed section's actions. The Refresh button's
  click must not toggle the section.
- **Drawn or left out, never collapsed.** This keeps the rule in
  `docs/DESIGN.md` (Look: the sidebar and the results are drawn or left
  out). While collapsed, the inner split renders only the Connections
  panel, and the Structure header sits under the split at the bottom of
  the sidebar. The tree, its handle and its panel are not rendered, so no
  structure query runs while it is collapsed. The inner panels get ids
  (`connections`, `structure`), so a dragged split comes back on expand,
  the way the editor/results split does.
- **Saved app-wide.** A `settings` row `structure-collapsed`, present while
  collapsed, mirrors `sidebar-hidden`: it is read at start-up without
  holding up the first render (null until read means expanded), and saves
  go one at a time through the same chain as the sidebar
  (`frontend/src/state/layout.ts`).
- **Focus follows the header.** A toggle remounts the header button (it
  moves between the panel and the bottom of the sidebar). When focus was
  in the Structure section or on its toggle, `toggleStructure` focuses the
  new toggle button after the render (a `setTimeout`, like
  `toggleSidebar` does for the editor). The button carries
  `data-quel-structure-toggle`; the section carries `data-quel-structure`.
- No palette command or key for it (decided out; a later addition if
  wanted).

### Filtering by table and view names

An input under the Structure header, shown whenever the tree is (connected
and the schema list loaded). Placeholder "Filter tables and views",
accessible name "Filter structure", a clear (×) button while it has text.

**Matching.** Case-insensitive substring of the object's name, tables and
views alike (materialized views go with views, as today). Text is trimmed;
blank means no filter. Only object names match: not schemas, columns,
functions, types, sequences or indexes.

**Where matches come from, and the SQL cost.** The tree is lazy: a schema's
objects load on open (`describe-schema`, four small catalog queries).
Completion (`completion-schema`) already holds every schema's tables and
views with their columns, fetched once per connection in one query and
cached (`useCompletion` in `AppShell.tsx`, same query key as the tree
would use). So:

1. The schemas worth loading under a filter (`filterSchemas`) are the open
   schemas plus every schema whose completion entry has a matching table
   name. Matching runs in memory per keystroke. No SQL per keystroke.
2. Those schemas' `describe-schema` loads through the existing per-schema
   query, once per schema per connection (cached until Refresh). Typing
   more narrows the set, so only widening the text can add a schema, and
   a schema fetched once stays cached.
3. Rows are built from `describe-schema` contents, the tree's own source
   of truth (object kinds, partitions hidden), so a filtered tree shows
   exactly the rows the unfiltered one would.

Limits, accepted: completion stops at 50 000 column rows
(`quel.meta/completion-limit`), and objects without columns (or an SQLite
view over a dropped table) are not in completion. Such a table is found
only when its schema is open. While completion is pending or failed, the
filter covers the open schemas only.

**The filtered tree.** For each schema, in order:

- A schema not among the loaded-under-filter schemas, or loaded with no
  match, is left out.
- A schema still loading or failed shows its row with the usual Loading or
  error row under it.
- A schema with matches shows open, with only its Tables and Views groups
  (those with matches), each open, its count the number of matches, and
  only the matching objects under it. The matched part of each object's
  name is highlighted (`<mark>`-styled span, `--search-match` tokens).
- Matched objects open and close as usual, through `treeExpanded`, and show
  their columns, indexes and keys.
- Schema and group rows open and close too, but in a filter-only set kept
  in the tree component (`filterClosed`), cleared whenever the filter text
  changes. The filter never writes schema or group keys to
  `treeExpanded`, so clearing the filter gives back the tree as it was.
- No rows at all: "No tables or views match." (or "Loading…" while
  completion or a candidate schema is still loading).

**Where the text lives.** `Workspace.treeFilter: string`, in memory, per
profile (beside `treeExpanded`), so it survives a profile switch, hiding
the sidebar and collapsing the section. Not saved to the app database.

**Keys.**

- In the input: Escape clears the text when there is some (and stops
  there); ArrowDown moves focus to the tree's first row.
- In the tree: ⌘F (Ctrl+F) focuses the input and selects its text. This is
  the registry's existing `find` entry, caught `"local"`
  (`frontend/src/state/keymap.ts`); no new entry. Match it the way
  `ResultGrid` does (`modKey(e) && !e.shiftKey && key === "f"`).

### Testing

- Backend: a settings round-trip test for `structure-collapsed`; the
  handler set in `api_test.lg` grows by two.
- Frontend unit: `state/tree.test.ts` covers `filterSchemas` and filtered
  `treeRows`; `state/layout.test.ts` covers `loadStructure` and
  `toggleStructure` (save order, focus, state).
- e2e: a new `frontend/e2e/structure-panel.spec.ts` on the fixture SQLite
  file (tables `t` and `t2` in `main`, made by `scripts/e2e.sh`).

## File Structure

| File | Change |
|---|---|
| `src/quel/workspace.lg` | Private `flag?` / `set-flag!` helpers over a settings key; `sidebar-hidden` and `set-sidebar-hidden!` use them; new `structure-collapsed` and `set-structure-collapsed!` |
| `src/quel/api.lg` | Handlers `structure-collapsed`, `set-structure-collapsed`, registered by var |
| `test/quel/workspace_test.lg` | Round-trip test for the new setting |
| `test/quel/api_test.lg` | Handler set adds the two names |
| `frontend/src/lib/api.ts` | `structureCollapsed()`, `setStructureCollapsed(collapsed)` |
| `frontend/src/state/store.ts` | `AppState.structureCollapsed: boolean \| null`; `Workspace.treeFilter: string` (`""` in `newWorkspace`) |
| `frontend/src/state/layout.ts` | Selector `structureCollapsed(s)`, `loadStructure()`, `toggleStructure()`; one save chain for both settings |
| `frontend/src/state/layout.test.ts` | Tests for the above |
| `frontend/src/App.tsx` | Call `loadStructure()` beside `loadSidebar()` |
| `frontend/src/state/runner.ts` | `setTreeFilter(profileId, text)` beside `setTreeExpanded` |
| `frontend/src/state/tree.ts` | `matchAt`, `filterSchemas`, `TreeFilter`, filter mode in `treeRows`, `match` on object rows |
| `frontend/src/state/tree.test.ts` | Tests for filter mode |
| `frontend/src/components/StructureTree.tsx` | `StructureHeader` (exported), filter input, filter-mode wiring, highlight |
| `frontend/src/components/AppShell.tsx` | Inner split with ids; collapsed layout |
| `frontend/e2e/structure-panel.spec.ts` | New e2e spec |
| `docs/DESIGN.md` | Look (sidebar paragraph), Introspection (filter), Handler API (Workspace row) |
| `docs/backlog/structure-filter-completion-cap.md` | New entry: the filter's completion-cap limit |

## Tasks

Work happens on the branch `structure-collapse-filter` (made from
`master` at `ee768fd`, holding this plan).

**Running the app by hand** (Tasks 3 and 5): never against the real
profiles, Keychain or GitHub. Use the server-mode helper, which sets
`QUEL_SECRETS=memory`, a temporary `QUEL_DATA_DIR` and `QUEL_UPDATES=off`:

```bash
CGO_ENABLED=1 GOFLAGS=-tags=server bash -c \
  'source scripts/server-mode.sh && start_app && echo "$base" && wait "$app_pid"'
```

Open the printed URL in a browser and add a SQLite connection to a
scratch file with two tables (`sqlite3 /tmp/quel-manual.db "create table
t (id integer); create table t2 (id integer)"`).

### Task 1: Backend setting

**Files:**
- Modify: `src/quel/workspace.lg`, `src/quel/api.lg`
- Test: `test/quel/workspace_test.lg`, `test/quel/api_test.lg`

- [x] **Step 1: Write the failing tests.** In `workspace_test.lg`, next to
  `the-sidebar-setting-round-trips`, add
  `the-structure-setting-round-trips` with the same shape against
  `structure-collapsed` / `set-structure-collapsed!` (false at first; true
  twice is one row; false removes the row; the count query uses key
  `'structure-collapsed'`). In `api_test.lg`
  `every-handler-is-a-var`, add `"structure-collapsed"
  "set-structure-collapsed"` to the expected set.
- [x] **Step 2: Run them to see them fail.**
  Run: `CGO_ENABLED=1 GOFLAGS=-tags=server lgx test`
  Expected: the two tests fail (unresolved symbol / set mismatch).
- [x] **Step 3: Implement.** In `workspace.lg`, add private helpers
  `(defn- flag? [db k])` and `(defn- set-flag! [db k on?])` holding the
  existing SQL with the key as a parameter (`where key = ?`,
  `values (?, 'true')`). Rewrite `sidebar-hidden` / `set-sidebar-hidden!`
  over them (docstrings unchanged), and add `structure-collapsed`
  ("Whether the user collapsed the Structure section: a settings row
  while collapsed, none while expanded.") and `set-structure-collapsed!`.
  In `api.lg`, add `structure-collapsed` and `set-structure-collapsed`
  beside the sidebar pair (the setter passes `(true? collapsed?)`), and
  register `"structure-collapsed" #'structure-collapsed` and
  `"set-structure-collapsed" #'set-structure-collapsed` after the sidebar
  entries.
- [x] **Step 4: Run the tests.**
  Run: `CGO_ENABLED=1 GOFLAGS=-tags=server lgx test`
  Expected: PASS.
- [x] **Step 5: Commit.** `git commit -m "Save whether the Structure section is collapsed"`

### Task 2: Collapse state in the frontend

**Files:**
- Modify: `frontend/src/lib/api.ts`, `frontend/src/state/store.ts`,
  `frontend/src/state/layout.ts`, `frontend/src/App.tsx`
- Test: `frontend/src/state/layout.test.ts`

- [x] **Step 1: API and store.** In `api.ts`, beside the sidebar pair:
  `structureCollapsed = async () => (await call<unknown>("structure-collapsed")) === true`
  and `setStructureCollapsed = (collapsed: boolean) => call<void>("set-structure-collapsed", collapsed)`.
  In `store.ts`, add `structureCollapsed: boolean | null` to `AppState`
  with a comment like `sidebarHidden`'s, `null` in `initialState()`.
- [x] **Step 2: Write the failing tests** in `layout.test.ts` (extend the
  hoisted `api` mock with `structureCollapsed` and `setStructureCollapsed`):
  - `loadStructure` sets the saved value; a toggle made before the answer
    wins; a failed read leaves `null`.
  - `toggleStructure` flips `structureCollapsed` (null counts as
    expanded), saves each change, and saves in order when the first save
    is slow (same shape as the sidebar's ordering test); a failed save
    keeps the new state.
  - Sidebar and structure saves share one chain: a slow sidebar save holds
    a structure save behind it.
  - With focus inside `[data-quel-structure]` (stub `document.activeElement`
    and `document.querySelector`, as the sidebar focus test stubs
    `document`), after the timers run the element matching
    `[data-quel-structure-toggle]` gets `focus()`; with focus elsewhere,
    nothing is focused.
- [x] **Step 3: Run them to see them fail.**
  Run: `npm --prefix frontend test -- layout`
  Expected: FAIL (missing exports).
- [x] **Step 4: Implement** in `layout.ts`: `structureCollapsed(s) =
  s.structureCollapsed === true`; `loadStructure()` shaped like
  `loadSidebar()`; `toggleStructure()`:

  ```ts
  export function toggleStructure(): void {
    const collapsed = !structureCollapsed(store.getState());
    const refocus = !!document.activeElement?.closest("[data-quel-structure]");
    store.setState({ structureCollapsed: collapsed });
    saving = saving.then(() => api.setStructureCollapsed(collapsed)).catch(() => {});
    if (refocus) setTimeout(() => document.querySelector<HTMLElement>("[data-quel-structure-toggle]")?.focus());
  }
  ```

  Update the file's top comment with a paragraph on the Structure
  section. Unlike the sidebar, it toggles with or without a tab strip (its
  header is always there while the sidebar is). In `App.tsx`, call
  `void loadStructure();` after `void loadSidebar();`.
- [x] **Step 5: Run the tests.**
  Run: `npm --prefix frontend test -- layout`
  Expected: PASS.
- [x] **Step 6: Commit.** `git commit -m "Add the Structure section's collapsed state"`

### Task 3: Collapsible Structure section in the UI

**Files:**
- Modify: `frontend/src/components/StructureTree.tsx`, `frontend/src/components/AppShell.tsx`

- [x] **Step 1: `StructureHeader`.** In `StructureTree.tsx`, export
  `StructureHeader({ collapsed })`. It renders the title row:
  `<h2 id="structure-title">` holding a `<button type="button"
  data-quel-structure-toggle aria-expanded={!collapsed}
  aria-controls="structure-body" onClick={toggleStructure}>` with a
  `ChevronRightIcon` (rotated 90° when expanded, as the tree's chevrons
  do) and "Structure", styled like today's title (text-xs, medium,
  muted). While expanded it also renders the Refresh button (unchanged
  behaviour), so the header needs the connection id: compute it inside
  the header from the store, as `StructureTree` does today. The whole
  row's left part is the button. Keep the row's height the same in both
  states.
- [x] **Step 2: `StructureTree`.** Render `<StructureHeader collapsed={false} />`
  in place of today's header block. Give the `section` `data-quel-structure`
  and keep `aria-labelledby="structure-title"`. Wrap what is under the
  header in `<div id="structure-body" className="flex min-h-0 flex-1 flex-col">`.
- [x] **Step 3: `AppShell`.** Read `structureCollapsed` from the store
  (`useApp(structureCollapsed)`). Replace the inner split with:

  ```tsx
  <div className="flex h-full min-h-0 flex-col">
    <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
      <ResizablePanel id="connections" minSize={80}>
        <ConnectionsPanel />
      </ResizablePanel>
      {!collapsed && (
        <>
          <ResizableHandle />
          <ResizablePanel id="structure" defaultSize="60" minSize={120}>
            <StructureTree />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
    {collapsed && (
      <section data-quel-structure="" aria-labelledby="structure-title" className="border-t text-[15px]">
        <StructureHeader collapsed />
      </section>
    )}
  </div>
  ```

  The default size moves from Connections (40 today) to Structure (60),
  following `AppShell`'s rule: the default size sits on the panel that
  comes and goes, and the one without takes what is left, so Connections
  fills the group on its own while Structure is collapsed.

  Match the collapsed header's padding to the expanded one (`px-3 pt-3
  pb-1`, or `py-2` if that looks unbalanced at the bottom; pick what reads
  as one header line). Update the `AppShell` top comment: the Structure
  section can be collapsed to its header.
- [x] **Step 4: Check it by hand.** Run the app as in "Running the app by
  hand" above and connect the scratch file.
  > Deviation: checked after Task 6 instead, through Playwright screenshots of
  > the server-mode app (expanded, filtered, collapsed) and the e2e spec,
  > rather than a hand-run browser session. Collapse: Connections fills the column, the header
  sits at the bottom, the Refresh button is gone. Expand: the tree comes
  back with its expanded nodes. Drag the split, collapse, expand: the
  dragged size returns. If react-resizable-panels does not restore it
  here, note that in the DESIGN paragraph (the split comes back at its
  default) instead of working around it. Tab to the header and press
  Enter and Space: focus stays on the header after each toggle.
- [x] **Step 5: Build and type-check.**
  Run: `npm --prefix frontend run build` (or `lgx fe-build`)
  Expected: no type errors.
- [x] **Step 6: Commit.** `git commit -m "Collapse the Structure section from its header"`

### Task 4: Filter rows

**Files:**
- Modify: `frontend/src/state/tree.ts`
- Test: `frontend/src/state/tree.test.ts`

Shared shapes (Task 5 relies on them):

```ts
// Where `text` (already trimmed, non-empty) starts in `name`, ignoring
// case; -1 when it does not occur.
export function matchAt(name: string, text: string): number;

// The schemas to load under a filter: the open ones, and those whose
// completion entry has a matching table or view name, in `schemas` order.
export function filterSchemas(
  schemas: SchemaInfo[],
  completion: CompletionSchema | undefined,
  text: string,
  expanded: ReadonlySet<string>,
): string[];

export interface TreeFilter {
  text: string;                 // trimmed, non-empty
  closed: ReadonlySet<string>;  // schema and group keys the user closed under this filter
}

// treeRows(data, expanded, filter?): with a filter, the filtered tree.
// The object row gains `match?: number` (where the text starts in the label).
```

- [x] **Step 1: Write the failing tests** in `tree.test.ts`:
  - `matchAt`: case-insensitive (`matchAt("Orders", "ord") === 0`,
    `matchAt("orders", "DER") === 2`), `-1` on no match.
  - `filterSchemas`: an open schema is always included; a closed schema is
    included only when completion has a matching table; without
    completion only open schemas; order follows `schemas`.
  - `treeRows` with a filter:
    - only matching tables and views show, under open `Tables` / `Views`
      group rows whose detail is the match count; Functions, Types and
      Sequences groups do not show even when the schema has them;
    - a schema with loaded contents and no match is left out; a schema
      absent from `contents` is left out; a pending schema shows its row
      and a `loading` row; a failed one its `error` row;
    - schema and group rows are `expanded: true` regardless of
      `expanded`, and `expanded: false` with their children hidden when
      their key is in `filter.closed`;
    - a matched object follows `expanded` as usual: open, it shows its
      columns from `details`;
    - object rows carry `match` (the index from `matchAt`);
    - materialized views count as views;
    - with no filter, `treeRows` output is unchanged (the existing tests
      keep passing without edits).
- [x] **Step 2: Run them to see them fail.**
  Run: `npm --prefix frontend test -- tree`
  Expected: FAIL.
- [x] **Step 3: Implement.** `matchAt` lower-cases both sides
  (`toLowerCase`) and uses `indexOf`. Lower-casing can change a string's
  length (rare Unicode), so the index is right for filtering but may be
  off for the highlight: the renderer (Task 5, Step 7) checks the slice
  before highlighting. In `treeRows`, branch on `filter` per schema: build the
  schema row, then only the `tables` and `views` groups with members
  filtered by `matchAt(o.name, filter.text) >= 0`, open unless in
  `filter.closed`; object rows and `objectRows` exactly as today, plus
  `match`. Add `match?: number` to the `object` variant of `TreeRow`.
  Update the file's top comment with a short paragraph on filter mode.
  `toggle` is unchanged.
- [x] **Step 4: Run the tests.**
  Run: `npm --prefix frontend test -- tree`
  Expected: PASS.
- [x] **Step 5: Commit.** `git commit -m "Build the structure tree's rows under a filter"`

### Task 5: Filter input and wiring

**Files:**
- Modify: `frontend/src/state/store.ts`, `frontend/src/state/runner.ts`,
  `frontend/src/components/StructureTree.tsx`

- [x] **Step 1: State.** Add `treeFilter: string` to `Workspace` (comment:
  the structure filter's text, in memory only, per profile) and
  `treeFilter: ""` to `newWorkspace`. Fix any place that builds a
  `Workspace` literal and now fails to type-check (tests included). In
  `runner.ts`, add `setTreeFilter(profileId, text)` beside
  `setTreeExpanded`.
- [x] **Step 2: Data in `Tree`.** Read `workspace.treeFilter`;
  `text = treeFilter.trim()`. Read completion with
  `useQuery({ queryKey: metaKeys.completion(connId), queryFn: () => api.completionSchema(connId) })`
  (the same key and function as `useCompletion`, so it shares the cache;
  move the query options into one exported helper in `lib/query.ts` or
  `lib/api.ts` if that reads better, and use it in both places). With
  text, `shown = filterSchemas(schemaList, completion.data, text, expanded)`,
  else `openSchemas(...)` as today. Keep
  `const [filterClosed, setFilterClosed] = useState<Set<string>>(new Set())`,
  reset to empty when `text` changes (key it by text: store
  `{ text, keys }` and treat a stale `text` as empty, rather than an
  effect, so there is no render with stale keys). Pass
  `filter = text ? { text, closed } : undefined` to both `treeRows` calls.
- [x] **Step 3: Toggles.** `flip(row)`: under a filter, a `schema` or
  `group` row toggles its key in `filterClosed`; every other row (and
  every row without a filter) goes through `setTreeExpanded` as today.
- [x] **Step 4: The input.** Above the scroller (inside `Tree`, so it
  shows only while the tree does), an `InputGroup` (`ui/input-group.tsx`)
  or plain `Input` with a `SearchIcon` addon and, while there is text, a
  clear button (`aria-label="Clear filter"`, `XIcon`). Compact: `h-7`,
  `text-xs`, horizontal padding matching the tree (`px-1.5` wrapper).
  `aria-label="Filter structure"`, `placeholder="Filter tables and views"`,
  `value={treeFilter}`, `onChange` → `setTreeFilter`. `onKeyDown`:
  Escape with text clears it and stops propagation; ArrowDown prevents
  default and calls `moveTo(0)` when there are rows. Keep a ref to the
  input.
- [x] **Step 5: ⌘F in the tree.** In the tree's `onKeyDown`, before the
  `switch`: `modKey(e) && !e.shiftKey && e.key.toLowerCase() === "f"` →
  `handled()`, then focus and select the input. None of these keys reach
  the page's capture-phase listener first: `onPageKey`
  (`state/pageKeys.ts`) acts only on `PAGE_KEYS` ids, and `find` (⌘F),
  Escape and ArrowDown are not among them, so React's `onKeyDown` sees
  them.
- [x] **Step 6: Empty and loading states.** The early returns for the
  schema list stay as they are. When `rows` is empty under a filter, show
  "Loading…" if completion or any `shown` schema is pending, else "No
  tables or views match." in the same style as "No schemas." (under the
  input, not in place of it).
- [x] **Step 7: Highlight.** In `RowBody`'s `object` case, when
  `row.match !== undefined && row.match >= 0` and the label's slice at
  `match` lower-cases to the filter text, split the label into three
  spans with the middle one styled as a match (`bg-[var(--search-match)]`
  or the class the grid find uses for matches; reuse it). `RowBody`
  needs the filter text: pass it as a prop.
- [x] **Step 8: Check it by hand** in the app run as in "Running the app
  by hand", on the scratch file:
  typing `t2` leaves `main › Tables › t2`; `T` matches both tables;
  Escape clears and the tree is as before; ⌘F in the tree focuses the
  input; ArrowDown from the input focuses the first row; a closed schema
  folds under the filter and the fold is gone after editing the text.
- [x] **Step 9: Tests and build.**
  Run: `npm --prefix frontend test && npm --prefix frontend run build`
  Expected: PASS, no type errors.
- [x] **Step 10: Commit.** `git commit -m "Filter the structure tree by table and view names"`

### Task 6: End-to-end tests

**Files:**
- Create: `frontend/e2e/structure-panel.spec.ts`

> Deviation: the fixture file has only table `t` (`t2` is in the second
> file). The filter test makes its own table, `filter_e2e_orders`, through
> the editor and refreshes the structure; the closed-schema test filters on
> `t`.

- [x] **Step 1: Write the spec**, following `sidebar.spec.ts` (fixture
  connection via `connectFixture`, save-response waiting, an `afterEach`
  that expands the section again so later specs see the tree):
  - **Collapse.** The header button has `aria-expanded="true"`; click it
    (wait for the `set-structure-collapsed` save): the `tree` named
    "Structure" is gone, the button reads `aria-expanded="false"`, the
    Refresh button is gone, the saved connections list is still visible.
    Reload: still collapsed. Focus the button and press Enter: the tree is
    back and the button is focused.
  - **Filter.** Type `t2` in "Filter structure": treeitem `t2` visible,
    treeitem `t` gone. Clear with Escape: `t` is back. Type `T`: both
    show. Type `nothing_matches`: the text "No tables or views match."
    shows. Clear with Escape and wait for treeitem `t`; click it, press
    ControlOrMeta+f: the input is focused. Press ArrowDown: a treeitem is
    focused.
  - **A closed schema.** With the filter empty, click treeitem `main` so
    it closes (`aria-expanded="false"`, `t` gone). Type `t2`: `main`
    shows open with `t2` under it (completion picked the schema). Clear:
    `main` is closed again, as it was.
  - Assert presence only ("`t` and `t2` show"), never exact row counts:
    `structure.spec.ts` adds `structure_e2e_*` tables to the shared
    fixture file.
- [x] **Step 2: Run it.**
  Run: `CGO_ENABLED=1 GOFLAGS=-tags=server lgx e2e`
  Expected: PASS, the existing specs too (`structure.spec.ts`,
  `sidebar.spec.ts`, `palette.spec.ts` touch the sidebar).
- [x] **Step 3: Commit.** `git commit -m "Test the Structure section's collapse and filter end to end"`

### Task 7: Docs

**Files:**
- Modify: `docs/DESIGN.md`

- [x] **Step 1: Update** (use /writing-clearly):
  - **Look**, after the sidebar paragraph: the Structure section collapses
    to its header (VS Code style), drawn or left out like the sidebar, the
    split's panel ids, saved in `settings` as `structure-collapsed`, focus
    staying on the header.
  - **Introspection**, after the lazy-loading paragraph: the filter
    (tables and views by name, case-insensitive substring), how
    completion picks the schemas to load and why that costs no SQL per
    keystroke, the 50 000-row and column-less limits, the filter-only
    folds, the text kept per profile in memory.
  - **Palettes and keys**, if it lists where ⌘F works: add the tree.
  - **Handler API**, Workspace row: add `sidebar-hidden`,
    `set-sidebar-hidden`, `structure-collapsed`, `set-structure-collapsed`.
- [x] **Step 2: Commit.** `git commit -m "Document the Structure section's collapse and filter"`

### Task 8: Backlog the filter's limits

**Files:**
- Create: `docs/backlog/structure-filter-completion-cap.md`

- [x] **Step 1: Write the entry** with the /backlog skill (`**Status:
  open**`): the filter finds tables in closed schemas through completion,
  which stops at 50 000 column rows and leaves out objects without
  columns, so on a large database some tables are found only once their
  schema is open. Possible fix: a `search-objects` handler per engine
  (which could also search indexes).
- [x] **Step 2: Commit** on its own: `git commit -m "Backlog: structure filter past the completion cap"`

### Task 9: Final check

- [x] **Step 1:** Run everything once more:
  `CGO_ENABLED=1 GOFLAGS=-tags=server lgx test`,
  `npm --prefix frontend test`,
  `CGO_ENABLED=1 GOFLAGS=-tags=server lgx smoke`,
  `CGO_ENABLED=1 GOFLAGS=-tags=server lgx e2e`.
  Expected: all PASS.
- [x] **Step 2:** Mark this plan's steps done and commit
  (`Record the structure collapse and filter plan's completion`).

## Completion summary

Implemented as designed: the Structure header is a disclosure button that
collapses the section to a header under the connections (saved as the
`structure-collapsed` setting, sharing a `flag?` / `set-flag!` helper with
`sidebar-hidden`); an always-shown input filters the tree to matching
tables and views, choosing schemas to load from cached completion names,
with filter-only folds, a highlighted match, Escape / ArrowDown / ⌘F, and
the text per profile in memory. The completion query options moved into
`completionQuery` (`lib/query.ts`), shared by the editor and the tree.
Verified: `lgx test` (243 tests), `npm --prefix frontend test` (704),
`lgx smoke` (Postgres step skipped, no `QUEL_PG_URL`), `lgx e2e` (69
passed, 1 skipped). Codex reviews of Tasks 1–2 and 3–6 found nothing
actionable.

Deviations:
- Codex reviews ran per pair of tasks (1–2, 3–6) rather than per task.
- The hand checks (Tasks 3 and 5) were done with Playwright screenshots of
  the server-mode app plus the e2e spec.
- The e2e spec makes its own second table; the plan assumed `t2` in the
  fixture file.

What the plan could have specified better: the e2e fixture's contents
(it named `t2`, which lives in the second fixture file).
