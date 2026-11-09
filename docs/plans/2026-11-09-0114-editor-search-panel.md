# Editor Find and Go to Line Panels Implementation Plan

**Status: completed**

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CodeMirror's stock find/replace panel and go-to-line dialog with panels built from the app's own controls, docked at the top of the editor.

**Tech Stack:** CodeMirror 6 (`@codemirror/search`, `@codemirror/view`), React 19 (portals, `useSyncExternalStore`), shadcn `InputGroup` / `Toggle` / `Button`, lucide-react icons, Tailwind, Vitest, Playwright.

---

## Design

### What is wrong today

- `frontend/src/editor/setup.ts` adds `searchKeymap` but never calls
  `search({...})`. ⌘F opens CodeMirror's default panel, at the **bottom**
  of the editor. It has native grey buttons, bare checkboxes and lowercase
  text labels ("next", "previous", "all", "match case", "regexp",
  "by word", "replace", "replace all").
- The `chrome` theme in `setup.ts` styles none of `.cm-panels`,
  `.cm-search`, `.cm-textfield` or `.cm-button`.
- `RunButton` is `absolute right-4 bottom-3 z-10` over the editor
  (`components/AppShell.tsx:85-87`, `components/RunButton.tsx:22`). A
  bottom panel's right end, where its × and replace buttons sit, ends up
  under Run.
- ⌘⌥G (`gotoLine`, from the same keymap) opens a stock `showDialog`
  form, also at the bottom, with the same look. `gotoLine` takes no
  options, and `showDialog` always appends its own stock "×", so it
  cannot be restyled from outside.
- Match highlights use CodeMirror's base colours. Its `&dark` rules
  depend on `EditorView.darkTheme`, which the app never sets, so the dark
  theme gets the light theme's yellow and orange.

### What we build

Two panels, docked at the top of the editor. They are built from the
app's controls and share one look: background `--background`, a bottom
border `--border`, compact `text-xs` controls, `h-7` fields in the
editor's font.

**Find panel** (⌘F / Ctrl+F):

```
[›] [ Find…              Aa ab .* ]  3 of 12   ↑  ↓               ×
    [ Replace…                    ]  ⇄  ⇄all                        (folded out by ›)
```

- `›` (ChevronRight, rotated 90° when open) folds the replace row in and
  out. The row starts open when the query already has replace text, and
  closed otherwise.
- The find field is an `InputGroupInput` with three toggles inside it as
  `InputGroupAddon align="inline-end"`: Match case (CaseSensitive), Match
  whole word (WholeWord), Use regular expression (Regex). Each is an
  `InputGroupButton` with `aria-pressed`, styled pressed like `Toggle`.
- Count, muted and `tabular-nums`: "3 of 12" when the main selection is
  a match, "12 matches" / "1 match" when it is not, "No results" for a
  non-empty query that matches nothing, and nothing for an empty query.
  Counting stops at 1,000: "1000+ matches", "3 of 1000+".
- An invalid regular expression sets `aria-invalid` on the field, which
  `InputGroup` already draws as an error ring. The count stays empty.
- Previous match (ArrowUp), Next match (ArrowDown), and Close (X) at the
  far right. All are `Button
  variant="ghost" size="icon-xs"` with `aria-label` and a `title` that
  names the key.
- Replace row: `InputGroupInput` "Replace", then Replace (Replace) and
  Replace all (ReplaceAll) icon buttons.
- Keys: Enter = next, Shift+Enter = previous (find field). Enter =
  replace next (replace field). Escape closes and returns focus to the
  editor. ⌘F re-selects the field. ⌘G / F3 and their Shift forms keep
  working. ⌘⌥G switches to Go to Line. The stock panel's "all"
  (`selectMatches`) is dropped: the editor does not enable
  `EditorState.allowMultipleSelections`, so it would collapse to one
  selection (see Not in scope). Everything except Enter goes
  through `runScopeHandlers(view, event, "search-panel")`, as the stock
  panel does.

