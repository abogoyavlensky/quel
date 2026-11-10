# Result Sort and Find Implementation Plan

**Status: completed**

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sort a result by any column with a header click, and find text in a result with ⌘F (Ctrl+F) while its grid has focus.

**Tech Stack:** React 19, zustand store (`state/store.ts`), TanStack Virtual grid (`grid/ResultGrid.tsx`), shadcn `InputGroup` / `Button`, lucide-react icons, Tailwind, Vitest, Playwright (server mode, `lgx e2e`).

---

## Design

### Sort

**The sort runs in the app, over every row.** A header click never runs
the statement again. An `open` result (more pages on the server) first
loads the rest, as Export does: page by page through `loadAll`, capped at
`MAX_ROWS` (100,000), with the footer's "N rows loaded, loading more…" and
its **Cancel** button. Then the rows are sorted in memory. This works for
any statement that returns rows (SELECT, `RETURNING`, PRAGMA, SHOW).

**Clicks cycle per column:** ascending → descending → back to the order
the rows came in. A click on another column starts it at ascending. One
column at a time; there is no multi-column sort.

**The rows are reordered in the store, and the original order is kept.**
`RowsResult` gets two fields:

```ts
export type SortDir = "asc" | "desc";
export interface RowsSort { column: number; dir: SortDir }

// on RowsResult:
sort: RowsSort | null;      // null: the order the rows came in
unsorted: Cell[][] | null;  // while sorted: the rows in the order they came; else null
```

Invariants (write them as a comment on the fields):

- `sort !== null` ⇒ `cursor !== "open"`. A result is sorted only after
  `loadAll`, or when its cursor was already `done`, `capped` or `closed`.
  So `fetchMore` never appends to sorted rows.
- `rows` is always the order the grid shows. Everything that reads `rows`
  follows the sort without changes: row numbers count positions in the
  shown order, ↑/↓ step through it, the row details panel's "Row 5 of
  2,000" is a position, and **Export writes the rows in the shown order**.
- A re-sort always starts from `unsorted ?? rows`, the arrival order. The
  sort is stable, so ties keep their arrival order and the third click
  restores it exactly.
- `selectedRow` is remapped in the same `updateRows` call, by row
  identity (`next.indexOf(rows[selectedRow])`), so the same row stays
  selected. `find.current` (below) is cleared, because positions moved.
- A new run's result starts with `sort: null, unsorted: null` (the single
  creation site, `state/runner.ts` ~line 203). A pinned result keeps its
  sort across runs, as it keeps `selectedRow`.

**Sort and export share one lock per tab.** Today `tab.exporting` (an
`ExportProgress`), the `exportCancels` map and the footer's Cancel button
belong to export. `ExportProgress.action` becomes
`"copy" | "save" | "sort"`. A sort that has to load sets
`exporting: { action: "sort", rows: null, total: 0 }` while `loadAll`
runs. `rows` stays null, so `exportWords` says nothing and the footer
shows the rows text ("N rows loaded, loading more…") plus Cancel, which
calls `cancelExport(tabId)`. The setup and teardown that `exportResult`
has now (set the lock, register an `AbortController`, clear both in
`finally`) moves into one private helper in `runner.ts` that both callers
use. Effects:

- While a tab exports or sorts, header clicks and Copy/Save do nothing.
  Copy/Save are disabled already; `sortResult` returns early.
- Outcomes mirror Export:
  - The cursor is already not `open`: sort at once, with no lock.
  - `loadAll` returns true (`done` or `capped`): sort.
  - Canceled (the signal fired): no sort, toast "Sort canceled."
  - Otherwise (the cursor closed during the load, another statement is
    running in the tab, the result is gone): no sort, toast "Sort
    stopped: not all rows could be loaded." A later click on a result that
    is now `closed` sorts the rows it holds.

