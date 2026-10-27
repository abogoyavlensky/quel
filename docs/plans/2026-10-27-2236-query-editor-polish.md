# Query Editor Polish Implementation Plan

**Status: completed**

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the query loop nicer to use. Show the statement that ⌘↵ will
run. Tab accepts a completion. Completion icons make sense. A Run/Stop
button sits in the editor. Rows and time show in one place. A run on a
disconnected profile says so where you are looking. The row-number column
is narrower.

**Tech Stack:** React 19, TypeScript, Tailwind v4, shadcn, zustand,
CodeMirror 6 (`@codemirror/view` layers, `@codemirror/autocomplete`,
`@codemirror/lang-sql`), TanStack Virtual, Vitest, Playwright. Frontend
only, plus `docs/DESIGN.md`. No new dependencies.

---

## Design

### Where this starts

- **Editor:** `frontend/src/editor/setup.ts` builds every tab's
  `EditorState`. It uses `highlightActiveLine()` (a grey line background,
  `.cm-activeLine` in the `chrome` theme), `autocompletion()` with
  CodeMirror's default icons, and a keymap without Tab. Today Tab leaves
  the editor, and only Enter accepts a completion. ⌘↵ and ⇧⌘↵ live in
  `runKeys`.
- **Choosing what runs:** `frontend/src/sql/target.ts` (`toRun`,
  `statementAt`) picks the statements over `sql/split.ts`'s `Statement`s
  (`from` = first character, a leading comment included; `to` = just past
  the last character, before the `;`).
- **Completion icons:** lang-sql completes keywords (type `keyword`) and
  SQL type names (`type`). It also completes the schema names and table
  names of the namespace from `editor/namespace.ts`, and gives these the
  same `type` too. Columns are `property`, both from lang-sql and from
  `editor/columns.ts:286`. Aliases are `constant`, and builtins are
  `variable`. CodeMirror's default glyphs for these are 🔑 for keywords,
  𝑡 for types (shared with tables and schemas), □ for properties, 𝐶 for
  constants and 𝑥 for variables.
- **Cancel:** the only button is in the status bar
  (`components/StatusBar.tsx`). It shows while `tab.runningQueryId` is
  set, which includes a page load (`fetchMore`). The native Query menu has
  Cancel on `CmdOrCtrl+.` (`src/quel/menu.lg`), but server mode has no
  native menu, so there the key does nothing.
- **Rows and time:** they show twice, in the grid footer
  (`grid/ResultGrid.tsx`, with the cursor states "more available",
  "Showing the first N rows" and so on) and in the status bar.
- **Running while disconnected:** `runCurrent` (`state/runner.ts:189`)
  sets the app-wide `notice` to "Not connected.". The status bar shows the
  notice until the next edit.
- **Row numbers:** `NUM_W = 56` in `ResultGrid.tsx` is a fixed width,
  and it also offsets every header and cell (`left: NUM_W + c.start`)
  and the total width. The body's number cell also has
  `minWidth: digits + 2ch`, which at six digits (about 58px) is wider than
  the header corner.

Cut a branch `query-editor-polish` from master.

### 1. The current statement

A soft rounded block sits behind the statement that ⌘↵ will run. It
replaces the active-line highlight.

- **What it marks:** the same statement `toRun(..., "statement")` would
  run. Add `statementUnder(statements, selection)` to `sql/target.ts`. It
  returns `undefined` for a non-empty selection (then the selection is
  what runs, and the selection is already drawn), else
  `statementAt(statements, selection.from)`. `toRun`'s statement branch
  uses it. The block covers whole lines, from the line of `s.from` to
  the line of `s.to`.
- **How it is drawn:** a CodeMirror `layer()` below the text
  (`above: false`) with one `RectangleMarker`, class `cm-currentStatement`,
  in a new module `editor/statementHighlight.ts`. Line decorations would
  look banded. A `StateField<Statement[]>` keeps `split(doc)` and
  re-splits only when the document changes. A selection change only
  looks the statement up. The layer redraws on `docChanged`,
  `selectionSet`, `viewportChanged` or `geometryChanged`. Only the main
  selection counts.
