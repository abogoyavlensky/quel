# Rename Result Tabs Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A result tab can be given a name of its own, by double-click or from a
new right-click menu, the same way an editor tab is renamed. The name shows in
place of the statement until the result goes away.

**Tech Stack:** React 19, zustand store, TypeScript, Radix context menu
(shadcn `ui/context-menu`), Vitest, Playwright (server mode). Frontend only:
the backend does not change.

---

## Design

### Where this starts

A result tab is labelled by its statement, cut to 32 characters
(`label()` in `frontend/src/components/ResultTabs.tsx`), with the full SQL as
its tooltip. Two results of `select * from orders where …` look the same, and
nothing lets the user tell them apart. Editor tabs can already be renamed:
double-click, or right-click → Rename, with an inline `TitleInput`
(`frontend/src/components/EditorTabs.tsx`).

Results live in memory only (`EditorTab.results`; `persist.ts` does not save
them), so a name lives as long as its result: until it is closed, replaced by
the next run (when not kept), or its editor tab closes. Nothing goes to the
backend or to disk.

### Behavior

- **Double-click a result tab, or right-click → Rename**, and an input takes
  the label's place, focused. Enter or leaving it commits, Escape cancels, as
  for editor tabs. A double-click on the tab's Keep or Close button does not
  start a rename.
- **The input starts with the result's current name**, or empty with the
  statement as its placeholder when it has none. Typing replaces it either way.
- **A blank name clears the custom name** and the tab shows its statement
  again. This differs from editor tabs on purpose: there, a blank keeps the old
  name, since an editor tab always needs one; a result has a default to go back
  to.
- **A named tab shows its name in the UI font**, not the monospace one used for
  SQL, so a name and a statement are easy to tell apart. The tooltip stays the
  full SQL, so the statement is always one hover away.
- **Renaming does not keep the result.** Rename and Keep (the pin) stay
  separate, as Rename and Pin are for editor tabs. A renamed result that is not
  kept is replaced by the next run like any other. The right-click menu puts
  Keep next to Rename, so naming and keeping take two clicks.
- **The right-click menu** of a result tab: Rename, "Keep result" (or "Don't
  keep result" when kept), a separator, Close. Close does what the tab's X
  does, including cancelling a running statement. The Messages tab gets no menu
  and cannot be renamed.
- **Any kind of result can be renamed**, a running one too. The name stays when
  the statement finishes and the tab becomes rows, an update count, an error, a
  cancel or a lost-connection notice.

### Model

`ResultBase` (`frontend/src/state/store.ts`) gets an optional name:

```ts
interface ResultBase {
  id: string;
  sql: string;
  pinned: boolean;
  title?: string; // the user's name for the tab; none: it shows its statement
}
```

`resultBase` in `frontend/src/state/runner.ts` (line 81) is the only place that
carries the shared fields when a result changes kind (running → rows, update,
error, canceled, lost; and running → canceled on a failed tab close). It must
copy `title` too. Without that, the name is lost the moment the statement
finishes. `pin` and `updateRows` spread the whole result, so they keep it
already.

New action in `runner.ts`, next to `pin`:

```ts
// Name a result tab; a blank name gives it back its statement.
export function renameResult(tabId: string, resultId: string, name: string): void;
```

It trims the name. A blank name removes `title` (the key is gone, not set to
`""`). The same name as now is a no-op. A result that is gone is a no-op too:
the input's blur can come after a run replaced the result or the user closed
it. It schedules no save: results are not persisted.

### Components

- **`NameInput`** (new, `frontend/src/components/NameInput.tsx`): the inline
  input that `EditorTabs`' `TitleInput` is today, made generic. Props:
  `value`, `label` (its aria-label), optional `placeholder`, `onCommit(name)`
  and `onDone()`. It focuses and selects on mount, commits once (the `done`
  ref), commits on Enter or blur, cancels on Escape, and stops click,
  double-click and keydown from reaching the tab. `EditorTabs` uses it with
  `label="Tab name"` and `onCommit={(n) => renameTab(tab.id, n)}`, so its
  behavior and its e2e (`tabs.spec.ts`) do not change. `ResultTabs` uses it
  with `label="Result name"`.
- **`TabButton`** in `ResultTabs.tsx` must work as a Radix
  `ContextMenuTrigger asChild` child. Today it takes four props and drops the
  rest, so Radix's `onContextMenu`, `data-state` and ref would never reach the
  div. It is changed to take `React.ComponentProps<"div">` plus `selected` and
  `onSelect`, and spread the rest onto the div (React 19 passes `ref` as a
  prop, so it goes through too). Its `onKeyDown` gets the guard the editor
  tab has (`e.target === e.currentTarget`), so Enter and Space in the input
  never select the tab, even before `NameInput` stops them.
- **`ResultTabs`** holds `editing: string | null` (a result id) and the
  `renameAfterMenu` ref, copied from `EditorTabs`. Rename from the menu sets the
  ref, and the menu's `onCloseAutoFocus` opens the input once the menu has let
  go of focus. Without that the input loses focus at once (see the comment in
  `EditorTabs`). The label becomes `r.title ?? label(r.sql)`, in `font-mono`
  only when there is no title.

### Keys

The app's window-level key handlers (`App.tsx`: ⌘I, ⌘., and
`state/shortcuts.ts`) catch modifier shortcuts only, the same as while an
editor tab is renamed, so typing, arrows, ⌘A and Escape reach the input. The
grid's keydown handler is on the grid, not on the tab strip. No change is
needed there.

