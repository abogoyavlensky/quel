# Sidebar Toggle, Focus Result, and No Open Database Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⌘B and a button hide and show the left sidebar, and remember the
choice; ⌘R puts focus in the active result grid; File > Open Database and
its ⌘O key go away.

**Tech Stack:** React + TypeScript, zustand store, lucide icons, Vitest,
Playwright (server mode); let-go backend (`quel.workspace`, `quel.api`,
`quel.menu`) with clojure.test.

---

## Design

### What the user gets

| Key (macOS / other) | What it does |
|---|---|
| ⌘B / Ctrl+B | Hides or shows the left sidebar (connections and structure) |
| ⌘R / Ctrl+R | Puts focus in the active result's grid |
| ⌘O / Ctrl+O | Nothing any more (Open Database is gone) |

- **Sidebar button.** A `PanelLeft` toggle in the editor tab strip, just
  before the row details toggle (`PanelRight`) at the right end: history,
  sidebar, row details. It mirrors `RowDetailsToggle`: ghost `icon-sm`,
  `aria-label="Sidebar"`, `aria-pressed` while the sidebar shows,
  `title="Sidebar (⌘B)"`.
- **Command Palette.** "Hide Sidebar" / "Show Sidebar" (View group, with
  ⌘B) and "Focus Result" (Tabs group, after Focus Editor, with ⌘R). Hide,
  don't grey: each shows only when it can run.
- **No native menu items** for either key. Like ⌘I, the sidebar key is a
  toggle and cannot take the double delivery (native menu plus page) that
  Run tolerates (`App.tsx`, `useRowDetailsKey`). ⌘R could take it, but a
  menu item for it alone would be odd; it stays with ⌘E, which has none.

### The sidebar

The sidebar is rendered or not, the row details pattern
(`AppShell.tsx`): when hidden, its `ResizablePanel` and handle are left
out, and the panel ids keep the other panels' sizes. A collapsible panel
was rejected: it needs the panel's collapsed state and the store kept in
sync through `onResize`, for no gain.

What is lost on hide: only the structure tree's focused row and scroll
position. Its expanded nodes live in the store (`treeExpanded`).

**It always shows when the tab strip does not.** The button lives in the
tab strip, and the strip is there only while a workspace is loaded: not
with no connections ("Add a connection to start."), not on the Retry
screen of a failed tab load, and not while tabs load. In those states the
sidebar shows whatever the saved choice, and ⌘B, the button and the
palette entry do nothing (the button and entry are not there at all). The
saved choice is left alone and applies again once a workspace loads.

```ts
// state/layout.ts — shared by AppShell, commands.ts and the tests
export const hasTabStrip = (s: AppState) => {
  const w = selectedWorkspace(s);
  return w !== undefined && !w.loadError;
};
export const sidebarShown = (s: AppState) => s.sidebarHidden !== true || !hasTabStrip(s);
```

`hasTabStrip` is exactly AppShell's condition for drawing the editor
(`workspace && tab`: a workspace always has a tab).

**Remembered across restarts** in the app database's `settings` table,
key `sidebar-hidden`, next to `selected-profile`: the row is there
(value `"true"`) while hidden, and deleted when shown. Two bridge
handlers, `sidebar-hidden` (→ boolean) and `set-sidebar-hidden`
(boolean), in the style of `selected-profile` / `select-profile`.

**Start-up.** The store's `sidebarHidden` starts `null` (not loaded yet),
which shows the sidebar. `loadSidebar()` runs next to `loadProfiles()` in
`App.tsx` and sets it only if it is still `null`, so a toggle made before
the answer arrives wins (the `restoreSelection` rule). A failed read
leaves the sidebar shown. A hidden sidebar may show for a moment at
start-up; the read is a local SQLite query, so this is not worth
blocking the first render on.

