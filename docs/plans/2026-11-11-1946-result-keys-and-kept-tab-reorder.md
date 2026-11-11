# Result Keys and Kept-Tab Reorder Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enter on a selected result row opens the row details panel; ⌘PageUp / ⌘PageDown (Ctrl elsewhere) cycle the result tabs or the editor tabs, whichever area has focus; a kept result tab can be dragged to a new place in the result tab strip.

**Tech Stack:** React 19, zustand store (`state/store.ts`, `state/runner.ts`), pointer events (no drag library), Tailwind, Vitest, Playwright (server mode, `lgx e2e`).

---

## Design

Three small, independent frontend changes. Nothing touches the backend:
results, their order and the row details panel all live in memory.

### 1. Enter opens the row details

While the result grid has focus and a row is selected, **Enter** (no
modifiers) opens the row details panel. It only opens, like a double-click
on a row: a second Enter does nothing, and `⌘I` stays the key that closes.
With no selected row, Enter does nothing. Focus stays in the grid, so ↑/↓
keep moving the selection and the panel follows.

The key goes in the grid's own `onKeyDown` (`grid/ResultGrid.tsx`), after
the guard that drops events with a modifier and before the arrow-key code.
The find bar is a sibling of the grid's scroller, not a child, so its
Enter ("next match") never reaches this handler.

### 2. ⌘PageUp / ⌘PageDown cycle tabs

`⌘PageUp` selects the previous tab and `⌘PageDown` the next, wrapping at
both ends. Which strip they cycle depends on where focus is:

- **Focus inside the results pane** (`document.activeElement` is inside
  `[data-quel-results]`, the marker `AppShell.tsx` already puts on the
  results panel): cycle the active editor tab's result tabs. The order is
  the strip's: Messages, then `tab.results` left to right.
- **Focus anywhere else** (the editor, the sidebar, the row details panel,
  nothing): cycle the editor tabs in `workspace.tabs` order.

After a switch, focus follows the selection so the next press cycles the
same strip:

- Editor tabs: the editor, on the next tick (as `⌘1–9` do).
- Result tabs: on the next tick, the grid (`[data-result-grid]`) when the
  new result has one; otherwise the selected tab button in the strip
  (`[data-quel-results] [role="tab"][aria-selected="true"]`). Tab buttons
  are already focusable (`tabIndex={0}`) and inside the pane, so Messages
  and results without rows need no new focus target. The selected tab
  button is also scrolled into view (`scrollIntoView({ block: "nearest",
  inline: "nearest" })`), since the strip scrolls horizontally.

Guards, the same as `⌘1–9`: nothing under a dialog or palette, with no
workspace, or with a load error (`loadedWorkspace()` in
`state/palette.ts`). With one tab in the strip the key changes nothing.
Hidden results (`⌘J`) have no element in the page, so the keys cycle
editor tabs.

The key is matched in `shortcutOf` (`state/shortcuts.ts`) as a new
shortcut kind and handled by the existing capture-phase listener
(`useGlobalKeys` in `App.tsx`):

```ts
| { kind: "cycle"; dir: -1 | 1 } // ⌘PageUp: -1, ⌘PageDown: 1
```

`e.key` is `"PageUp"` / `"PageDown"`; Shift or Alt held means no match.
CodeMirror binds only the plain keys, and the listener runs before it.

No Command Palette entries and no native menu items: the palette takes
focus, so "the focused area" would be lost. No `⇧⌘[` / `⇧⌘]` aliases.

Known limit, for the docs: in server mode in a real Chromium on Linux or
Windows, the browser keeps Ctrl+PageUp/PageDown for its own tabs and the
page never sees them. The desktop app and Playwright are not affected.

### 3. Drag a kept result tab to reorder

A **kept** (pinned) result tab can be dragged along the result tab strip.
Tabs that are not kept cannot be picked up, and Messages stays first.