**Go to Line panel** (⌘⌥G / Ctrl+Alt+G):

```
Go to line  [ 42        ]  Line, +n, -n, n%, line:col                ×
```

- The field starts with the current line number, selected (as stock).
- Enter on a valid target moves the cursor, scrolls it to the centre,
  closes the panel and focuses the editor. On an invalid target the field
  shows `aria-invalid` and the panel stays open. The stock dialog closes
  silently instead.
- Escape closes it and focuses the editor. ⌘F switches to Find. ⌘⌥G
  re-selects the field.
- Parsing is ported from `gotoLine` (`@codemirror/search` `index.js:326`)
  into a pure function: `42`, `+5`, `-3`, `50%`, `+10%`, `12:8`, `:8`.

**One panel at a time.** Opening Find closes Go to Line and the other way
round, so the two never stack and push the SQL down twice.

**Match highlights** get two new tokens next to `--sql-*` in `index.css`,
for light and dark: `--search-match` and `--search-match-current`.
`.cm-searchMatch` and `.cm-searchMatch-selected` use them.
`.cm-selectionMatch` (from `highlightSelectionMatches`) gets a quiet
`color-mix` of `--muted-foreground`, and stays transparent inside a
search match, as CodeMirror's base theme does.

### How it fits CodeMirror

The panels stay CodeMirror panels, so CodeMirror owns their lifecycle.
Each tab's `EditorState` carries its own open/closed state and query, and
`view.setState` on a tab switch rebuilds them. React draws their contents
through **portals from `SqlEditor`**, not through separate React roots.
That gives one React tree, no root to unmount from inside a passive
effect (React warns about that), and no `flushSync`.

```
CodeMirror                                 React (inside SqlEditor)
-----------                                -------------------------
search({ top: true, createPanel })   ──┐
goToLineField + showPanel            ──┤   dom: empty div per panel
   panel.update(): rev++             ──┴─► panelStore ──useSyncExternalStore──► EditorPanels
   panel.destroy(): remove host                                      ├─ createPortal(<FindPanel/>, host.dom)
                                                                     └─ createPortal(<GoToLinePanel/>, host.dom)
FindPanel reads getSearchQuery(view.state) and dispatches setSearchQuery / findNext / ... on view
```

- `editor/panels.ts` (no React) holds the store, the find panel's
  `createPanel`, the Go to Line state field and panel, the two open
  commands and the panel keymap.
- A panel's `dom` is an empty `div` (class `cm-quel-panel`, plus
  `cm-search` for the find panel, so CodeMirror's `.cm-search` hooks still
  apply). Creating a panel registers `{ kind, dom, view, focus }` in the
  store. `update(u)` bumps `rev` when the document, the selection or the
  search query changed. `destroy()` removes the host, but only if it is
  still the registered one.
- **Focus only when a command opened it.** Our `openFind` /
  `openGoToLine` commands set a module flag before they dispatch. The
  `createPanel` that runs during that dispatch takes it as `focus: true`
  and clears it. A panel rebuilt by `view.setState` (tab switch) gets
  `focus: false`, so the editor keeps the caret that `SqlEditor` gives it.
  The component selects its main field in a layout effect when
  `host.focus` is set. When the panel is already open, the command
  selects the `[main-field]` element itself, as `openSearchPanel` does.
- The fields are controlled from editor state: the value is
  `getSearchQuery(view.state).search`, and `onChange` dispatches
  `setSearchQuery` synchronously. A `useSyncExternalStore` update inside a
  discrete event renders synchronously, so the caret does not jump.
  External changes, such as ⌘F seeding the query from the selection, show
  up through the same path.
- Counting: one pass of `query.getCursor(state)`, capped at 1,000, run
  again when the document, the query or the selection changes. The
  current index comes from comparing the main selection with the found
  ranges. At this cap and at SQL-tab sizes a rescan per navigation is
  cheap, so there is no separate range cache.