**Comparing cells** (`grid/sort.ts`, pure). Cells are `string | number |
boolean | null`. Big integers and decimals arrive as strings in numeric
columns (`isNumericType`). Compare raw cells, never `display()` text.

- Each cell gets a kind rank: boolean 0, number 1, text 2, NULL 3. A
  string in a numeric column that parses as a number (see below) ranks as
  a number. Mixed SQLite columns therefore sort numbers before text, as
  SQLite does. Different ranks compare by rank.
- **NULL is the largest value.** Ascending puts NULLs last, descending
  first. This is the Postgres and Redshift default (`NULLS LAST` on ASC).
  Descending negates the comparator. It does not reverse the array, so
  ties stay stable.
- Booleans: false < true.
- Numbers: a numeric string is one that matches
  `/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/`, or is `NaN`, `Infinity` or
  `-Infinity`. Compare it exactly without BigInt like this:

  ```ts
  // Number() rounds monotonically, so strict inequality of the doubles
  // means strict inequality of the exact values. Only equal doubles
  // need the exact decimal comparison.
  const x = Number(a), y = Number(b);
  const nx = Number.isNaN(x), ny = Number.isNaN(y);
  if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1; // NaN above all, as Postgres; NaN == NaN keeps ties stable
  if (x !== y) return x < y ? -1 : 1;
  if (typeof a === "string" && typeof b === "string") return compareDecimal(a, b); // exact tie-break
  return 0;
  ```

  `compareDecimal` handles plain decimals only (no exponent; for anything
  else it returns 0). It compares the sign, then the integer part with
  leading zeros stripped (length first, then digits), then the fractional
  part padded with zeros to the same length. `-0` equals `0`. Postgres
  never sends exponents for `numeric`, and doubles arrive as JS numbers.
- Text: one module-level `new Intl.Collator(undefined, { sensitivity:
  "variant" })` and its `compare`. Do not call `localeCompare` per pair:
  100,000 rows means about 1.7M comparisons. ISO dates and timestamps
  arrive as strings and sort correctly this way.

```ts
// grid/sort.ts
export function compareCells(a: Cell, b: Cell, numeric: boolean): number;
export function sortRows(rows: Cell[][], s: RowsSort, numeric: boolean): Cell[][]; // a new array, stable
export function nextSort(cur: RowsSort | null, column: number): RowsSort | null; // asc → desc → null
```

**Header UI** (`ResultGrid.tsx`):

- A click on a `columnheader` calls `sortResult(tabId, result.id, index)`.
  The resize handle stops the click from bubbling up
  (`onClick={(e) => e.stopPropagation()}`). Without that, every resize
  ends in a click on the header, and the click sorts.
- The header gets `aria-sort` (`"ascending"` / `"descending"`, or
  `"none"`), `cursor-pointer`, and the title `"<name> <type> — click to
  sort"`. The sorted column shows a `size-3` lucide `ArrowUp` / `ArrowDown`
  next to its name. The name row becomes a flex row, and the icon sits on
  the side away from the alignment. The type line stays as it is.
- When `result.sort` changes, the grid scrolls back to the top, so the
  first rows in the new order are on screen. Write it as an effect with
  braces, keyed on `result.sort`, skipped on the first render so a
  remount (a result tab switch) does not jump.

### Find

**⌘F / Ctrl+F while the result grid has focus opens a find bar** docked at
the top of the result, above the header. It looks like the editor's Find
panel without the replace row:

```
[ Find…              Aa ab .* ]  3 of 12   ↑  ↓                     ×
```

- The same field, toggles (Match case, Match whole word, Use regular
  expression), muted `tabular-nums` count, Previous/Next and Close
  buttons, built from the same components (`InputGroup`,
  `InputGroupButton`, `Button variant="ghost" size="icon-xs"`). The field
  is labelled `"Find in result"`, so tests and assistive tech can tell it
  apart from the editor's `"Find"`. The bar has `role="search"` and
  `aria-label="Find in result"`.