- **Where it can land:** any place among the result tabs. Kept and unkept
  tabs can be interleaved (keeping a result does not move it), so a kept
  tab may be dropped between unkept ones. A run drops the unkept results
  and keeps the kept ones in their order (`runner.ts`, `runStatements`),
  so the order among kept tabs survives runs with no extra work.
- **State:** one new runner action, `moveResult(tabId, resultId, toIndex)`,
  moves the result to `toIndex` in `tab.results` (clamped; a no-op when it
  is already there or the result is gone). It changes nothing else:
  `tab.active` stays, so a drag never changes which result is shown.
  The action is general; the strip is what only lets kept tabs be picked
  up.
- **Gesture:** `pointerdown` with the primary button on a kept tab arms a
  drag. It becomes a drag once the pointer has moved more than 4 px
  horizontally; until then nothing happens, so click-to-select,
  double-click rename and the right-click menu work as before. A press
  that starts on the keep or close button, or in the name input, never
  arms one (`closest("button, input")`), and neither does a press with
  Ctrl held (the macOS context-menu click).
- **Live reorder, no ghost:** while dragging, each `pointermove` computes
  the place the dragged tab should have from the tabs' current rectangles
  and calls `moveResult` when it differs. The tabs reorder in place as
  the pointer passes the middle of a neighbour; the dragged tab is marked
  (`data-dragging`, a ring and `cursor-grabbing` on the strip) but does
  not float under the pointer. This keeps the code free of transforms
  and measured offsets.
- **Midpoint rule:** the dragged tab moves right past every following tab
  whose centre is left of the pointer, and left past every preceding tab
  whose centre is right of the pointer. With tabs of different widths
  this is stable: after a swap the neighbour's centre moves further from
  the pointer, so the tabs never flicker back.
- **Edge scroll:** while dragging, a pointer within 24 px of the strip's
  left or right edge scrolls the strip by 12 px per `pointermove`.
- **End and cancel:** `pointerup` ends the drag where it is. **Escape**
  or `pointercancel` puts the tab back at the index it started from
  (clamped, in case a run changed the results meanwhile). The click that
  the browser fires after a drag's `pointerup` is swallowed, so a drop
  never selects the tab.
- **Listeners:** the strip (`role="tablist"`) gets `onPointerDown` and
  `onClickCapture`. From arming to release the hook listens on `window`
  for `pointermove`, `pointerup`, `pointercancel` and (capture phase)
  `keydown`. No pointer capture: React moves a keyed tab's DOM node when
  the order changes, and a node that leaves the document loses its
  capture. Tabs carry `data-result-id`, and kept ones `data-kept`, so the
  hook finds them from the strip.

### Testing

- **Vitest:** `shortcutOf` (the new kind), `cycleTabsKey` (both areas,
  wrap, focus target, guards), `moveResult`, and the pure geometry in
  `lib/reorder.ts`.
- **Playwright** (`lgx e2e`): Enter in `row-details.spec.ts`; the cycle
  keys and the drag in a new `result-tabs.spec.ts`.

## File Structure

| File | Change |
|---|---|
| `frontend/src/grid/ResultGrid.tsx` | Enter opens the row details |
| `frontend/src/state/shortcuts.ts` | the `cycle` shortcut kind |
| `frontend/src/state/palette.ts` | `cycleTabsKey(dir)` |
| `frontend/src/App.tsx` | `useGlobalKeys` routes `cycle`; comment |
| `frontend/src/lib/reorder.ts` (new) | pure helpers: `moveItem`, `dragTarget` |
| `frontend/src/state/runner.ts` | `moveResult` |
| `frontend/src/components/useResultTabDrag.ts` (new) | the drag hook: pointer and key listeners, edge scroll, click swallow |
| `frontend/src/components/ResultTabs.tsx` | wires the hook; `data-result-id`, `data-kept`, drag styles; comment |
| `frontend/src/state/shortcuts.test.ts`, `palette.test.ts`, `runner.test.ts`, `frontend/src/lib/reorder.test.ts` (new) | unit tests |
| `frontend/e2e/row-details.spec.ts`, `frontend/e2e/result-tabs.spec.ts` (new) | UI tests |
| `docs/DESIGN.md` | Row details, Results and pinning, the keys table and Keys paragraph |