### Keymap

In `setup.ts`, `searchKeymap` is filtered to drop its `Mod-f`,
`Mod-Alt-g`, `Mod-g` and `F3` entries. In their place, `panels.ts` exports:

```ts
const scope = "editor search-panel goto-panel";
export const panelKeymap: KeyBinding[] = [
  { key: "Mod-f", run: openFind, scope, preventDefault: true },
  { key: "Mod-Alt-g", run: openGoToLine, scope, preventDefault: true },
  { key: "Mod-g", run: viaFind(findNext), shift: viaFind(findPrevious), scope, preventDefault: true },
  { key: "F3", run: viaFind(findNext), shift: viaFind(findPrevious), scope, preventDefault: true },
];
```

`findNext` and `findPrevious` call `openSearchPanel` themselves when the
query is empty or invalid (`searchCommand`, `@codemirror/search`
`index.js:838`). That would bypass `openFind`: no focus, and Find stacked
over an open Go to Line. `viaFind(cmd)` runs `openFind(view)` when
`!getSearchQuery(view.state).valid`, and `cmd(view)` otherwise.
(`getSearchQuery` returns an empty, invalid query before search state
exists.)

The Go to Line component sends keys other than Enter and Escape through
`runScopeHandlers(view, event, "goto-panel")`. The stock `Escape` →
`closeSearchPanel` binding (scope `editor search-panel`) stays in the
filtered `searchKeymap`.

### Not in scope

- A shortcut that opens Find with replace already folded out (⌥⌘F).
  The chevron is the way in.
- Command Palette or native menu entries for Find / Go to Line.
- Select all matches, and multiple cursors in general. They need
  `EditorState.allowMultipleSelections`, which the editor does not enable
  today. That would ripple into the runner, which reads the main
  selection, and into the statement highlight. `Mod-d` and `Mod-Shift-l`
  from `searchKeymap` keep their current single-selection behaviour.
- Carrying the query from one tab to the next. Each tab keeps its own,
  as it does today.

### Testing

- Vitest (node environment, `src/**/*.test.ts`): the pure count function
  and the go-to-line parser, run against real `EditorState`s.
- Playwright (`frontend/e2e/search.spec.ts`): ⌘F opens a top panel with
  focus in the field; typing shows "1 of N" / "No results"; Enter moves
  the selection; replace folds out and Replace all rewrites the text;
  Escape returns focus to the editor; ⌘⌥G jumps to a line; Find and
  Go to Line close each other; the find panel's close button is not
  under the Run button; a tab switch keeps the panel open without taking
  the editor's focus.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/src/editor/searchCount.ts` | Create | `countMatches(state, query, cap)` and `countLabel(...)`. Pure. |
| `frontend/src/editor/searchCount.test.ts` | Create | Unit tests for both. |
| `frontend/src/editor/goToLine.ts` | Create | `goToLineTarget(state, input)`: the ported parser. Pure. |
| `frontend/src/editor/goToLine.test.ts` | Create | Unit tests for the parser. |
| `frontend/src/editor/panels.ts` | Create | Panel store, find `createPanel`, Go to Line field/panel/effects, `openFind`, `openGoToLine`, `closeGoToLine`, `panelKeymap`, `findExtension`. |
| `frontend/src/editor/FindPanel.tsx` | Create | Find/replace controls. |
| `frontend/src/editor/GoToLinePanel.tsx` | Create | Go to Line controls. |
| `frontend/src/editor/EditorPanels.tsx` | Create | Subscribes to the store, portals both panels. |
| `frontend/src/editor/SqlEditor.tsx` | Modify | Render `<EditorPanels />` next to the host div. |
| `frontend/src/editor/setup.ts` | Modify | Add `findExtension`, `goToLineField`, `panelKeymap`; filter `searchKeymap`; panel and match rules in `chrome`. |
| `frontend/src/index.css` | Modify | `--search-match`, `--search-match-current` (light and dark). |
| `frontend/src/components/keys.ts` | Modify | `FIND_KEY`, `GO_TO_LINE_KEY` labels (`FIND_NEXT_KEY` / `FIND_PREV_KEY` for titles). |
| `frontend/e2e/search.spec.ts` | Create | UI tests. |
| `docs/DESIGN.md` | Modify | Editor paragraph and the keys table. |