### Out of scope

No name in the export's suggested file name, no persistence of results or
names, no rename key (F2) or palette command. Each can follow on its own if
wanted.

### Testing

- `frontend/src/state/runner.test.ts`, next to "rename and pin": the action's
  rules, and that a name survives every change of kind and a pin.
- `frontend/e2e/query-loop.spec.ts`: rename by double-click and from the menu,
  Escape, a blank name, Keep from the menu, and a kept named result surviving
  the next run.
- `frontend/e2e/tabs.spec.ts` still passes unchanged: proof that the shared
  input kept the editor tab rename as it was.

## File Structure

| File | Change |
|---|---|
| `frontend/src/state/store.ts` | `title?: string` on `ResultBase` |
| `frontend/src/state/runner.ts` | `resultBase` copies `title`; new `renameResult` |
| `frontend/src/state/runner.test.ts` | tests for `renameResult` and for the name across kinds |
| `frontend/src/components/NameInput.tsx` | new: the shared inline rename input |
| `frontend/src/components/EditorTabs.tsx` | `TitleInput` replaced by `NameInput` |
| `frontend/src/components/ResultTabs.tsx` | `TabButton` forwards props; double-click and context menu rename; name label |
| `frontend/e2e/query-loop.spec.ts` | e2e for result rename |
| `docs/DESIGN.md` | "Results and pinning": result names |

Commands below run from the repo root. This box has no GTK/WebKit headers,
so `lgx` tasks take the `CGO_ENABLED=0 GOFLAGS=-tags=server` prefix.

### Task 1: The name in the model and the action

**Files:**
- Modify: `frontend/src/state/store.ts`
- Modify: `frontend/src/state/runner.ts`
- Test: `frontend/src/state/runner.test.ts`

- [ ] **Step 1: Write the failing tests**
  Add a `describe("rename a result", …)` after "rename and pin", using the
  file's existing run helpers (the reply stubs used by "shows a running tab
  until the reply fills it" and "keeps a pin set while the statement runs").
  Cases:
  - renames a rows result and trims the name (`"  Orders  "` → `"Orders"`);
  - a blank name removes `title` (`expect("title" in result).toBe(false)`);
  - renaming a result id that is not there changes nothing and does not throw;
  - a name given while the statement runs stays when the reply fills the tab
    as rows, and in a second case as an update count;
  - it stays when the statement fails (error) and when it is cancelled;
  - it stays across `pin`, and a kept named result keeps its name through the
    next run.
  Also add one `title` assertion to an existing test of each remaining path
  that rebuilds a result: the lost-connection notice (the "a lost connection"
  describe) and the failed tab close that turns a running result into
  canceled (find it with `grep -n "Query canceled" runner.test.ts` near the
  `closeTab` tests). Rename the running result first in each.

- [ ] **Step 2: Run them to see them fail**
  Run: `npm --prefix frontend test -- src/state/runner.test.ts`
  Expected: FAIL (`renameResult` is not a function; the type error on `title`
  shows in the editor, not in vitest).

- [ ] **Step 3: Implement**
  Add `title?: string` to `ResultBase` with its comment. Make `resultBase`
  copy `title`. Add `renameResult` after `pin` as specified in the Design:
  look the result up with `findTab(tabId)?.results.find(…)`, return when it
  is missing or the trimmed name equals its title, otherwise
  `updateResult` with the title set, or removed by destructuring
  (`const { title: _, ...rest } = r`) when blank.

- [ ] **Step 4: Run the tests to see them pass**
  Run: `npm --prefix frontend test -- src/state/runner.test.ts && (cd frontend && npx tsc -b)`
  Expected: PASS, no type errors. Existing `toEqual` assertions on results
  still pass (an absent `title` is `undefined`, which `toEqual` ignores).

- [ ] **Step 5: Commit**
  `git commit -am "Add result names to the store"`

### Task 2: The shared name input

**Files:**
- Create: `frontend/src/components/NameInput.tsx`
- Modify: `frontend/src/components/EditorTabs.tsx`

- [ ] **Step 1: Extract**
  Move `TitleInput` out of `EditorTabs.tsx` into `NameInput.tsx` as
  `NameInput`, with the props from the Design:

  ```ts
  export function NameInput(props: {
    value: string;
    label: string;
    placeholder?: string;
    onCommit: (name: string) => void;
    onDone: () => void;
  }); // return type inferred
  ```

  Keep its body as it is (focus and select in an effect with braces, the
  `done` ref, Enter/blur commit, Escape cancel, the three `stopPropagation`s,
  the class names). `size` becomes
  `Math.max(6, (value || placeholder || "").length)`, capped at 40 so a long
  statement placeholder does not make a huge input. Keep the comment, adjusted
  so it does not mention tabs only. In `EditorTabs`, render
  `<NameInput value={t.title} label="Tab name" onCommit={(n) => renameTab(t.id, n)} onDone={() => setEditing(null)} />`
  and drop the old component and any imports that are left unused.