Shared signatures (tasks must agree on these):

```ts
// lib/reorder.ts
export function moveItem<T>(list: readonly T[], from: number, to: number): T[];
export interface Span { left: number; right: number }
// The index the item at `from` should have with the pointer at x.
export function dragTarget(spans: readonly Span[], from: number, x: number): number;

// state/runner.ts
export function moveResult(tabId: string, resultId: string, toIndex: number): void;

// state/palette.ts
export function cycleTabsKey(dir: -1 | 1): void;

// components/useResultTabDrag.ts
export function useResultTabDrag(tabId: string): {
  dragging: string | null; // the dragged result's id
  stripProps: { onPointerDown: React.PointerEventHandler; onClickCapture: React.MouseEventHandler };
};
```

Commands used below, from the repo root:

- Unit tests: `npm --prefix frontend test`
- Lint: `npm --prefix frontend run lint`
- Types and build: `npm --prefix frontend run build`
- UI tests: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e` (on Linux without
  GTK headers; plain `lgx e2e` otherwise). One spec:
  `CGO_ENABLED=0 GOFLAGS=-tags=server bash scripts/e2e.sh e2e/<name>.spec.ts`.

Work on a branch (`result-keys-and-tab-reorder`), not on `master`.

---

### Task 1: Enter opens the row details

**Files:**
- Modify: `frontend/src/grid/ResultGrid.tsx`
- Test: `frontend/e2e/row-details.spec.ts`

- [ ] **Step 1: Implement**
  In `onKeyDown`, after `if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;`
  and before the arrow-key check: on `e.key === "Enter"` with
  `result.selectedRow !== null`, `preventDefault()`, call
  `openRowDetails()` (already imported) and return. With no selected row,
  fall through and do nothing. Update the file's header comment (the one
  that says what a click and a double-click do) to mention Enter.

- [ ] **Step 2: Extend the UI test**
  In `row-details.spec.ts` add a test: run the three-row query, click
  row 2, press Enter → the panel shows "Row 2 of 3" and the grid is still
  focused; press ArrowDown → "Row 3 of 3"; press Enter again → the panel
  is still open; `ControlOrMeta+i` closes it. Also: a fresh result with
  no selected row, grid focused through `ControlOrMeta+r`, Enter → the
  panel stays closed.

- [ ] **Step 3: Run**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server bash scripts/e2e.sh e2e/row-details.spec.ts`
  Expected: PASS

- [ ] **Step 4: Commit**
  `git commit -m "Open row details with Enter on a selected row"`

### Task 2: The cycle shortcut

**Files:**
- Modify: `frontend/src/state/shortcuts.ts`
- Test: `frontend/src/state/shortcuts.test.ts`

- [ ] **Step 1: Write failing tests**
  `⌘PageUp` → `{ kind: "cycle", dir: -1 }`, `⌘PageDown` →
  `{ kind: "cycle", dir: 1 }`, with `cmd` on macOS and `ctrl` elsewhere;
  `null` with Shift, with Alt, without the modifier, and for Ctrl on
  macOS.

- [ ] **Step 2: Run to see them fail**
  Run: `npm --prefix frontend test -- shortcuts`
  Expected: the new cases FAIL

- [ ] **Step 3: Implement**
  Add the kind to the `Shortcut` union and match it after the
  `if (e.shiftKey) return null;` line, on the unlowered `e.key`
  (`"PageUp"` / `"PageDown"`). Update the two comments in the file that
  list the keys.

- [ ] **Step 4: Run**
  Run: `npm --prefix frontend test -- shortcuts`
  Expected: PASS