## Shared shapes

Tasks 1 to 4 must agree on these exactly:

```ts
// searchCount.ts
export interface MatchCount { total: number; current: number | null; capped: boolean } // current is 1-based
export function countMatches(state: EditorState, query: SearchQuery, cap = 1000): MatchCount;
export function countLabel(query: SearchQuery, count: MatchCount): string; // "" | "No results" | "1 match" | "12 matches" | "3 of 12" | "1000+ matches" | "3 of 1000+"

// goToLine.ts
export function goToLineTarget(state: EditorState, input: string): number | null; // a document position, or null when input does not parse

// panels.ts
export type PanelKind = "find" | "goto";
export interface PanelHost { kind: PanelKind; dom: HTMLElement; view: EditorView; focus: boolean }
export interface PanelSnapshot { find: PanelHost | null; goto: PanelHost | null; rev: number }
export function subscribePanels(listener: () => void): () => void;
export function panelSnapshot(): PanelSnapshot; // the same object until something changes
```

---

### Task 1: Match counting

**Files:**
- Create: `frontend/src/editor/searchCount.ts`
- Test: `frontend/src/editor/searchCount.test.ts`

- [x] **Step 1: Write the failing tests**
  Build states with `EditorState.create({ doc, selection })` and queries
  with `new SearchQuery({...})`. Cover these cases:
  - three matches with the selection on none: `{ total: 3, current: null }`, label "3 matches"
  - selection exactly on the second match: `current: 2`, label "2 of 3"
  - one match: "1 match"
  - a non-empty query with no match: "No results"
  - an empty query: `""`
  - an invalid regexp (`new SearchQuery({ search: "(", regexp: true })`): `{ total: 0, current: null, capped: false }`, label `""`
  - `cap = 2` over three matches: `capped: true`, label "2+ matches", and "1 of 2+" when the selection is on the first
  - case sensitivity and whole word respected (they come from `getCursor`, so one case each is enough)
- [x] **Step 2: Run them and see them fail**
  Run: `npm --prefix frontend test -- searchCount`
  Expected: FAIL (module not found).
- [x] **Step 3: Implement**
  `countMatches`: return the empty count when `!query.valid || query.search === ""`. Otherwise iterate `query.getCursor(state)`, stopping after `cap` matches (`capped` is true if a match past the cap exists). `current` is the 1-based index of the match whose `from`/`to` equal `state.selection.main`'s. `countLabel` formats as in the Design section, writing the cap as `${cap}+`.
- [x] **Step 4: Run the tests**
  Run: `npm --prefix frontend test -- searchCount`
  Expected: PASS.
- [x] **Step 5: Commit**
  `git commit -m "Count search matches for the find panel"`

### Task 2: Go to line parser

**Files:**
- Create: `frontend/src/editor/goToLine.ts`
- Test: `frontend/src/editor/goToLine.test.ts`

- [x] **Step 1: Write the failing tests**
  A 10-line document, cursor on line 4. These inputs must give the same position as CodeMirror's `gotoLine`:
  - `"7"` → start of line 7
  - `"+2"` → line 6
  - `"-3"` → line 1
  - `"50%"` → line 5 (`Math.round(10 * 0.5)`)
  - `"+10%"` → line 5 (`round(10 * (0.1 + 4/10))`)
  - `"3:2"` → line 3, column 2
  - `":2"` → line 4, column 2
  - `"99"` → clamps to the last line
  - `"0"` → line 1
  - a column past the line's end clamps to the line's end
  - `""`, `"abc"`, `"1:2:3"` → `null`
  - surrounding spaces (`" 7 "`) parse: the input is trimmed, unlike stock, which is harmless