- **Coordinates** (the tricky part): marker positions are relative to the
  scroller's content, the way CodeMirror's own `getBase` computes them.
  `getBase` is not exported, so compute the same thing:

  ```ts
  const sr = view.scrollDOM.getBoundingClientRect();
  const cr = view.contentDOM.getBoundingClientRect();
  const baseLeft = sr.left - view.scrollDOM.scrollLeft;
  const baseTop = sr.top - view.scrollDOM.scrollTop;
  const top = view.documentTop + view.lineBlockAt(first.from).top - baseTop;
  const bottom = view.documentTop + view.lineBlockAt(last.from).bottom - baseTop;
  // INSET (4px) keeps the block off the gutter's border and the right edge.
  new RectangleMarker("cm-currentStatement", cr.left - baseLeft + INSET, top, cr.width - 2 * INSET, bottom - top);
  ```

  `scaleX/scaleY` are ignored, because the app never transforms the
  editor.
- **Look** (in the `chrome` theme, from the app's tokens, so it follows
  light and dark):
  `.cm-currentStatement { border-radius: 6px; background: color-mix(in oklch, var(--muted) 70%, transparent); box-shadow: 0 0 0 1px color-mix(in oklch, var(--border) 80%, transparent), 0 1px 2px rgb(0 0 0 / 0.05) }`.
  Tune these by eye in both themes. The block should read as a quiet
  card, not as a selection.
- **Active line:** `highlightActiveLine()` and the `.cm-activeLine` part
  of the theme go. `highlightActiveLineGutter()` stays, so the line
  number still marks the cursor's line. Two stacked greys would muddy the
  block.

### 2. Tab

`{ key: "Tab", run: acceptCompletion }` comes first in the editor's
keymap, and `indentWithTab` follows it. `acceptCompletion` returns false
when no popup is open, so Tab then indents (Shift-Tab dedents). Keyboard
users leave the editor with Escape and then Tab: CodeMirror's tab-focus
mode turns on for a moment after Escape. `completionKeymap` stays as it
is (`autocompletion()` also installs it).

### 3. Completion icons

An icon means a database object, and keywords have none.

| type | where from | icon |
|---|---|---|
| `keyword`, `type` (SQL types), `variable` (builtins) | lang-sql | none (an empty slot, so labels stay aligned) |
| `schema` (new) | `namespaceOf` self tags | `S` |
| `table` (new) | `namespaceOf` self tags | `T` |
| `property` (columns) | lang-sql leaves, `editor/columns.ts` | `C` |
| `constant` (aliases in the statement) | lang-sql | `T` (an alias stands for a table) |

- **Telling tables from SQL types:** today both are `type`, so
  `namespaceOf` must tag schemas and tables itself. Use lang-sql's self
  tags, `{ self: Completion, children }`:
  `namespaceOf(c, dialect)` returns
  `{ [esc(schema)]: { self: name(schema, "schema"), children: { [esc(table)]: { self: name(table, "table"), children: columns } } } }`.
  A self completion replaces lang-sql's own entry for that name, so the
  quoting must match lang-sql's `nameCompletion`. That function is not
  exported. Copy its rule into `namespace.ts` with a comment saying where
  it comes from:

  ```ts
  // As lang-sql's nameCompletion: a name that is not a plain identifier
  // gets `apply` with the dialect's identifier quotes.
  const quote = dialect.spec.identifierQuotes?.[0] ?? '"';
  const plain = new RegExp("^[a-z_][a-z_\\d]*$", dialect.spec.caseInsensitiveIdentifiers ? "i" : "");
  const name = (label: string, type: string) =>
    plain.test(label) ? { label, type } : { label, type, apply: quote + label + (quote === "[" ? "]" : quote) };
  ```

  Labels are the raw names (dots not escaped), and keys stay escaped as
  today. `useCompletion` in `AppShell.tsx` passes
  `dialectFor(engine)` and adds `engine` to its `useMemo` deps.
- **Look:** in the `chrome` theme. `.cm-completionIcon` becomes a small
  badge: `width: 1.1em`, centered, `font-family: var(--font-sans)`,
  `font-size: 9px`, `font-weight: 600`, `color: var(--muted-foreground)`,
  `opacity: 1`. The rules above set each type's `&:after` content, and
  keywords, types and variables get `content: "''"`. Check in the popup
  that the overrides beat CodeMirror's base theme. They should, as the
  existing tooltip overrides do.
- Fuzzy matching (typing `sele` lists `message_length`) is out of scope.