**Toggling** (`toggleSidebar()`): does nothing unless `hasTabStrip`.
Flips the effective state, writes it to the store at once, and saves it
in the background; a failed save is swallowed (the panel still toggles;
next start shows the old choice). If focus is inside the sidebar when it
hides (the tree, a connection row), focus moves to the editor instead of
falling to `<body>`. The sidebar's root element carries
`data-quel-sidebar` for that check.

### ⌘R: Focus Result

`focusResultKey()` in `state/palette.ts`, next to `focusEditorKey()`:

- Does nothing while a dialog or palette is open (`loadedWorkspace()`
  returns nothing then), or when the active editor tab shows Messages
  (`tab.active === MESSAGES`), or when no result has that id.
- Otherwise focuses the grid element: `ResultGrid`'s scroller gets
  `data-result-grid`, and the key focuses
  `document.querySelector<HTMLElement>("[data-result-grid]")`. Only the
  active result's grid is mounted (`ResultTabs.tsx`), so there is at most
  one.
- It does not change the selected row: ↓ with nothing selected already
  picks the first (`ResultGrid.tsx` `onKeyDown`). The flow is ⌘↵ run, ⌘R
  into the grid, arrows, ⌘I for details, ⌘E back.
- Running a query still leaves focus in the editor.

The palette's "Focus Result" shows only when the key would do something
(a loaded workspace whose active tab's `active` names one of its
results). Its `run` focuses on the next tick (`setTimeout`), as Focus
Editor does, so it is not a `keepsFocus` entry.

⌘R does not reload the macOS app (checked by hand by the user). In a
browser (server mode), the capture-phase listener's `preventDefault`
stops the reload; the e2e test checks that.

### Keys

`shortcutOf` (`state/shortcuts.ts`) gains two kinds, matched like ⌘E
(platform modifier, no Shift, no Alt), so `useGlobalKeys` in `App.tsx`
handles them on its one capture-phase listener:

```ts
| { kind: "sidebar" } // ⌘B
| { kind: "result" }  // ⌘R
```

Neither collides with CodeMirror: its only `b` binding is the macOS
`Ctrl-b` (cursor left, emacs style), and nothing binds `Mod-r`.

`toggleSidebarKey()` in `palette.ts` applies the dialog guard
(`modalOpen`) and calls `toggleSidebar()`.

### Open Database goes

The File menu's Open Database… (⌘O), its `menu:open-db` event, the
Command Palette's entry and the profile dialog's `path` (the pre-filled
file) are removed. A SQLite connection is made with New Connection; to
keep the one convenience Open Database had, **Browse… fills an empty Name
from the file name** (`archive.db` → `archive`), with the logic that
`fileForm` has today, renamed to `nameFromPath(path): string`.

Kept: the `open-db` bridge handler (the smoke test opens bare paths and
URLs with it, `scripts/smoke.sh`), and `choose-file`. `db-filters` moves
from `quel.menu` to `quel.api`, its last user. ⌘O is left unbound.

### Testing

- Backend: the `sidebar-hidden` setting round-trips; the handler set in
  `api_test.lg` gains the two names; `menu_test.lg` loses Open Database.
- Vitest: `shortcutOf` (⌘B, ⌘R, Ctrl on other platforms, Shift and Alt
  refused); `state/layout.ts` (shown/hidden rules, the start-up race, the
  no-op without a tab strip, the save call); `focusResultKey` (Messages,
  no result, under a dialog); `commands.ts` (the new entries' visibility,
  titles and focus kind; open-database gone); `nameFromPath`.
- Playwright `e2e/sidebar.spec.ts` (server mode, so Ctrl): ⌘B and the
  button hide and show the sidebar; the choice survives a reload; ⌘R
  focuses the grid and does not reload the page; ⌘R on Messages does
  nothing. Specs share one app run and its settings, so an `afterEach`
  shows the sidebar again if a test left it hidden.

## File Structure