- [x] **Step 2: Run them and see them fail**
  Run: `npm --prefix frontend test -- goToLine`
  Expected: FAIL.
- [x] **Step 3: Implement**
  Port the body of `gotoLine` from `frontend/node_modules/@codemirror/search/dist/index.js` (lines 326–369), with the same regexp `/^([+-])?(\d+)?(:\d+)?(%)?$/` and the same arithmetic, returning the position instead of dispatching. Credit the source in a comment (MIT).
  Note that stock rejects an empty string only through the regexp (it matches `""`, then `ln` is undefined, which means the current line). Keep that for `":2"`, but return `null` for an input that is empty after trimming, so Enter on an empty field is an error and not a silent no-op.
- [x] **Step 4: Run the tests**
  Run: `npm --prefix frontend test -- goToLine`
  Expected: PASS.
- [x] **Step 5: Commit**
  `git commit -m "Parse go-to-line targets"`

### Task 3: Panel plumbing on the CodeMirror side

**Files:**
- Create: `frontend/src/editor/panels.ts`
- Modify: `frontend/src/editor/setup.ts`

This task leaves ⌘F opening an empty panel. Task 4 fills it, and the two
are committed together at the end of Task 4.

- [x] **Step 1: Store**
  A module-level `snapshot: PanelSnapshot`, a listener set, `subscribePanels`, `panelSnapshot`, and internal `setHost(kind, host | null)` / `bump()` that replace `snapshot` with a new object and notify. One `EditorView` exists for the app's life (`SqlEditor`), so one host per kind is enough.
- [x] **Step 2: Focus flag**
  A module `let focusNext = false`. `openFind` and `openGoToLine` set it before they dispatch, and clear it in a `finally`. Each `createPanel` reads it into `host.focus`.
- [x] **Step 3: Find panel**
  `function createFindPanel(view): Panel` makes `dom` (`div.cm-quel-panel.cm-search`), registers the host, and returns `{ dom, top: true, update(u) { if (u.docChanged || u.selectionSet || u.transactions.some(tr => tr.effects.some(e => e.is(setSearchQuery)))) bump() }, destroy() { if (snapshot.find?.dom === dom) setHost("find", null) } }`.
  Export `findExtension = search({ top: true, createPanel: createFindPanel })`.
- [x] **Step 4: Go to Line panel**
  `const toggleGoTo = StateEffect.define<boolean>()`, and `goToLineField = StateField.define<boolean>({ create: () => false, update: (v, tr) => last toggleGoTo value or v, provide: f => showPanel.from(f, on => on ? createGoToPanel : null) })`. `createGoToPanel` works like the find panel (`div.cm-quel-panel.cm-goto-line`, `top: true`, bump on selection or document changes, guarded destroy).
- [x] **Step 5: Commands**
  - `openFind(view)`: close Go to Line if it is open (`toggleGoTo.of(false)`). If the find panel is open and its `[main-field]` already has focus, `select()` it and return true: `openSearchPanel` does nothing in that case, and ⌘F should re-select. Otherwise set `focusNext` and `return openSearchPanel(view)`. That call seeds the query from the selection and focuses the field when the panel exists, and creates it when it does not.
  - `openGoToLine(view)`: if Go to Line is open, select `snapshot.goto.dom.querySelector("[main-field]")` and return true. Otherwise `closeSearchPanel(view)` (it moves focus to the editor if the panel had it), set `focusNext`, dispatch `toggleGoTo.of(true)`.
  - `closeGoToLine(view)`: if open, focus the view when the panel had focus, then dispatch `toggleGoTo.of(false)`.
  - `viaFind(cmd)` as in the Design section.
  - Export `panelKeymap` exactly as in the Design section.
- [x] **Step 6: Wire into setup.ts**
  Add `findExtension` and `goToLineField` to `newState`'s extensions. In the `keymap.of([...])` list, put `...panelKeymap` before `...searchKeymap.filter((b) => !["Mod-f", "Mod-Alt-g", "Mod-g", "F3"].includes(b.key ?? ""))`.