- **A match is a cell.** Whole cells are highlighted, not substrings: a
  cell shows a single truncated line, so a substring highlight would often
  be cut off. Matching cells get `--search-match`, and the current one
  `--search-match-current` (the tokens are in `index.css` already).
- **It searches the raw value.** Strings as they are (newlines too, not
  the `↵` of the display), numbers and booleans through `String()`. NULL
  never matches. The search does not look at column names.
- **It covers loaded rows only.** It never loads more pages. While the
  cursor is `open`, the count reads `"3 of 12 in loaded rows"` /
  `"12 matches in loaded rows"`.
- Counting stops at 1,000 ("1000+ matches", "3 of 1000+"), using the
  editor's `MatchCount` and `countLabel` (`editor/searchCount.ts`).
  `countLabel` changes to take `{ valid: boolean; search: string }`, which
  `SearchQuery` satisfies, so the editor call stays as it is. The grid
  computes the count and highlights from `useDeferredValue` of the find
  query, so typing stays responsive on a 100,000-row result.
- **Navigation scans from the current match**, independent of the cap.
  Order is row-major in the shown order, wrapping at both ends. Next goes
  forward, Previous goes back. With no current match, Next starts before
  the selected row's first cell (or the top), so the first Enter lands on
  the first match at or after the selected row. Moving to a match selects
  its row (`selectRow`), sets `find.current`, and scrolls the cell into
  view on both axes. Scroll by hand, as the ↑/↓ handler does: vertically
  past the sticky header (`HEAD_H`), horizontally past the sticky number
  column (`numW`), with column offsets from `cols.getVirtualItems()` or
  the prefix sums of `widths`.
- An invalid regular expression sets `aria-invalid` on the field and
  leaves the count empty, as in the editor.

**Keys.**

| Where | Key | Does |
|---|---|---|
| grid focused | ⌘F / Ctrl+F | open the bar (or keep it open) and select the field's text |
| grid or find field | ⌘G / Ctrl+G, ⇧⌘G / Ctrl+Shift+G | next / previous match, while the bar is open |
| find field | Enter / Shift+Enter | next / previous match |
| find field | Escape | close the bar, focus the grid |
| grid focused, bar open | Escape | close the bar |

They are handled in the grid's own `onKeyDown` and the bar's `onKeyDown`,
with `preventDefault`, so the browser's own find never opens (Chromium in
the server-mode e2e). Nothing goes into the global capture handler. ⌘F in
the editor still reaches CodeMirror, because the editor is outside the
grid. The native Edit menu does not bind ⌘F: the editor's Find already
gets the key in the shipped app.

**Find state lives on the result, in the store**, like `selectedRow` and
`sort`. It survives result tab switches, hiding the results, and editor
tab switches. It is in memory only.

```ts
export interface CellPos { row: number; col: number }
export interface GridFind {
  open: boolean;
  search: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  current: CellPos | null; // the match Next/Previous last moved to
}
// on RowsResult:
find: GridFind | null; // null until the bar first opens; closing keeps the query
```

Closing sets `open: false` and keeps the query, so ⌘F brings it back
filled in, as in the editor. Editing the query or a toggle clears
`current`. Focus goes to the field only when ⌘F opened the bar. A bar that
comes back open after a tab switch does not take focus.

**Pure find logic** (`grid/find.ts`):

```ts
export type FindQuery = Pick<GridFind, "search" | "caseSensitive" | "wholeWord" | "regexp">;
// test is null for an empty or invalid query; valid is false only for a bad regexp.
export function cellMatcher(q: FindQuery): { valid: boolean; test: ((cell: Cell) => boolean) | null };
export function countCellMatches(rows: Cell[][], test: (c: Cell) => boolean, current: CellPos | null, cap?: number): MatchCount;
export function stepMatch(rows: Cell[][], from: CellPos | null, dir: 1 | -1, test: (c: Cell) => boolean): CellPos | null;
```