- [ ] **Step 5: Commit**
  `git commit -m "Match ⌘PageUp and ⌘PageDown as a tab cycle shortcut"`

### Task 3: Cycle tabs by the focused area

**Files:**
- Modify: `frontend/src/state/palette.ts`, `frontend/src/App.tsx`
- Test: `frontend/src/state/palette.test.ts`, `frontend/e2e/result-tabs.spec.ts` (new)

- [ ] **Step 1: Write failing unit tests**
  In `palette.test.ts` (it stubs `document` as a plain object and mocks
  `@/state/runner`; add `selectResult` to that mock). Cases for
  `cycleTabsKey`:
  - focus outside the results (`activeElement: null`, and an element
    whose `closest` returns `null`): with three editor tabs, `1` from the
    first selects the second, `-1` from the first selects the last
    (wrap); `focusEditor` is called on the next tick.
  - focus inside the results (an `activeElement` whose
    `closest("[data-quel-results]")` returns an object): with results
    `r1`, `r2` and `active: "r1"`, `1` calls `selectResult(tabId, "r2")`,
    `-1` calls `selectResult(tabId, MESSAGES)`; from `r2`, `1` wraps to
    `MESSAGES`.
  - focus after a result switch, on the next tick: the grid when
    `querySelector("[data-result-grid]")` finds one; otherwise the
    selected tab button, which also gets `scrollIntoView`.
  - one editor tab, or a tab with no results: no select call.
  - nothing with no workspace, a load error, or a palette open.

- [ ] **Step 2: Run to see them fail**
  Run: `npm --prefix frontend test -- palette`
  Expected: the new cases FAIL

- [ ] **Step 3: Implement `cycleTabsKey`**
  In `palette.ts`, next to `focusTabKey`, as the Design section says:
  `loadedWorkspace()` guard; area from
  `document.activeElement?.closest?.("[data-quel-results]")`; ids are
  `[MESSAGES, ...tab.results.map((r) => r.id)]` or
  `w.tabs.map((t) => t.id)`; the next id is
  `ids[(i + dir + ids.length) % ids.length]`; return without selecting
  when the list has one id. Read the active editor tab with
  `activeTabOf(w)`; the current result id is `tab.active`. Focus on
  `setTimeout`, as described. Import `selectResult` from
  `@/state/runner`.

- [ ] **Step 4: Route the key**
  In `App.tsx` `useGlobalKeys`, add `else if (k.kind === "cycle")
  cycleTabsKey(k.dir);` before the final `else` (which stays the `tab`
  case). Extend the comment above the hook with the new keys.

- [ ] **Step 5: Run unit tests**
  Run: `npm --prefix frontend test -- palette`
  Expected: PASS

- [ ] **Step 6: Write the UI test**
  New `frontend/e2e/result-tabs.spec.ts`, following `results.spec.ts`
  (its header comment, `db`, `editor`, `grid` helpers; `connectFixture`).
  A helper runs a three-statement script with
  `ControlOrMeta+Shift+Enter`:
  `select 1 as a; select 2 as b; select 3 as c;`. Test "⌘PageUp and
  ⌘PageDown cycle the focused area's tabs":
  - after the run the third result is selected; press `ControlOrMeta+r`
    (grid focused), then `ControlOrMeta+PageDown` → Messages is the
    selected tab in the `Results` tablist and has focus; again → the
    first result is selected and the grid is focused;
    `ControlOrMeta+PageUp` twice → the third result.
  - add a second editor tab (`ControlOrMeta+t`), click the editor,
    `ControlOrMeta+PageUp` → the first editor tab is selected and the
    editor is focused; `ControlOrMeta+PageDown` → the second.