- [ ] **Step 2: Verify**
  Run: `(cd frontend && npx tsc -b) && npm --prefix frontend run lint && CGO_ENABLED=0 GOFLAGS=-tags=server bash scripts/e2e.sh tabs.spec.ts`
  Expected: no errors; `tabs.spec.ts` passes unchanged. (`lgx e2e` runs every
  spec and takes no arguments; `scripts/e2e.sh` passes its arguments to
  Playwright.)

- [ ] **Step 3: Commit**
  `git add frontend/src/components/NameInput.tsx && git commit -am "Share the tab name input"`

### Task 3: Rename in the result tab strip

**Files:**
- Modify: `frontend/src/components/ResultTabs.tsx`

- [ ] **Step 1: Make `TabButton` a menu trigger**
  Change its props to `{ selected: boolean; onSelect: () => void } & React.ComponentProps<"div">`,
  spread the rest onto the div, and merge `className` with `cn`. Guard its
  `onKeyDown` with `e.target === e.currentTarget`. The Messages tab keeps
  using it as now.

- [ ] **Step 2: Wrap each result tab in a context menu**
  Import `ContextMenu`, `ContextMenuContent`, `ContextMenuItem`,
  `ContextMenuSeparator` and `ContextMenuTrigger` from
  `@/components/ui/context-menu`, and `renameResult` from `@/state/runner`.
  Add `editing` state and the `renameAfterMenu` ref to `ResultTabs`, with the
  `EditorTabs` comment on why the input waits for the menu to close. For each
  result: `<ContextMenu key={r.id}><ContextMenuTrigger asChild><TabButton …>`.
  The menu's content has `onCloseAutoFocus` copied from `EditorTabs`, and the
  items Rename (sets the ref), "Keep result" / "Don't keep result"
  (`pin`), a separator, and Close (`closeResult`).

- [ ] **Step 3: Double-click and the input**
  `TabButton` gets `onDoubleClick` that sets `editing` to the result id,
  unless the event started inside a button
  (`(e.target as HTMLElement).closest("button")`). While editing, the label
  span is replaced by
  `<NameInput value={r.title ?? ""} placeholder={label(r.sql)} label="Result name" onCommit={(n) => renameResult(tab.id, r.id, n)} onDone={() => setEditing(null)} />`.
  Otherwise the span shows `r.title ?? label(r.sql)`, with `font-mono` only
  when `r.title` is unset. Keep `title={r.sql}` as the tooltip. Update the
  component's header comment to mention renaming and the menu.

- [ ] **Step 4: Verify**
  Run: `npm --prefix frontend test && (cd frontend && npx tsc -b) && npm --prefix frontend run lint`
  Expected: all pass.

- [ ] **Step 5: Commit**
  `git commit -am "Rename result tabs"`

### Task 4: End-to-end test

**Files:**
- Modify: `frontend/e2e/query-loop.spec.ts`

- [ ] **Step 1: Write the test**
  Add `test("renames a result tab", …)` using the file's `open`, `write` and
  `resultTabs` helpers. Steps and checks:
  1. Run `select id from t limit 3;`. Double-click
     `resultTabs(page).nth(1)`. The textbox named "Result name" is focused and
     empty. Type `First three`, press Enter. The tab's text is
     `First three` and its `title` attribute is the statement.
  2. Right-click the tab → menuitem Rename. The textbox is focused with
     `First three`. Type something, press Escape: the tab still says
     `First three`.
  3. Right-click → Rename, press `ControlOrMeta+a`, then Backspace, then
     Enter. The tab reads `select id from t limit 3` again (24 characters, under the 32 that `label()` keeps).
  4. Rename it to `Kept`, then right-click → menuitem "Keep result". The
     tab's "Keep result" button has `aria-pressed="true"`. Run
     `select 1 as one;`. `resultTabs` text is
     `["Messages", "Kept", "select 1 as one"]`.

- [ ] **Step 2: Run it**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e`
  Expected: the new test and all existing specs pass (`lost-connection` may
  skip, as before).

- [ ] **Step 3: Commit**
  `git commit -am "Test result tab rename end to end"`

### Task 5: Docs

**Files:**
- Modify: `docs/DESIGN.md`

- [ ] **Step 1: Describe it**
  In "Results and pinning", after the paragraph on pinning, add a short
  paragraph: a result tab can be renamed by double-click or from its
  right-click menu (Rename, Keep result, Close); the name lives as long as the
  result, in memory only; a blank name gives back the statement; renaming does
  not keep the result; the tooltip is always the statement.

- [ ] **Step 2: Commit**
  `git commit -am "Document result tab names"`