- [x] **Step 7: Type-check**
  Run: `npm --prefix frontend run build`
  Expected: success (it runs `tsc -b`). No commit yet.

### Task 4: The React panels

**Files:**
- Create: `frontend/src/editor/EditorPanels.tsx`, `frontend/src/editor/FindPanel.tsx`, `frontend/src/editor/GoToLinePanel.tsx`
- Modify: `frontend/src/editor/SqlEditor.tsx`, `frontend/src/components/keys.ts`

- [x] **Step 1: Key labels**
  In `keys.ts`, following the existing style: `FIND_KEY` (⌘F / Ctrl+F), `FIND_NEXT_KEY` (⌘G / Ctrl+G), `FIND_PREV_KEY` (⇧⌘G / Ctrl+Shift+G), `GO_TO_LINE_KEY` (⌥⌘G / Ctrl+Alt+G).
- [x] **Step 2: EditorPanels**
  `useSyncExternalStore(subscribePanels, panelSnapshot)`. Render `createPortal(<FindPanel host={s.find} rev={s.rev} />, s.find.dom)` when `s.find` is set, and the same for `goto`. Key each portal by the host's `dom` (a `WeakMap<HTMLElement, number>` id is fine), so a rebuilt panel remounts and runs its focus effect again.
- [x] **Step 3: FindPanel**
  - Read `state = host.view.state` and `query = getSearchQuery(state)`. Change the query through `host.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...query, search })) })`. Copy every field explicitly (`search`, `caseSensitive`, `literal`, `regexp`, `wholeWord`, `replace`), because `SearchQuery` is a class, not a plain spec.
  - Use `useMemo(() => countMatches(state, query), [state.doc, query, state.selection])` and `countLabel`.
  - Use `const [replaceOpen, setReplaceOpen] = useState(query.replace !== "")`.
  - The find input gets `main-field="true"`, `aria-label="Find"`, `placeholder="Find"` and `aria-invalid={!query.valid && query.search !== ""}`. It uses the editor font (`font-[family-name:var(--font-editor)]`) at `text-xs`, with the group `h-7`.
  - A `useLayoutEffect(() => { if (host.focus) findInput.current?.select() }, [])`.
  - `onKeyDown` on the panel root: `if (runScopeHandlers(host.view, e.nativeEvent, "search-panel")) e.preventDefault()`. Otherwise, Enter in the find field runs `findNext` (with Shift, `findPrevious`), and Enter in the replace field runs `replaceNext`.
  - Buttons call `findPrevious`, `findNext`, `replaceNext`, `replaceAll` and `closeSearchPanel` with `host.view`. A click may take focus, as it does in the stock panel; `closeSearchPanel` returns focus to the editor.
  - Hide the replace row and the chevron when `state.readOnly` (stock does the same; the app has no read-only editor today, so this is one condition).
  - Layout: one flex row `items-center gap-1 px-2 py-1.5`, with the find group about `w-72`, the count `min-w-20 text-xs text-muted-foreground tabular-nums`, then a `flex-1` spacer, then close. The replace row repeats the left inset with a chevron-sized spacer.
- [x] **Step 4: GoToLinePanel**
  - Local `const [text, setText] = useState(String(state.doc.lineAt(state.selection.main.head).number))` and `const [invalid, setInvalid] = useState(false)`.
  - The input gets `main-field="true"` and `aria-label="Go to line"`. A layout effect selects it when `host.focus` is set.
  - Enter runs `goToLineTarget(state, text)`. On `null`, `setInvalid(true)`. Otherwise dispatch `{ selection: EditorSelection.cursor(pos), effects: [toggle-off effect, EditorView.scrollIntoView(pos, { y: "center" })] }` and call `view.focus()`. Export a `goToLine(view, pos)` from `panels.ts` for this, so the effect stays private there.
  - Escape runs `closeGoToLine`. Anything else goes to `runScopeHandlers(view, e.nativeEvent, "goto-panel")`.
  - Show a muted hint "Line, +n, -n, n%, line:col" and a close button.