- [ ] **Step 7: Run**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server bash scripts/e2e.sh e2e/result-tabs.spec.ts`
  Expected: PASS

- [ ] **Step 8: Commit**
  `git commit -m "Cycle result or editor tabs with ⌘PageUp and ⌘PageDown"`

### Task 4: Reorder helpers and `moveResult`

**Files:**
- Create: `frontend/src/lib/reorder.ts`, `frontend/src/lib/reorder.test.ts`
- Modify: `frontend/src/state/runner.ts`
- Test: `frontend/src/state/runner.test.ts`

- [ ] **Step 1: Write failing tests for the helpers**
  `moveItem`: forward, backward, same index (returns an equal list),
  `to` clamped to the list's ends, the input not mutated.
  `dragTarget` with spans of unequal widths, e.g.
  `[{0,40}, {44,144}, {148,188}]`:
  - from 0: x = 50 → 0; x = 95 (past the centre 94 of the second) → 1;
    x = 170 (past the centre 168 of the third) → 2.
  - from 2: x = 150 → 2; x = 90 → 1; x = 10 → 0.
  - stability: after moving index 0 to 1 the spans are
    `[{0,100}, {104,144}, {148,188}]`; from 1 with x = 95 → 1.

- [ ] **Step 2: Run to see them fail**
  Run: `npm --prefix frontend test -- reorder`
  Expected: FAIL (no module)

- [ ] **Step 3: Implement `lib/reorder.ts`**
  `dragTarget`: start at `from`; while the next span's centre is less
  than `x`, step right; if no step right was taken, while the previous
  span's centre is greater than `x`, step left. Comment the midpoint rule
  and why it does not flicker.

- [ ] **Step 4: Write failing tests for `moveResult`**
  In `runner.test.ts`, with a tab holding three results (reuse the
  file's helpers for a script run): moving the third to index 0 gives the
  order third, first, second and leaves `active` alone; an index past the
  end is clamped; the same index and an unknown result id leave the state
  object for the tab unchanged (`toBe`). One more: keep all three,
  reorder, run again → the kept ones keep the new order ahead of the new
  result.

- [ ] **Step 5: Implement `moveResult`**
  Next to `pin` in `runner.ts`, with `updateTab` and `moveItem`. Return
  the tab unchanged when nothing moves. Comment: results live in memory
  only, so nothing is saved; the strip only lets kept tabs be dragged.

- [ ] **Step 6: Run**
  Run: `npm --prefix frontend test -- reorder runner`
  Expected: PASS

- [ ] **Step 7: Commit**
  `git commit -m "Add moveResult and the drag reorder helpers"`

### Task 5: Drag kept result tabs

**Files:**
- Create: `frontend/src/components/useResultTabDrag.ts`
- Modify: `frontend/src/components/ResultTabs.tsx`
- Test: `frontend/e2e/result-tabs.spec.ts`

- [ ] **Step 1: Implement the hook**
  `useResultTabDrag(tabId)` as the Design section describes. Details that
  must hold:
  - `onPointerDown`: ignore unless `e.button === 0`, no `ctrlKey`, the
    target is not inside `button, input`, and
    `target.closest("[data-result-id][data-kept]")` exists inside the
    strip (`e.currentTarget`). Remember the result id, the start x, the
    strip element and the result's index at that moment; add the `window`
    listeners.
  - `pointermove`: before the 4 px threshold, nothing. After it, set
    `dragging` (state, for the styles) once; then read
    `strip.querySelectorAll("[data-result-id]")`, map to `Span`s with
    `getBoundingClientRect()`, find the dragged tab's index by its id,
    and call `moveResult` when `dragTarget` gives another index. Then the
    edge scroll.
  - `pointerup`: remove the listeners, clear `dragging`; when a drag
    happened, set a ref that `onClickCapture` reads to stop that one
    click (`stopPropagation` and `preventDefault`), and clear the ref on
    the next tick so a later click is not eaten when no click follows.
  - Escape (`keydown` on `window`, capture phase, only while dragging) and
    `pointercancel`: `moveResult` back to the start index, then end as
    `pointerup` does; Escape calls `preventDefault` and
    `stopPropagation`.
  - Keep the armed/drag data in a ref, not state: only `dragging` renders.
    `AppShell.tsx` renders `<ResultTabs>` without a key, so an editor tab
    switch (⌘1–9 with the mouse held) reuses the component with a new
    `tabId`. End the drag in an effect cleanup that depends on `tabId`
    (it also runs on unmount): remove the `window` listeners, clear the
    ref and `dragging`, and do not move anything back. As a second guard,
    a `pointermove` that cannot find the dragged id in the strip ends the
    drag the same way. Effects use braces (AGENTS.md).

- [ ] **Step 2: Wire the strip**
  In `ResultTabs.tsx`: call the hook with `tab.id`; spread `stripProps`
  on the `role="tablist"` div and add `cursor-grabbing` to it while
  `dragging` is set. On each result's `TabButton` add
  `data-result-id={r.id}`, `data-kept={r.pinned ? "" : undefined}` and
  `data-dragging` for the dragged one, styled with a ring
  (`data-dragging:ring-1 data-dragging:ring-ring`, or the `cn` form the
  file uses). Messages gets none of these. Extend the component's header
  comment: a kept tab drags to a new place; others do not.

- [ ] **Step 3: Check by hand that the old gestures still work**
  Covered by existing specs; run them:
  `CGO_ENABLED=0 GOFLAGS=-tags=server bash scripts/e2e.sh e2e/query-loop.spec.ts`
  Expected: PASS (rename by double-click, the context menu, keep, close)

- [ ] **Step 4: Write the UI test**
  In `result-tabs.spec.ts`, test "a kept result tab drags to a new
  place; others stay": run the three-statement script; keep all three
  (hover each tab, click its `Keep result` button). Read the order as the
  `title` attributes of the tabs in the `Results` tablist after Messages.
  Drag the third onto the first with `page.mouse` (`move` to the third's
  centre, `down`, `move` to the first's left quarter with `steps: 8`,
  `up`) → order `select 3 as c`, `select 1 as a`, `select 2 as b`; the
  selected tab is the one that was selected before the drag. Then:
  - Escape mid-drag: `down`, move past a neighbour, press Escape, `up` →
    the order is unchanged.
  - Unkeep the last tab and try to drag it to the front → the order is
    unchanged.
  - Run `select 4 as d;` → the two kept tabs keep their order, followed
    by the new result.

- [ ] **Step 5: Run**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server bash scripts/e2e.sh e2e/result-tabs.spec.ts`
  Expected: PASS