| File | Change |
|---|---|
| `src/quel/menu.lg` | Remove `open-db!`, its File item, `db-filters` |
| `src/quel/api.lg` | `db-filters` moves here; handlers `sidebar-hidden`, `set-sidebar-hidden` |
| `src/quel/workspace.lg` | `sidebar-hidden`, `set-sidebar-hidden!` on the `settings` table |
| `test/quel/menu_test.lg` | 10 clicks, no "Open Database…" |
| `test/quel/api_test.lg` | Handler set gains the two names |
| `test/quel/workspace_test.lg` | Round trip of the setting |
| `frontend/src/lib/api.ts` | `sidebarHidden()`, `setSidebarHidden(hidden)` |
| `frontend/src/state/store.ts` | `sidebarHidden: boolean \| null`; `ProfileDialog` loses `path` |
| `frontend/src/state/layout.ts` | Create: `hasTabStrip`, `sidebarShown`, `loadSidebar`, `toggleSidebar` |
| `frontend/src/state/layout.test.ts` | Create |
| `frontend/src/state/shortcuts.ts` (+ test) | `sidebar` and `result` kinds |
| `frontend/src/state/palette.ts` (+ test) | `toggleSidebarKey`, `focusResultKey` |
| `frontend/src/state/commands.ts` (+ test) | Sidebar and Focus Result entries; Open Database gone |
| `frontend/src/state/profileForm.ts` (+ test) | `fileForm` → `nameFromPath` |
| `frontend/src/components/keys.ts` | `SIDEBAR_KEY`, `RESULT_KEY`; `OPEN_DB_KEY` gone |
| `frontend/src/components/AppShell.tsx` | Sidebar rendered only while `sidebarShown` |
| `frontend/src/components/EditorTabs.tsx` | `SidebarToggle` before `RowDetailsToggle` |
| `frontend/src/components/ProfileDialog.tsx` | No `path` prop; Browse fills an empty name |
| `frontend/src/components/ConnectionsPanel.tsx` | Comment: no File > Open Database |
| `frontend/src/grid/ResultGrid.tsx` | `data-result-grid` on the scroller |
| `frontend/src/App.tsx` | No `menu:open-db`; `loadSidebar()` at start; the two keys in `useGlobalKeys` |
| `frontend/e2e/sidebar.spec.ts` | Create |
| `docs/DESIGN.md` | Keys table, a sidebar paragraph, the Open Database line |

## Tasks

### Task 1: Remove Open Database

**Files:**
- Modify: `src/quel/menu.lg`, `src/quel/api.lg`, `test/quel/menu_test.lg`
- Modify: `frontend/src/App.tsx`, `frontend/src/state/commands.ts`, `frontend/src/state/commands.test.ts`, `frontend/src/components/keys.ts`, `frontend/src/state/store.ts`, `frontend/src/components/ProfileDialog.tsx`, `frontend/src/state/profileForm.ts`, `frontend/src/state/profileForm.test.ts`, `frontend/src/components/ConnectionsPanel.tsx`, `docs/DESIGN.md`