- [x] **Step 5: SqlEditor**
  Return `<><div ref={host} … /><EditorPanels /></>`.
- [x] **Step 6: Build and run the unit tests**
  Run: `npm --prefix frontend run build && npm --prefix frontend test && npm --prefix frontend run lint`
  Expected: all pass.
- [x] **Step 7: Look at it**
  Use `/run`. On Linux, run in server mode, isolated as AGENTS.md requires:
  `QUEL_SECRETS=memory QUEL_DATA_DIR="$(mktemp -d)" QUEL_UPDATES=off CGO_ENABLED=0 GOFLAGS=-tags=server lgx run`.
  Never point it at the real data directory. Check ⌘F, typing, the count, replace folding, ⌘⌥G, a tab switch with the panel open (it stays open, the caret stays in the editor), and both themes. Check the browser console for React warnings.
- [x] **Step 8: Commit**
  `git commit -m "Find and Go to Line panels from the app's controls"`

### Task 5: Theme the panels and the match highlights

**Files:**
- Modify: `frontend/src/editor/setup.ts` (the `chrome` theme), `frontend/src/index.css`

- [x] **Step 1: Tokens**
  In `index.css`, next to `--sql-keyword` in both the light block (around line 180) and the `.dark` block (around line 186), add `--search-match` and `--search-match-current`. Start with a warm amber, translucent so the text and the statement block show through. Light: `oklch(0.88 0.12 90 / 0.55)` and `oklch(0.78 0.15 65 / 0.6)`. Dark: `oklch(0.6 0.12 85 / 0.4)` and `oklch(0.68 0.15 60 / 0.55)`. Adjust by eye.
- [x] **Step 2: Chrome rules**
  - `.cm-panels`: `backgroundColor: var(--background)`, `color: var(--foreground)`.
  - `.cm-panels.cm-panels-top`: `borderBottom: 1px solid var(--border)`.
  - `.cm-panel.cm-search`: `padding: 0` (our component pads itself), and `fontFamily: var(--font-sans)`.
  - `.cm-searchMatch`: `backgroundColor: var(--search-match)`, `borderRadius: 2px`.
  - `.cm-searchMatch-selected`: `backgroundColor: var(--search-match-current)`.
  - `.cm-selectionMatch`: `backgroundColor: color-mix(in oklab, var(--muted-foreground) 18%, transparent)`.
  - `.cm-searchMatch .cm-selectionMatch`: `backgroundColor: transparent`.

  These go in `chrome` (an `EditorView.theme`), which outranks the base theme, as the existing comment in `setup.ts` says.
- [x] **Step 3: Look at it in light and dark**
  Use `/run` with the isolated command from Task 4, Step 7. Matches must read on top of `.cm-currentStatement` and the selection colour.
- [x] **Step 4: Commit**
  `git commit -m "Theme editor panels and search matches from app tokens"`

### Task 6: UI tests

**Files:**
- Create: `frontend/e2e/search.spec.ts`