- [ ] **Step 6: Commit**
  `git commit -m "Drag kept result tabs to reorder them"`

### Task 6: Docs and the full check

**Files:**
- Modify: `docs/DESIGN.md`

- [ ] **Step 1: Update DESIGN.md**
  - *Row details*: Enter on a selected row opens the panel, like the
    double-click (only opens).
  - *Results and pinning*: a kept tab drags to a new place in the strip;
    unkept tabs and Messages do not move; the order lives in memory and
    survives runs.
  - The keys table: a row for `⌘PageUp, ⌘PageDown / Ctrl+PageUp,
    Ctrl+PageDown` (previous and next tab, wrapping: the result tabs
    while focus is in the results, else the editor tabs). The **Keys**
    and **Dialog guards** paragraphs: add the keys, and the server-mode
    limit (a real browser on Linux and Windows keeps Ctrl+PageUp/PageDown
    for itself).
  Use /writing-clearly.

- [ ] **Step 2: Run everything**
  Run: `npm --prefix frontend run lint && npm --prefix frontend test && npm --prefix frontend run build`
  Expected: no lint errors, all tests PASS, the build succeeds
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e`
  Expected: PASS

- [ ] **Step 3: Commit**
  `git commit -m "Document Enter, the tab cycle keys and kept-tab reorder"`