- [ ] **Step 1: Backend.** In `menu.lg` delete `open-db!` and the "Open Database…" item; move `db-filters` (with its value unchanged) into `api.lg` above `choose-file`, use it there unqualified, and drop the `[quel.menu :as menu]` require from `api.lg` if nothing else in it uses `menu/`. Check that no other namespace refers to `menu/db-filters` (`grep -rn db-filters src test`). In `menu_test.lg`: `every-item-with-a-click-has-one` expects 10; remove `"Open Database…"` from `the-tab-and-query-items-are-there`.
- [ ] **Step 2: Frontend.** Remove the `menu:open-db` listener (`App.tsx`), the `open-database` command and the `chooseFile`/`OPEN_DB_KEY` imports (`commands.ts`), `OPEN_DB_KEY` (`keys.ts`). In `store.ts` the `new` dialog becomes `{ mode: "new" }` and its comment loses the Open Database clause. In `ProfileDialog.tsx` drop the `path` prop; the form starts from `editing ? fromProfile(editing) : emptyForm()`.
- [ ] **Step 3: Browse fills an empty name.** Rename `fileForm(path)` to `nameFromPath(path): string` in `profileForm.ts` (same rule: last path segment, `.db`/`.sqlite`/`.sqlite3` dropped case-insensitively, the whole path if that leaves nothing). In `onBrowse`, after a path is chosen: `set({ path, ...(form.name.trim() === "" ? { name: nameFromPath(path) } : {}) })`. Update `profileForm.test.ts` to test `nameFromPath` (the two existing cases, plus a Windows path `C:\data\x.sqlite` → `x`).
- [ ] **Step 4: Tests.** In `commands.test.ts`: drop `"open-database"` from `ALWAYS`, the full id list and the `movers` list; delete the "turns a chosen file into a new profile" test, and the `chooseFile` mock if nothing else uses it.
- [ ] **Step 5: Docs and comments.** `DESIGN.md:168`: "The UI connects only through profiles, made with New Connection (the sidebar's +, the File menu, the Command Palette). The `open-db` handler still opens a bare path or URL, for the smoke test." `ConnectionsPanel.tsx` header comment: drop "or from File > Open Database for a SQLite file".
- [ ] **Step 6: Verify.**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test` (or plain `lgx test` where GTK is present) — Expected: all pass.
  Run: `npm --prefix frontend test && npm --prefix frontend run lint && (cd frontend && npx tsc -b)` — Expected: all pass, no type errors.
  Run: `grep -rn "Open Database\|open-database\|OPEN_DB\|menu:open-db\|fileForm" src test frontend/src frontend/e2e docs/DESIGN.md` — Expected: no hits.
- [ ] **Step 7: Commit** `Remove Open Database; Browse names a new SQLite connection`.

### Task 2: Backend: the sidebar setting

**Files:**
- Modify: `src/quel/workspace.lg`, `src/quel/api.lg`
- Test: `test/quel/workspace_test.lg`, `test/quel/api_test.lg`

- [ ] **Step 1: Write the failing test.** In `workspace_test.lg`, `the-sidebar-setting-round-trips` (with `with-store`): starts `false`; `(set-sidebar-hidden! db true)` → `true`; setting `true` twice is fine; `false` → `false` and the `settings` row is gone. In `api_test.lg` add `"sidebar-hidden" "set-sidebar-hidden"` to the handler set.
- [ ] **Step 2: Run to see it fail.** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test` — Expected: the new tests fail.
- [ ] **Step 3: Implement.** In `workspace.lg`, after `select-profile!`: `(sidebar-hidden db)` → `true` when a `settings` row with key `'sidebar-hidden'` exists, else `false`; `(set-sidebar-hidden! db hidden?)` upserts `('sidebar-hidden', 'true')` when truthy, deletes the row otherwise, returns `nil`. Extend the namespace comment that names the settings table ("the selected profile" → "the selected profile and whether the sidebar is hidden"). In `api.lg`: `(defn sidebar-hidden [{:keys [store]}] (workspace/sidebar-hidden store))` and `(defn set-sidebar-hidden [{:keys [store]} hidden?] (workspace/set-sidebar-hidden! store (true? hidden?)))`, registered by var as `"sidebar-hidden"` and `"set-sidebar-hidden"` next to the selection handlers.
- [ ] **Step 4: Run tests.** Same command — Expected: all pass.
- [ ] **Step 5: Commit** `Backend: remember whether the sidebar is hidden`.

### Task 3: Frontend sidebar state

**Files:**
- Modify: `frontend/src/lib/api.ts`, `frontend/src/state/store.ts`
- Create: `frontend/src/state/layout.ts`, `frontend/src/state/layout.test.ts`