Build the `RegExp` once per query, **without the `g` flag**, so `test` has
no `lastIndex` state. Literal search escapes the text. Whole word wraps
the pattern in `\b…\b`. Flags: `i` unless Match case, plus `u`.

### What changes elsewhere

- `ExportProgress.action` gains `"sort"`. `exportWords` stays as it is,
  because a sort never sets `rows`.
- `docs/DESIGN.md`: a new "Sort and find in results" section after Row
  details. The Export section notes that rows go out in the shown order.
  The keys table says ⌘F opens Find "in the editor, or in the result when
  its grid has focus", and lists ⌘G/⇧⌘G for both.

### Not in scope

Multi-column sort, sorting from the keyboard, sorting through the
database (`ORDER BY`), filtering rows, finding across rows not yet loaded,
replace in results, and a Command Palette entry for result find.

## File Structure

| File | Change |
|---|---|
| `frontend/src/grid/sort.ts` | new: `compareCells`, `compareDecimal`, `sortRows`, `nextSort` |
| `frontend/src/grid/sort.test.ts` | new |
| `frontend/src/grid/find.ts` | new: `cellMatcher`, `countCellMatches`, `stepMatch` |
| `frontend/src/grid/find.test.ts` | new |
| `frontend/src/grid/GridFind.tsx` | new: the find bar |
| `frontend/src/grid/ResultGrid.tsx` | header sort click and indicator, find bar, keys, highlights, scroll to match |
| `frontend/src/editor/searchCount.ts` | `countLabel` takes `{ valid, search }` |
| `frontend/src/state/store.ts` | `RowsSort`, `SortDir`, `CellPos`, `GridFind`; `sort`, `unsorted`, `find` on `RowsResult`; `"sort"` in `ExportProgress.action` |
| `frontend/src/state/runner.ts` | new fields at result creation; shared load-lock helper; `sortResult`; find setters (`openFind`, `setFind`, `closeFind`) |
| `frontend/src/state/runner.test.ts`, `store.test.ts`, `status.test.ts` | new fields in `RowsResult` fixtures; tests for `sortResult` and the find setters |
| `frontend/e2e/result-sort.spec.ts` | new |
| `frontend/e2e/result-find.spec.ts` | new |
| `docs/DESIGN.md` | new section, Export note, keys table |

---

### Task 1: Cell comparison and row sorting

**Files:**
- Create: `frontend/src/grid/sort.ts`
- Test: `frontend/src/grid/sort.test.ts`

- [x] **Step 1: Write the failing tests** for:
  - Kind rank: `[null, "b", 2, true]` ascending in a non-numeric column
    gives `true, 2, "b", null`.
  - NULL is last ascending and first descending.
  - Numeric strings: `"10"` > `"9"`; `"9007199254740993"` >
    `"9007199254740992"` (equal as doubles, so the decimal tie-break
    decides); `"-1.50"` == `"-1.5"`; `"0.1"` < `"0.10000000000000001"`;
    `"NaN"` sorts above `"Infinity"`; two `"NaN"` rows keep their arrival
    order, ascending and descending; the number `5` vs the string `"6"`
    in a numeric column.
  - In a non-numeric column, `"10"` < `"9"` (text).
  - Text uses the collator: `"a" < "B" < "c"`.
  - `sortRows` is stable: equal keys keep their input order, ascending
    and descending. It returns a new array and leaves the input as it is.
  - `nextSort`: `null` → asc on column 2; asc 2 → desc 2; desc 2 → null;
    desc 2 + click on column 0 → asc 0.
- [x] **Step 2: Run them and see them fail.**
  Run: `npm --prefix frontend test -- src/grid/sort.test.ts`
  Expected: FAIL (module missing)
- [x] **Step 3: Implement `grid/sort.ts`** as in the Design (signatures
  and the Number-then-decimal comparison above). Keep one module-level
  `Intl.Collator`.