### 4. Run/Stop button

- **Placement:** a new `components/RunButton.tsx`. `AppShell.tsx` wraps
  `SqlEditor` in a `relative h-full` div and renders the button on top of
  it, `absolute right-4 bottom-3 z-10`. It is a shadcn `Button`,
  `size="sm"`, `variant="secondary"`, with `shadow-sm` and an icon plus a
  label.
- **Run:** a `Play` icon and the label "Run" (`aria-label="Run"`). Its
  tooltip is `title={`Run statement (${RUN_KEY}) · Run all (${SCRIPT_KEY})`}`;
  tooltips in this app are `title` attributes, and there is no shadcn
  Tooltip. A click calls `runCurrent("statement")`. It stays enabled
  while disconnected: the run is refused and section 6 explains why.
- **Stop:** a `Square` icon and the label "Stop" (`aria-label="Stop"`),
  with `title={`Stop (${STOP_KEY})`}`. A click calls `cancel(tab.id)`. It
  is disabled while `tab.stopping`.
- **When it is Stop:** only for a real run, not a page load. Add to
  `state/store.ts`:

  ```ts
  // A statement or script is running, not just a page loading.
  export const isRunning = (t: EditorTab) => t.runningQueryId !== null && !t.results.some((r) => r.fetching);
  ```

  The button turns to Stop 300ms after `isRunning` becomes true (a small
  `useDelayed(value, ms)` hook in `RunButton.tsx`: true only after `ms`;
  false at once). A double-click on Run therefore never cancels: the
  second click is a run, which the runner drops while one is in flight. A
  query faster than 300ms never flashes Stop: the timer is cleared when
  `isRunning` turns false. `AppShell` renders `<RunButton key={tab.id} …/>`,
  so switching tabs starts the hook over. A tab that is already running
  shows Stop 300ms after you switch to it, and never shows the previous
  tab's state.
- **Focus:** `onMouseDown={(e) => e.preventDefault()}`, so the editor
  keeps focus and its caret.
- **The Stop key:** add `STOP_KEY` to `components/keys.ts` (`⌘.` on Mac,
  `Ctrl+.` elsewhere). `App.tsx` gets `useStopKey()`, a window
  capture-phase listener modelled on `useRowDetailsKey` (Mod+`.`, no
  shift or alt), which calls `cancel` on `selectedTabId()`. The native
  menu may deliver the key too. That is harmless: `cancel` only sets
  `stopping` and asks the backend again, and the failure is swallowed.

### 5. Rows and time in one place

The grid footer keeps them, because it is per result and carries the
paging state. The status bar loses its rows, its ms and its Cancel
button. It shows the profile and the state: Connecting…, Disconnecting…,
Canceling…, Running… (now `isRunning(tab)`, so not during a page load,
where the footer says "loading more…"), the notice, Not connected, or
Ready.

### 6. Running while disconnected

- **State:** `Workspace.runRefused: boolean`, in memory only (`false` in
  `newWorkspace`; `persist.ts` sends only the tabs, so nothing is saved).
  `runCurrent` sets it on a workspace that is not connected, instead of
  setting the notice ("Not connected." as a notice goes away).
  `connectProfile` clears it when the connection opens. A run while
  connecting is still dropped silently, as now.
- **Where it shows** (`components/ResultTabs.tsx`, a small `NotConnected`
  component in that file; it reads the selected workspace and profile
  from the store):
  - **An empty tab** (no results, no messages) on a workspace that is
    `disconnected` or `connecting`: the message replaces "Run the
    statement under the cursor…", so you see it before you try.
  - **A tab with results**, after a refused run (`runRefused`), while
    still disconnected: a thin banner above the results tab strip
    (`flex h-8 items-center gap-2 border-b bg-muted/40 px-3 text-xs`).
    It stays until you connect.
- **What it says:** "**{profile name}** isn't connected." followed by a
  `Button` `size="xs"` `variant="outline"` labelled "Connect"
  (`aria-label={`Connect to ${name}`}`; the sidebar's button is
  "Connect {name}", so the two never match each other in tests). The
  button calls `connectProfile(profileId)`. It only connects and never
  runs anything. While connecting it reads "Connecting…" and is
  disabled. If `w.error` is set (the last connect failed), the error
  follows in `text-destructive`. The container has `aria-live="polite"`.