- [ ] **Step 1: API and store.** `api.ts`: `sidebarHidden = async () => (await call<unknown>("sidebar-hidden")) === true` and `setSidebarHidden = (hidden: boolean) => call<void>("set-sidebar-hidden", hidden)`. `store.ts`: `sidebarHidden: boolean | null` in `AppState` with the comment "the user hid the sidebar (saved in the app database); null until read at start-up, which shows it", initial `null`.
- [ ] **Step 2: Write the failing tests** in `layout.test.ts` (mock `@/lib/api` as the other state tests do):
  - `sidebarShown`: `null` and `false` show; `true` hides when a loaded workspace is selected; `true` still shows with no selection, with a `loadError` workspace, and with a selected profile whose workspace is not in the store yet.
  - `loadSidebar`: applies `true` from the API; does not overwrite a value already set (a toggle came first); a rejected read leaves `null`.
  - `toggleSidebar`: with a loaded workspace, `null` → `true` and saves `true`; `true` → `false` and saves `false`; without a tab strip, changes nothing and saves nothing; a rejected save does not throw and keeps the new state.
- [ ] **Step 3: Run to see them fail.** `npm --prefix frontend test -- layout` — Expected: FAIL (module missing).
- [ ] **Step 4: Implement `layout.ts`** with `hasTabStrip` and `sidebarShown` as in the Design, plus:
  - `loadSidebar(): Promise<void>` — reads `api.sidebarHidden()`; on success sets `sidebarHidden` only if it is still `null`; on failure does nothing.
  - `toggleSidebar(): void` — returns unless `hasTabStrip(state)`; `hidden = sidebarShown(state)`; sets `sidebarHidden: hidden`; `void api.setSidebarHidden(hidden).catch(() => {})`; if `hidden` and `document.activeElement?.closest("[data-quel-sidebar]")`, `setTimeout(focusEditor)`. Vitest runs without a DOM: the tests stub `document` with `vi.stubGlobal("document", { activeElement: … })`, as `palette.test.ts` does, and a test covers the focus move (an `activeElement` whose `closest` returns an element → `focusEditor` is called after the timer).
  Header comment: what the module owns (the sidebar's visibility) and the "always shown without a tab strip" rule.
- [ ] **Step 5: Run tests.** `npm --prefix frontend test` — Expected: all pass.
- [ ] **Step 6: Commit** `Sidebar visibility state, saved in the app database`.

### Task 4: Sidebar UI, key and palette entry

**Files:**
- Modify: `frontend/src/components/keys.ts`, `frontend/src/state/shortcuts.ts`, `frontend/src/state/shortcuts.test.ts`, `frontend/src/state/palette.ts`, `frontend/src/state/palette.test.ts`, `frontend/src/state/commands.ts`, `frontend/src/state/commands.test.ts`, `frontend/src/components/AppShell.tsx`, `frontend/src/components/EditorTabs.tsx`, `frontend/src/App.tsx`

- [ ] **Step 1: Write the failing tests.**
  - `shortcuts.test.ts`: ⌘B → `{ kind: "sidebar" }`, Ctrl+B on other platforms; ⇧⌘B and ⌥⌘B → `null`.
  - `palette.test.ts`: `toggleSidebarKey()` toggles with a loaded workspace and does nothing while a palette or the profile dialog is open.
  - `commands.test.ts`: a `sidebar` entry (View group, keys `SIDEBAR_KEY`, `keepsFocus: true`) only with a loaded workspace; titled "Hide Sidebar" when shown and "Show Sidebar" when `sidebarHidden` is `true`; add it to the full id list and the `kept` list in table order (after `row-details`).
- [ ] **Step 2: Run to see them fail.** `npm --prefix frontend test` — Expected: the new cases fail.
- [ ] **Step 3: Implement.**
  - `keys.ts`: `SIDEBAR_KEY = isMac ? "⌘B" : "Ctrl+B"`.
  - `shortcuts.ts`: add the `sidebar` kind; match `key === "b"` after the Shift check; update the header comment.
  - `palette.ts`: `toggleSidebarKey()` — `if (!modalOpen(store.getState())) toggleSidebar()` (`toggleSidebar` already checks for the tab strip).
  - `commands.ts`: entry `{ id: "sidebar", group: "View", title: sidebarShown(s) ? "Hide Sidebar" : "Show Sidebar", keys: SIDEBAR_KEY, keepsFocus: true, run: toggleSidebar }`, added only when `loaded`, after `row-details`.
  - `App.tsx` `useGlobalKeys`: `k.kind === "sidebar"` → `toggleSidebarKey()`; update the comment above it.
  - `AppShell.tsx`: `const showSidebar = useApp(sidebarShown)`; render the sidebar `ResizablePanel` and the `ResizableHandle` after it only when `showSidebar`, keeping `id="sidebar"`; put `data-quel-sidebar` on the panel. Update the component comment.
  - `EditorTabs.tsx`: `SidebarToggle` modelled on `RowDetailsToggle` — `PanelLeft` icon, `aria-label="Sidebar"`, `aria-pressed={shown}`, `title={\`Sidebar (${SIDEBAR_KEY})\`}`, `onClick={toggleSidebar}`, the same pressed style — placed between `ClosedTabsMenu` and `RowDetailsToggle`.
- [ ] **Step 4: Load at start.** `App.tsx`: `void loadSidebar()` in the start-up effect, next to `loadProfiles().then(restoreSelection)` (not chained to it).
- [ ] **Step 5: Run tests and checks.** `npm --prefix frontend test && npm --prefix frontend run lint && (cd frontend && npx tsc -b)` — Expected: all pass.
- [ ] **Step 6: Commit** `⌘B and a tab-strip button hide and show the sidebar`.

### Task 5: ⌘R focuses the result

**Files:**
- Modify: `frontend/src/components/keys.ts`, `frontend/src/state/shortcuts.ts`, `frontend/src/state/shortcuts.test.ts`, `frontend/src/state/palette.ts`, `frontend/src/state/palette.test.ts`, `frontend/src/state/commands.ts`, `frontend/src/state/commands.test.ts`, `frontend/src/grid/ResultGrid.tsx`, `frontend/src/App.tsx`

- [ ] **Step 1: Write the failing tests.**
  - `shortcuts.test.ts`: ⌘R → `{ kind: "result" }`, Ctrl+R elsewhere; ⇧⌘R → `null`. Extend the "keys that are not ours" case so `k` is still `null`.
  - `palette.test.ts`: `focusResultKey()` focuses an element with `data-result-grid` when the active tab's `active` is a result id; does nothing when it is `MESSAGES`, when no result has that id, and while a dialog is open. There is no DOM in Vitest: stub `document` with `vi.stubGlobal("document", { querySelector: () => grid })`, where `grid = { focus: vi.fn() }`, as the `restoreFocus` tests stub `activeElement`.
  - `commands.test.ts`: `focus-result` (Tabs group, keys `RESULT_KEY`, not `keepsFocus`) after `focus-editor`, shown only when the active tab shows a result; add it to the id and `movers` lists where a result exists in the fixture, or add a fixture with one.
- [ ] **Step 2: Run to see them fail.** `npm --prefix frontend test` — Expected: the new cases fail.
- [ ] **Step 3: Implement.**
  - `keys.ts`: `RESULT_KEY = isMac ? "⌘R" : "Ctrl+R"`.
  - `shortcuts.ts`: `result` kind on `key === "r"` (no Shift).
  - `ResultGrid.tsx`: `data-result-grid` on the `role="grid"` scroller.
  - `palette.ts`: `focusResult()` (no guard: focuses `document.querySelector<HTMLElement>("[data-result-grid]")` if present) and `focusResultKey()` — `loadedWorkspace()`, then `activeTabOf(w)`; return if `tab.active === MESSAGES` or `!tab.results.some((r) => r.id === tab.active)`; else `focusResult()`.
  - `commands.ts`: `{ id: "focus-result", group: "Tabs", title: "Focus Result", keys: RESULT_KEY, run: () => void setTimeout(focusResult) }`, after `focus-editor`, when `loaded` and the active tab shows a result.
  - `App.tsx` `useGlobalKeys`: `k.kind === "result"` → `focusResultKey()`; the comment lists ⌘B and ⌘R.
- [ ] **Step 4: Run tests and checks.** `npm --prefix frontend test && npm --prefix frontend run lint && (cd frontend && npx tsc -b)` — Expected: all pass.
- [ ] **Step 5: Commit** `⌘R puts focus in the result grid`.

### Task 6: End-to-end test

**Files:**
- Create: `frontend/e2e/sidebar.spec.ts`

- [ ] **Step 1: Write the spec** (server mode, `ControlOrMeta`; helpers from `./connect`, a profile named with `Date.now()` as `palette.spec.ts` does):
  - `test.afterEach`: if the "Sidebar" button exists with `aria-pressed="false"`, click it — specs share one app run and its settings, and later specs click sidebar rows.
  - **Sidebar:** select and connect a profile; the "Saved connections" list is visible and the "Sidebar" button is pressed. `ControlOrMeta+b` hides the list (count 0) and unpresses the button. The save runs in the background, so wait for it before reloading: start `page.waitForResponse((r) => r.url().endsWith("/wails/runtime") && (r.request().postData() ?? "").includes('"set-sidebar-hidden"'))` before the key press and await it after (the pattern in `updates.spec.ts`). Reload the page, wait for the editor, the list is still hidden; click the button, the list shows (wait for its save the same way); `ControlOrMeta+b` twice ends shown.
  - **Focus leaves a hidden sidebar:** focus a connection row (`profileRow(page, name).focus()`), press `ControlOrMeta+b`: the editor is focused. Show the sidebar again.
  - **Focus Result:** run `select 1 as a` (fill the editor, `ControlOrMeta+Enter`); set `window.__noReload = true` with `page.evaluate`; `ControlOrMeta+r` → the grid (`getByRole("grid", { name: "Result" })`) is focused, and `window.__noReload` is still `true` (no reload); `ArrowDown` selects the first row (as `row-details.spec.ts` checks selection); `ControlOrMeta+e` returns to the editor. Select the Messages result tab, focus the editor, press `ControlOrMeta+r`: the editor keeps focus.
- [ ] **Step 2: Run.** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e` (or plain `lgx e2e`) — Expected: all specs pass, the new one included. If Chromium reloads on Ctrl+R despite `preventDefault`, stop and report: the key choice needs revisiting for server mode.
- [ ] **Step 3: Commit** `e2e: sidebar toggle and Focus Result`.

### Task 7: Design doc

**Files:**
- Modify: `docs/DESIGN.md`

- [ ] **Step 1: Update** the "Palettes and keys" table with ⌘B and ⌘R rows; in its **Keys** paragraph, name the two new keys among those `shortcutOf` matches and say neither has a native menu item (⌘B is a toggle, like ⌘I). Next to "The right-hand column is the row details panel…" add a paragraph on the sidebar: hidden or shown, never collapsed; the tab-strip button; always shown without a tab strip; saved in `settings` as `sidebar-hidden`. In **Dialog guards**, add ⌘B and ⌘R to the keys that do nothing under a dialog.
- [ ] **Step 2: Commit** `Design: sidebar toggle and Focus Result`.

### Task 8: Final verification

- [ ] **Step 1:** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test` — Expected: all pass.
- [ ] **Step 2:** `npm --prefix frontend test && npm --prefix frontend run lint && (cd frontend && npx tsc -b)` — Expected: all pass.
- [ ] **Step 3:** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx smoke` — Expected: passes (`open-db` still there).
- [ ] **Step 4:** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e` — Expected: all specs pass.
- [ ] **Step 5:** Hand-check on a Mac (the user): ⌘B, the button and ⌘R in the app window; the File menu has no Open Database; ⌘O does nothing.