- [x] **Step 4: Run the tests.** Same command. Expected: PASS
- [x] **Step 5: Commit** — `git commit -m "Add result cell comparison and stable row sort"`

### Task 2: Sort state, the shared load lock, `sortResult`

**Files:**
- Modify: `frontend/src/state/store.ts`, `frontend/src/state/runner.ts`
- Test: `frontend/src/state/runner.test.ts` (plus fixtures in `store.test.ts`, `status.test.ts`)

- [x] **Step 1: Types.** Add `SortDir`, `RowsSort`, `CellPos` and
  `GridFind` to `store.ts`. Add `sort`, `unsorted` and `find` to
  `RowsResult`, with the invariants from the Design as comments. Add
  `"sort"` to `ExportProgress.action`. At the creation site in
  `runStatements` (~line 203), set `sort: null, unsorted: null, find:
  null`. Then run `npx --prefix frontend tsc -b frontend` (or `npm
  --prefix frontend run build`) and add the three fields wherever a test
  fixture builds a `RowsResult` (`grep -n 'kind: "rows"'
  frontend/src/state/*.test.ts`).
- [x] **Step 2: Extract the lock.** Move the lock setup and teardown from
  `exportResult` (`setExporting`, the `AbortController` in
  `exportCancels`, the `finally` cleanup) into a private
  `withLoadLock(tabId, action, f: (signal) => Promise<void>)`.
  `exportResult` calls it. Run the existing `exportResult` and `loadAll`
  tests; they must pass unchanged.
  Run: `npm --prefix frontend test -- src/state/runner.test.ts`
  Expected: PASS
- [x] **Step 3: Write the failing `sortResult` tests** (a new
  `describe("sortResult")`, using the `fetchPage` mocks the `loadAll`
  tests use):
  - `done` result: a click sorts ascending at once. The second click sorts
    descending, the third restores the arrival order, and `unsorted` goes
    back to null.
  - `selectedRow` follows its row through a sort and back.
  - `find.current` is cleared by a sort.
  - `open` result: pages load until `done`, then the rows are sorted.
    While loading, `tab.exporting.action === "sort"`.
  - Cancel (`cancelExport`) during the load: no sort, the cursor stays
    open, the "Sort canceled." toast shows, and the lock is cleared.
  - A page error during the load (cursor ends `closed`): no sort, and the
    "Sort stopped…" toast shows. A click after that sorts the loaded rows.
  - A click while `tab.exporting` is set does nothing.
  - `capped` result: sorts what it holds.
- [x] **Step 4: Run them and see them fail.** Same command. Expected: FAIL
- [x] **Step 5: Implement `sortResult(tabId, resultId, column, maxRows =
  MAX_ROWS)`** next to `exportResult`. It works out `nextSort` from the
  current sort at the click. When the result is `open`, it runs `loadAll`
  under `withLoadLock(tabId, "sort", …)` and shows the outcome toasts. It
  then applies the sort in one `updateRows` call:
  `base = r.unsorted ?? r.rows`, rows come from `sortRows(base, next,
  isNumericType(r.columns[column].type))` or `base` when `next` is null,
  `unsorted` is set when sorted, `selectedRow` is remapped by identity,
  and `find.current` is set to null.
- [x] **Step 6: Run the tests.** Same command. Expected: PASS
- [x] **Step 7: Commit** — `git commit -m "Sort results in the app, loading the rest first"`

> Deviation: the shared types (`RowsSort`, `CellPos`, `GridFind`) went into `store.ts` in Task 1, because `grid/sort.ts` imports them. Task 5's setters and tests landed here, because the `sortResult` test that clears `find.current` needs them.

### Task 3: Sortable headers

**Files:**
- Modify: `frontend/src/grid/ResultGrid.tsx`
- Create: `frontend/e2e/result-sort.spec.ts`