- The status bar still says "Not connected" (its state, no period).

### 7. Row-number column

`numberWidth(rowCount, more)` in `grid/widths.ts`:

```ts
// The row-number column: its digits at the grid's mono width, plus padding
// and border. Room for at least 4 digits once a result is paged (or may
// be), so it does not widen as pages load past 999; a small single-page
// result fits its own count (at least 2 digits).
export const FIRST_PAGE = 500; // the backend's first page
export function numberWidth(rowCount: number, more: boolean): number {
  const floor = more || rowCount >= FIRST_PAGE ? 4 : 2;
  return Math.ceil(Math.max(floor, String(rowCount).length) * CHAR_W + 17);
}
```

`ResultGrid` computes
`numW = numberWidth(result.rows.length, result.cursor === "open")` and
uses it everywhere `NUM_W` was used (header corner, number cells, cell
and header `left`, total `width`). The number cell's `minWidth` style
goes. 12 rows come out 32px wide, and 2,000 rows 47px.

### Testing

- **Unit (Vitest):** `statementUnder`; `numberWidth`; `namespaceOf`'s
  self tags and quoting; `isRunning`; `runRefused` set by a refused run
  and cleared by a connect, with no notice.
- **e2e (Playwright, server mode):**
  - Tab accepts a completion, then indents.
  - The statement block is there, and goes away with a selection.
  - A keyword in the popup has no icon.
  - The Run button runs and keeps the editor focused.
  - Stop cancels a runaway query, replacing the old status-bar Cancel
    test.
  - A refused run shows the banner, and its Connect button connects.
  - An empty tab on a disconnected profile shows the message.
- Commands (on Linux without GTK, prefix e2e with
  `CGO_ENABLED=0 GOFLAGS=-tags=server`; if the shell's lgx is too old, use
  `mise exec -- lgx`):
  - unit: `npm --prefix frontend test`
  - build: `npm --prefix frontend run build`
  - lint: `npm --prefix frontend run lint`
  - e2e: `lgx e2e`

## File Structure

| File | Change |
|---|---|
| `frontend/src/sql/target.ts` (+ `target.test.ts`) | `statementUnder`; `toRun` uses it |
| `frontend/src/editor/statementHighlight.ts` | new: statements field + layer, exports `statementHighlight` (an extension array) |
| `frontend/src/editor/setup.ts` | Tab/indent keys, drop active line, add `statementHighlight`, icon and block theme rules, comment fix |
| `frontend/src/editor/namespace.ts` (+ `namespace.test.ts`) | `namespaceOf(c, dialect)` with schema/table self tags |
| `frontend/src/components/AppShell.tsx` | pass dialect to `namespaceOf`; wrap editor + `RunButton` |
| `frontend/src/components/RunButton.tsx` | new: Run/Stop button, `useDelayed` |
| `frontend/src/components/keys.ts` | `STOP_KEY` |
| `frontend/src/App.tsx` | `useStopKey` |
| `frontend/src/state/store.ts` (+ `store.test.ts`) | `isRunning`, `Workspace.runRefused` |
| `frontend/src/state/runner.ts` (+ `runner.test.ts`) | `runCurrent` sets `runRefused`; `connectProfile` clears it |
| `frontend/src/components/ResultTabs.tsx` | `NotConnected` message and banner |
| `frontend/src/components/StatusBar.tsx` | drop rows/ms/Cancel; use `isRunning` |
| `frontend/src/grid/widths.ts` (+ `widths.test.ts`) | `numberWidth`, `FIRST_PAGE` |
| `frontend/src/grid/ResultGrid.tsx` | `numW` replaces `NUM_W` |
| `frontend/e2e/editor.spec.ts` | new: Tab, statement block, icons |
| `frontend/e2e/query-loop.spec.ts` | Run button, Stop replaces Cancel |
| `frontend/e2e/workspaces.spec.ts` | refused run shows the banner |
| `docs/DESIGN.md` | layout sketch, status bar, running-while-disconnected, editor notes |

## Tasks

### Task 1: Narrower row-number column

**Files:**
- Modify: `frontend/src/grid/widths.ts`, `frontend/src/grid/ResultGrid.tsx`
- Test: `frontend/src/grid/widths.test.ts`