- [x] **Step 1: Write the spec**
  Follow `frontend/e2e/editor.spec.ts`: `connectFixture(page, db)`, and its `write` helper (copy it). Tests:
  1. ⌘F (`ControlOrMeta+f`) shows `getByLabel("Find")` focused. The panel is in `.cm-panels-top`.
  2. In `select 1;\nselect 2;\nselect 3;`, typing `select` shows "3 matches"; Enter shows "1 of 3"; Shift+Enter wraps to "3 of 3"; typing `zzz` shows "No results".
  3. Clicking "Toggle replace" shows `getByLabel("Replace", { exact: true })`. Fill `SELECT`, click "Replace all", and the editor text has no lowercase `select`.
  4. Escape hides the panel and the editor has focus (`expect(editor(page)).toBeFocused()`).
  5. ⌘⌥G (`ControlOrMeta+Alt+g`) shows "Go to line" focused. Fill `2`, press Enter, then type `x`: the editor text has `x` at the start of line 2.
  6. ⌘F, then ⌘⌥G: the Find field is gone and Go to line is shown. Then ⌘F again: the other way round.
  7. The Close button's bounding box does not intersect the Run button's.
  8. A regexp toggle with `(` sets `aria-invalid="true"` on the Find field.
  9. Tab switch: with Find open on tab A and `select` typed, open a new tab (the "New tab" button, as `tabs.spec.ts:33` does), then press ⌘1 (`ControlOrMeta+1`) to go back. Find the tabs with `tabs.spec.ts`'s `editorTabs` locator. The panel is still there with `select` in the field, and the editor has focus, not the field.
  10. ⌘F while the Find field already has focus keeps it focused and selects its text.
  11. With nothing searched yet and Go to Line open, ⌘G (`ControlOrMeta+g`) closes Go to Line and shows the Find field, focused.
- [x] **Step 2: Run it**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server bash scripts/e2e.sh search.spec.ts`
  Expected: PASS.
- [x] **Step 3: Run the whole e2e suite**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e`
  Expected: all specs pass. `editor.spec.ts` should be unaffected.
- [x] **Step 4: Commit**
  `git commit -m "e2e: find and go to line panels"`

### Task 7: Docs

**Files:**
- Modify: `docs/DESIGN.md`

- [x] **Step 1: Editor paragraph**
  After the paragraph ending "becomes Stop (`Cmd+.`) after 300ms of a run." (around line 238), add a short paragraph covering:
  - Find and Go to Line are CodeMirror panels docked at the top, drawn by React through portals (`editor/panels.ts`).
  - Only one is open at a time.
  - Each tab keeps its own query.
  - The top placement keeps them clear of the Run button.
- [x] **Step 2: Keys table**
  In "Palettes and keys" (around line 735), add ⌘F / Ctrl+F (find and replace in the editor), ⌘G / ⇧⌘G (next / previous match), and ⌥⌘G / Ctrl+Alt+G (go to line).
- [x] **Step 3: Commit**
  `git commit -m "Design: editor find and go to line panels"`

## Completion summary

Implemented as planned. Find and Go to Line are CodeMirror panels docked
at the top of the editor, with React controls portalled in from
`SqlEditor`. The match count, the go-to-line parser, the theme tokens, 10
Playwright specs and the DESIGN.md notes are all in. Verified with 567
frontend tests, 198 backend tests, lint, the full e2e suite (50 passed, 1
Postgres-only skip), and light and dark screenshots of both panels from a
throwaway Playwright spec. No React warnings appeared in the console.

Codex reviewed every task. Its one finding was that Enter on Go to Line's
Close button submitted the line instead of closing, fixed in `a24b19d`
with an e2e test. The other reviews were clean.

Deviations:
- Task 2: the tests and the parser were written together, so the "see it
  fail" step was skipped.
- Task 4: the button names keep the field names unambiguous: "Replace
  next" (the field is "Replace"), "Close find" and "Close go to line". The
  count is an `aria-live` span.
- Task 4: `useMemo` depends on `[state, query]` rather than
  `state.doc` / `state.selection`, to satisfy the hooks lint. It
  re-renders only on panel-store bumps anyway.
- Task 4, Step 7 and Task 5, Step 3: the visual check used Playwright
  screenshots in server mode, not `/run`. The app has no runtime dark mode
  (`docs/backlog/themes-setting.md`), so the dark tokens were checked by
  adding the `.dark` class by hand.
- Task 6: the "⌘F re-selects" case is folded into the first test. A test
  for Enter on Go to Line's Close button was added.

What the plan could have specified better: where Enter is handled. A
bubbling `onKeyDown` on the panel root also catches Enter on its buttons.