- [x] **Step 1: Header click and indicator.** Add an `onClick` on the
  `columnheader`, `aria-sort`, `cursor-pointer`, the title, and the
  `ArrowUp`/`ArrowDown` icon on the sorted column. Stop clicks from
  bubbling out of the resize handle. Add the scroll-to-top effect on
  `result.sort` change, with braces, skipped on mount.
- [x] **Step 2: Write the e2e spec** on fixture table `t` (2,000 rows,
  500-row pages, so the first page leaves the cursor `open`). Follow
  `e2e/results.spec.ts` for setup (`connectFixture`, `insertText`, and
  `ControlOrMeta+Enter`).
  - `select id, name from t order by id;` → click the `id` header → its
    `aria-sort` is `ascending` and the first `gridcell` in the `id` column
    reads `1`. Click again → `descending` and the first cell reads `2000`
    (proves the rest loaded). The footer reads `2,000 rows`. Click again →
    `none`, and the first cell reads `1`.
  - A drag on the resize handle does not change `aria-sort`.
  - Copy as CSV after a descending sort (as `export.spec.ts` does)
    starts with `id,name\r\n2000,` (export follows the shown order).
- [x] **Step 3: Build and run the spec.**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server bash scripts/e2e.sh result-sort`
  Expected: PASS
- [x] **Step 4: Commit** — `git commit -m "Sort a result by a header click"`

### Task 4: Find logic

**Files:**
- Create: `frontend/src/grid/find.ts`
- Test: `frontend/src/grid/find.test.ts`
- Modify: `frontend/src/editor/searchCount.ts` (the `countLabel` parameter type only)

- [x] **Step 1: Write the failing tests:**
  - `cellMatcher`: an empty search gives `test: null, valid: true`; the
    regexp `"("` gives `valid: false, test: null`. A literal `"a.b"` does
    not match `"axb"`. Case-insensitive by default, and Match case
    matters. Whole word: `"id"` matches `"the id"`, not `"idle"`. NULL
    never matches, not even the search `"null"`. `42` and `true` match as
    `String()`. A multi-line string matches text on its second line.
    Repeated `test` calls on the same cell agree (no `lastIndex` state).
  - `countCellMatches`: totals, `current` as a 1-based index when `from`
    is a match, and the cap at 1,000 (`capped: true`).
  - `stepMatch`: forward and back in row-major order, wrapping at both
    ends. From `null`, forward finds the first match. It returns `null`
    when nothing matches. From a position that is a match, it moves on to
    the next one.
- [x] **Step 2: Run them and see them fail.**
  Run: `npm --prefix frontend test -- src/grid/find.test.ts`
  Expected: FAIL
- [x] **Step 3: Implement `grid/find.ts`.** Widen `countLabel`'s
  parameter to `{ valid: boolean; search: string }`.
- [x] **Step 4: Run them, and the editor's count tests.**
  Run: `npm --prefix frontend test -- src/grid/find.test.ts src/editor/searchCount.test.ts`
  Expected: PASS
- [x] **Step 5: Commit** — `git commit -m "Add find-in-result matching and navigation"`

### Task 5: Find state setters

**Files:**
- Modify: `frontend/src/state/runner.ts`
- Test: `frontend/src/state/runner.test.ts`

- [x] **Step 1: Write the failing tests** for:
  - `openFind(tabId, resultId)`: creates `find` with defaults, or sets
    `open: true` and keeps the old query.
  - `setFind(tabId, resultId, patch)`: merges the patch. A change to
    `search` or any toggle clears `current`; a patch that sets only
    `current` keeps it.
  - `closeFind(tabId, resultId)`: sets `open: false` and keeps the query.
  - A result that is gone is left alone.
- [x] **Step 2: Run them and see them fail.**
  Run: `npm --prefix frontend test -- src/state/runner.test.ts`
  Expected: FAIL
- [x] **Step 3: Implement** them next to `selectRow`, through `updateRows`.
- [x] **Step 4: Run the tests.** Same command. Expected: PASS
- [x] **Step 5: Commit** — `git commit -m "Keep find-in-result state on the result"`

> Deviation: done in Task 2 (see there); no separate commit.

### Task 6: The find bar in the grid

**Files:**
- Create: `frontend/src/grid/GridFind.tsx`
- Modify: `frontend/src/grid/ResultGrid.tsx`
- Create: `frontend/e2e/result-find.spec.ts`

- [x] **Step 1: `GridFind`.** Props: `find: GridFind`, `count: string`
  (the label), `invalid: boolean`, `fieldRef`, `onChange(patch)`,
  `onStep(dir)`, `onClose()`. Lay it out as the editor's `FindPanel` find
  row (copy its classes: `h-7 w-72` field, `font-editor text-xs`, toggles
  pressed as `bg-muted text-foreground`), in a `border-b bg-background
  px-2 py-1.5` strip with `role="search"`. The field's `onKeyDown`
  handles Enter, Shift+Enter, Mod+G, Shift+Mod+G, Mod+F (select the text)
  and Escape. Mod means Meta on macOS and Ctrl elsewhere (`isMac` from
  `components/keys.ts`). Each handled key calls `preventDefault`.
- [x] **Step 2: Wire it into `ResultGrid`.**
  - Render `GridFind` above the scroller when `result.find?.open`.
  - Matching: take `useDeferredValue` of `result.find`, build
    `cellMatcher` with `useMemo`, then count with `countCellMatches(rows,
    test, current)`. The label is `countLabel` plus `" in loaded rows"`
    while `cursor === "open"` and the label is not empty.
  - Highlight: each visible `gridcell` gets the match class when `test`
    matches it, and the current-match class when it is `find.current`
    (`bg-(--search-match)` / `bg-(--search-match-current)`, or the
    `bg-[var(--…)]` form).
  - `step(dir)`: `stepMatch(rows, current ?? beforeSelected, dir, test)`,
    where `beforeSelected` is `{ row: selectedRow ?? 0, col: -1 }` going
    forward and `{ row: selectedRow ?? 0, col: columns.length }` going
    back. Then `selectRow`, `setFind({ current })`, and scroll the cell
    into view on both axes. Use the sticky header and the number column
    as in the Design. Pull the vertical math from the ↑/↓ handler into a
    small `scrollRowIntoView(el, index)` and reuse it.
  - The grid's `onKeyDown` handles, before its current modifier early
    return: Mod+F opens (`openFind`) and selects the field text after
    render (`requestAnimationFrame` or a layout effect keyed on a counter
    in a ref). Mod+G and Shift+Mod+G step while the bar is open. Escape
    closes it while open.
  - Closing from the field or the × focuses the scroller
    (`[data-result-grid]`).
- [x] **Step 3: Write the e2e spec** on table `t`:
  - `select id, name from t where id <= 30 order by id;` → focus the grid
    (click a cell) → `ControlOrMeta+f` → the field "Find in result" is
    focused. Type `customer 2` → the count reads `11 matches` (2, 20–29).
    Enter → `1 of 11`, and the selected row (`aria-selected="true"`)
    reads `customer 2`. Shift+Enter → `11 of 11` (wraps to customer 29).
    Escape → the bar is gone and the grid has focus. Ctrl+F again → the
    field shows `customer 2` again.
  - `select id, name from t order by id;` (cursor open after 500 rows) →
    find `customer 1999` → the count reads `No results in loaded rows`.
  - Ctrl+F in the editor still opens the editor's Find (the field "Find",
    `exact: true`), not the result's.
  - Horizontal scrolling to a match is checked by hand in Task 8: the
    fixture has no wide table.
- [x] **Step 4: Run the spec.**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e`
  Expected: PASS (all specs, including `search.spec.ts` for the editor)