- [x] **Step 1: Write the tests** for `numberWidth`: `(12, false)` → 2
  digits (`Math.ceil(2 * 7.3 + 17)` = 32); `(7, false)` → 2 digits;
  `(212, false)` → 3 digits; `(500, false)` and `(12, true)` → 4 digits;
  `(2000, false)` → 4; `(100000, false)` → 6.
- [x] **Step 2:** Run `npm --prefix frontend test`. Expected: the new
  tests fail (no `numberWidth`).
- [x] **Step 3: Implement** `numberWidth` and `FIRST_PAGE` as in the
  design. In `ResultGrid.tsx`, remove `NUM_W` and compute `numW` once per
  render. Use it in the header corner, the number cells (drop
  `minWidth`), every `left: NUM_W + c.start` and the total `width`.
  Remove the now unused `digits`.
- [x] **Step 4:** Run unit tests, build and lint. Expected: PASS.
- [x] **Step 5:** Commit: `Narrower row-number column`.

### Task 2: Tab accepts a completion, else indents

**Files:**
- Modify: `frontend/src/editor/setup.ts`

- [x] **Step 1:** Import `acceptCompletion` (`@codemirror/autocomplete`)
  and `indentWithTab` (`@codemirror/commands`). In the editor's
  `keymap.of([...])`, put `{ key: "Tab", run: acceptCompletion }` first
  and `indentWithTab` after it. Add a comment: Tab accepts an open
  completion, otherwise it indents; Escape then Tab leaves the editor.
- [x] **Step 2:** Build and lint. Expected: PASS. (The e2e test comes in
  Task 9.)
- [x] **Step 3:** Commit: `Tab accepts a completion, else indents`.

### Task 3: Completion icons

> Deviation: the popup's look was checked in a Playwright screenshot (light and dark) from a throwaway spec, not in `lgx dev`. Quoting uses `||` like lang-sql, not `??`.

**Files:**
- Modify: `frontend/src/editor/namespace.ts`,
  `frontend/src/components/AppShell.tsx`, `frontend/src/editor/setup.ts`
- Test: `frontend/src/editor/namespace.test.ts`

- [x] **Step 1: Update the tests** for `namespaceOf(c, dialect)` (use
  `PostgreSQL` and `SQLite` from `@codemirror/lang-sql`):
  - plain names give `{ main: { self: { label: "main", type: "schema" }, children: { t: { self: { label: "t", type: "table" }, children: ["id", "name"] } } } }`;
  - dots: key `a\\.b`, label `a.b` with an `apply` of `"a.b"`;
    `order\\.items` likewise. Columns are unchanged (`["x.y"]`);
  - `Users` on PostgreSQL gets `apply: '"Users"'` (lang-sql's PostgreSQL
    dialect is case-sensitive; if it turns out not to be, assert what
    lang-sql's own `nameCompletion` would give);
  - SQLite quotes with its first identifier quote (read it from
    `SQLite.spec.identifierQuotes`; do not hard-code it in the test);
  - `__proto__` still a table (adapt the existing test to `children`).
- [x] **Step 2:** Run `npm --prefix frontend test`. Expected: the updated
  tests fail.
- [x] **Step 3: Implement** `namespaceOf(c, dialect: SQLDialect)` per the
  design, with the comment about matching lang-sql's `nameCompletion`.
  Update the module comment (schemas and tables carry their kind for the
  popup's icons). In `AppShell.tsx`, `useCompletion(connId, engine)`
  passes `dialectFor(engine)` and adds `engine` to the `useMemo` deps.
- [x] **Step 4:** Run unit tests. Expected: PASS. Also check that
  `editor/columns.test.ts` still passes: it reads `raw`, not the
  namespace.
- [x] **Step 5: Theme.** In `setup.ts`'s `chrome` theme, add the badge
  style for `.cm-completionIcon` and the `&:after` content per type from
  the design's table (keyword, type and variable empty; schema `S`;
  table and constant `T`; property `C`).
- [x] **Step 6:** Build and lint. Expected: PASS. If a dev run is at
  hand (`lgx dev`), look at the popup in light and dark: keywords have
  no icon, and tables and columns show their badge.
- [x] **Step 7:** Commit: `Completion icons for database objects only`.

### Task 4: Highlight the current statement

> Deviation: step 7 done with temporary Playwright screenshots in light and dark (block follows the cursor, hides with a selection); scrolling and pane resizing were not checked by eye.

**Files:**
- Modify: `frontend/src/sql/target.ts`, `frontend/src/editor/setup.ts`
- Create: `frontend/src/editor/statementHighlight.ts`
- Test: `frontend/src/sql/target.test.ts`

- [x] **Step 1: Write the tests** for `statementUnder` over
  `split("select 1;\n\nselect 2;")`: the cursor in the first statement →
  the first; the cursor right after its `;` → the first; the cursor on
  the blank line → the first (nearest before); the cursor at 0 of
  `"\n\nselect 1;"` → the statement after it; a non-empty selection →
  `undefined`; no statements → `undefined`.
- [x] **Step 2:** Run unit tests. Expected: the new tests fail.
- [x] **Step 3: Implement** `statementUnder` in `target.ts`, and make
  `toRun`'s statement branch use it (the existing `toRun` tests must
  still pass unchanged).