- [x] **Step 5: Commit** — `git commit -m "Find in a result with ⌘F"`

> Deviation: `modKey` lives in `components/keys.ts` (shared by the grid and the bar). The bar's key handler sits on the whole bar, not the field (Codex finding), so Escape and ⌘G work after a click on its buttons. The "loaded rows" spec ends by sorting, which loads the rest and closes the cursor: an open cursor locked the SQLite fixture for later specs (`SQLITE_BUSY` in run-policy and structure).

### Task 7: Docs

**Files:**
- Modify: `docs/DESIGN.md`

- [x] **Step 1:** After "### Row details" (~line 692), add "### Sort and
  find in results". Cover the in-app sort over all rows (loading first,
  Cancel, the 100,000 cap), the click cycle, the NULL and kind order, that
  row numbers, row details and ↑/↓ follow the shown order, the shared
  export/sort lock, and find: whole-cell matches over loaded rows, the
  1,000 cap, wrap-around navigation, and state kept on the result.
- [x] **Step 2:** In "### Export", say rows go out in the order the grid
  shows. In the keys table (~line 784), change the ⌘F row to "Opens Find:
  in the editor, or in the result when its grid has focus". Change the
  ⌘G row to say it works in both.
- [x] **Step 3: Commit** — `git commit -m "Document result sort and find"`