- [x] **Step 4: Implement** `editor/statementHighlight.ts`: the
  `StateField<Statement[]>` (re-split only on `docChanged`), the
  `layer({ above: false, class: "cm-statementLayer", update, markers })`
  with the marker computed as in the design, and
  `export const statementHighlight = [field, layer]`. Add a module
  comment: what it marks, why it is a layer (one rounded block, not
  banded lines), and that it matches `toRun`.
- [x] **Step 5: Wire** it in `setup.ts`: add `statementHighlight` to the
  extensions; remove `highlightActiveLine()` and its import, and remove
  `.cm-activeLine` from the theme rule (keep `.cm-activeLineGutter`). Add
  the `.cm-currentStatement` rule from the design. Update `setup.ts`'s
  comment on the theme if it mentions the active line.
- [x] **Step 6:** Unit tests, build and lint. Expected: PASS.
- [x] **Step 7: Look at it** (`lgx dev`, or `lgx run` in server mode
  with `scripts/server-mode.sh`'s environment) in light and dark. Check
  the block follows the cursor across statements, hides with a
  selection, scrolls with the text, survives resizing the editor pane,
  and sits behind the text and the cursor. Tune the colours if it reads
  too strong.
- [x] **Step 8:** Commit: `Highlight the statement under the cursor`.

### Task 5: Store and runner: real runs and refused runs

> Deviation: "drops a run while the profile connects" now waits for status `connecting` first. `connectProfile` awaits `ensureWorkspace` before it sets `connecting`, so a run issued at once is refused, not dropped (the old test passed only because the connect cleared the notice). Codex flagged `runRefused` as unused by any UI at this commit: Task 6 consumes it.

**Files:**
- Modify: `frontend/src/state/store.ts`, `frontend/src/state/runner.ts`,
  `frontend/src/editor/setup.ts` (comment only)
- Test: `frontend/src/state/store.test.ts`, `frontend/src/state/runner.test.ts`

- [x] **Step 1: Store.** Add `isRunning` (as in the design) and
  `runRefused: boolean` to `Workspace`, with a comment (a run was refused
  while disconnected, shown in the results until a connect; in memory
  only). Set `runRefused: false` in `newWorkspace`, and let the type
  checker find other `Workspace` literals (test fixtures).
- [x] **Step 2: Runner.** In `runCurrent`, a workspace that is not
  connected (and not connecting) gets
  `updateWorkspace(w.profileId, (w) => ({ ...w, runRefused: true }))`
  instead of the notice. Update the function's comment. In
  `connectProfile`, the success update also sets `runRefused: false`.
  Update `setup.ts`'s updateListener comment ("An edit clears the status
  bar's notice.").
- [x] **Step 3: Tests.**
  - `isRunning`: false with no `runningQueryId`; true while running;
    false while a result is `fetching`.
  - Rewrite "sends nothing on a disconnected profile and says so": the
    run is not sent, the workspace's `runRefused` is true, and `notice`
    stays null. Then a successful `connectProfile` clears `runRefused`.
  - "drops a run while the profile connects": `runRefused` stays false.
- [x] **Step 4:** Unit tests, build and lint. Expected: PASS.
- [x] **Step 5:** Commit: `Track refused runs and real runs in the store`.

### Task 6: The not-connected message

**Files:**
- Modify: `frontend/src/components/ResultTabs.tsx`

- [x] **Step 1:** Add `NotConnected({ banner }: { banner: boolean })` in
  `ResultTabs.tsx`. It reads the selected workspace (`selectedWorkspace`)
  and the selected profile's name, and renders the design's text,
  Connect button, connecting state and error. With `banner`, it is the
  thin strip; without, it is the padded empty-state paragraph (`p-4
  text-sm text-muted-foreground`, with the name in `text-foreground`).
- [x] **Step 2:** In `ResultTabs`, read the workspace's status and
  `runRefused`. `offline` means the status is `disconnected` or
  `connecting`. When the tab is empty and `offline`,
  `<NotConnected banner={false} />` replaces the hint. When the tab is
  not empty, `offline` and `runRefused`, `<NotConnected banner />` renders
  above the results tablist. Update the component comment.
- [x] **Step 3:** Build and lint. Expected: PASS.
- [x] **Step 4:** Commit: `Say in the results when the profile is not connected`.

### Task 7: Run/Stop button, the Stop key, a leaner status bar

> Deviation: `useDelayed` resets its state in the effect cleanup, not in the effect body (oxlint `set-state-in-effect`). Codex advisory, not acted on: the floating Run button can cover text at the editor's bottom right (the design places it there).

**Files:**
- Create: `frontend/src/components/RunButton.tsx`
- Modify: `frontend/src/components/AppShell.tsx`,
  `frontend/src/components/keys.ts`, `frontend/src/App.tsx`,
  `frontend/src/components/StatusBar.tsx`

- [x] **Step 1:** `keys.ts`: add `STOP_KEY` (`⌘.` / `Ctrl+.`).
- [x] **Step 2:** `RunButton.tsx`: `RunButton({ tab }: { tab: EditorTab })`
  and `useDelayed`, per the design. The module comment covers the 300ms
  delay (a double-click never cancels, a fast query never flashes Stop),
  page loads not counting, and keeping the editor's focus.
- [x] **Step 3:** `AppShell.tsx`: wrap `<SqlEditor …/>` in
  `<div className="relative h-full">` with `<RunButton key={tab.id} tab={tab} />`.
  Update the layout comment.
- [x] **Step 4:** `App.tsx`: `useStopKey()`, modelled on
  `useRowDetailsKey` (capture phase, Mod+`.`, no shift or alt,
  `preventDefault`), calling `cancel` on `selectedTabId()`. A comment
  notes that the native menu may also deliver it, which is harmless.
- [x] **Step 5:** `StatusBar.tsx`: remove the rows/ms span, the Cancel
  button and their imports (`Button`, `cancel`, `result`). `running`
  becomes `!!tab && isRunning(tab)`. Update the leading comment
  (profile, connection and the active tab's state; rows and time are in
  the grid footer, Stop is in the editor).
- [x] **Step 6:** Build, lint and unit tests. Expected: PASS.
- [x] **Step 7:** Commit: `Run/Stop button in the editor; rows and time only in the grid`.

### Task 8: DESIGN.md

**Files:**
- Modify: `docs/DESIGN.md`

- [x] **Step 1:**
  - The layout sketch's status bar line (about line 417) becomes
    `status bar: profile · state (Ready / Running… / Not connected)`.
    Add a line under the sketch: the editor has a Run/Stop button at
    its bottom right, and the grid footer has the rows and the time.
  - The "Running" bullet (about line 503) now says a run on a
    disconnected workspace sends nothing and says so in the results
    (the empty tab's message, or a banner above the results) with a
    Connect button that only connects. While connecting, a run is
    dropped.
  - "Splitting and what gets sent" (about line 224): the editor marks
    the statement ⌘↵ will run with a soft block. The Run button runs it,
    and becomes Stop (⌘.) after 300ms of a run.
  - In the completion paragraph (about line 371), add that schemas and
    tables carry their kind, so the popup marks database objects (S, T,
    C) and leaves keywords bare.
  - Search for other mentions of the status bar's Cancel, rows or
    elapsed time, and fix them.
- [x] **Step 2:** Commit: `DESIGN: run button, statement block, one place for rows and time`.

### Task 9: e2e

> Deviation: the Tab test waits 150ms after the popup shows (CodeMirror ignores an accept in the first 75ms); the keyword-icon test checks the empty slot is attached (an empty element is never "visible"); added a table-icon test; the empty-tab message test lives in `editor.spec.ts`.

**Files:**
- Create: `frontend/e2e/editor.spec.ts`
- Modify: `frontend/e2e/query-loop.spec.ts`, `frontend/e2e/workspaces.spec.ts`

- [x] **Step 1: `editor.spec.ts`** (connect the fixture as
  `query-loop.spec.ts` does; copy its `write` helper):
  - **Tab:** write an empty text, then `page.keyboard.type("sele")`. Wait
    for `page.getByRole("listbox")` (the completion popup). Press Tab, and
    the editor's text is `select`. Press Tab again with no popup open, and
    the text starts with whitespace before `select`.
  - **Icons:** `type("sele")`, then evaluate `getComputedStyle(el,
    "::after").content` on the first `.cm-completionIcon-keyword`.
    Expected: `""` or `none`, not the key.
  - **Statement block:** write `select 1;\n\nselect 2;`. The cursor ends
    up at the end, so `.cm-currentStatement` has count 1. Press
    `ControlOrMeta+a`, and the count is 0.
- [x] **Step 2: `query-loop.spec.ts`:**
  - In "cancel stops a runaway query", start the runaway with
    `page.getByRole("button", { name: "Run" }).click()`. Click
    `getByRole("button", { name: "Stop" })` (it appears after 300ms, so
    let `expect(...).toBeVisible()` wait), expect "Query canceled." in
    Messages, then the Run button back and the status "Ready".
  - Add "the Stop key cancels": start the runaway with
    `ControlOrMeta+Enter`, wait for the Stop button, press
    `ControlOrMeta+.`, and expect "Query canceled." in Messages. Server
    mode has no native menu, so this covers `useStopKey`.
  - Add "the Run button runs and keeps the editor focused": write
    `select 1 as one;`, click Run, expect the `one` result, and
    `expect(page.getByLabel("SQL editor")).toBeFocused()`.
- [x] **Step 3: `workspaces.spec.ts`** (about line 63): after the refused
  run, B's tab already has results. Expect `WS B isn't connected.` to be
  visible (instead of the status text "Not connected."). Then click
  `getByRole("button", { name: "Connect to WS B" })` in place of the
  sidebar's button, and expect status "Ready" and the banner gone. Add a
  case where a freshly selected, disconnected profile with an empty tab
  shows the message in its results, if a profile with an empty tab is at
  hand in that spec. Otherwise add it to `editor.spec.ts` with a new
  SQLite profile made through `ensureProfile`.
- [x] **Step 4:** Grep the specs for other uses of
  `getByRole("button", { name: "Cancel" })` outside the profile dialog,
  for the status bar's rows or ms, and for the notice "Not connected.".
  Fix any you find. `structure.spec.ts:87`'s "Not connected." is the
  structure panel and stays.
- [x] **Step 5:** Run `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e`.
  Expected: PASS.
- [x] **Step 6:** Commit: `e2e: Tab, statement block, Run/Stop, not-connected banner`.

### Task 10: Final check

- [x] **Step 1:** `npm --prefix frontend test`, `npm --prefix frontend
  run build`, `npm --prefix frontend run lint`, and the e2e run. All
  pass.
- [x] **Step 2:** Mark this plan `**Status: completed**` under its title,
  tick the boxes, record deviations as `> Deviation:` notes under their
  tasks, and commit: `Plan: query editor polish done`.

## Completion summary

Implemented all seven changes, frontend and `docs/DESIGN.md` only: the
narrower row-number column (`numberWidth`), Tab accepting a completion,
schema/table/column completion icons with keywords bare, a rounded block
behind the statement ⌘↵ runs (a CodeMirror layer), a Run/Stop button with
⌘. as the Stop key, rows and time only in the grid footer, and a
not-connected message or banner with a Connect button in the results.
Final run: 236 unit tests, build, lint, and 18 e2e tests pass. A codex
review followed each task; its only findings were the two advisories above
and one e2e retry bug, fixed.

Deviations: see the `> Deviation:` notes under Tasks 3, 4, 5, 7 and 9.

What the plan could have specified better: that `connectProfile` sets
`connecting` only after an `await`, so a test of "a run while connecting"
must wait for the status; and that an e2e Tab test needs to outwait
CodeMirror's 75ms accept delay.