### Task 8: Verify

- [x] **Step 1:** `npm --prefix frontend test`. Expected: all pass.
- [x] **Step 2:** `npm --prefix frontend run lint` and `npm --prefix
  frontend run build` (tsc). Expected: no errors.
- [x] **Step 3:** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e`. Expected:
  all pass.
- [x] **Step 4: Manual check in `lgx run`** (server mode on Linux):
  - Sort a wide result by a column far to the right.
  - Find a value in that column: the grid scrolls sideways, and the match
    is not hidden under the number column.
  - Sort while the row details panel is open: it keeps showing the same
    row.
  - Resize a column, and check that it does not sort.

## Summary

Implemented as designed on branch `result-sort-and-find`:

- **Sort:** a header click sorts in the app (`grid/sort.ts`, `sortResult`
  in `state/runner.ts`). An open result loads the rest first, under the
  lock that Export uses (now `withLoadLock`). The rows are reordered in the
  store and `unsorted` keeps the arrival order. The header shows an arrow
  and `aria-sort`.
- **Find:** ⌘F in the grid opens `grid/GridFind.tsx`. Matching and stepping
  are in `grid/find.ts`, and the state is on `RowsResult.find`. Matching
  cells are highlighted, the view scrolls on both axes to a match, and the
  count reads "in loaded rows" while more rows are available.
- **Docs:** `DESIGN.md` has a new "Sort and find in results" section, an
  Export note, and an updated keys table.

**Verification:** 616 unit tests pass. The full e2e suite passes (61
passed, 1 skipped, the same skip as on master). An ad-hoc e2e check on a
32-column result confirmed sideways scrolling to a match and that row
details follow a sort; the spec was then removed.

**Issues hit:**
- Codex flagged equal-double ties: `Infinity` vs a 401-digit numeric, and
  a number vs integer text. Fixed with explicit infinity and exact-integer
  tie-breaks.
- Codex flagged that the find keys stopped working after a click on the
  bar's buttons. Fixed.
- An open cursor left by a spec locked the fixture for later specs.
  Fixed in the spec.

**Deviations:**
- The shared types landed in Task 1.
- The find setters and their tests landed in Task 2.
- `modKey` moved to `components/keys.ts`.
- The bar-level key handler replaced the field-level one.
- The find spec now closes its cursor.

**What the plan could have specified better:** the rule that an e2e spec
must not leave a cursor open on the SQLite fixture (it locks the file for
later specs), and the equal-double cases the comparator has to cover
(Infinity, mixed number and string).
