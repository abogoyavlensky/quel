# Settings and Keymap Implementation Plan

**Status: completed** (2026-11-14, branch `settings-and-keymap`)

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One registry of every command and its keys (`state/keymap.ts`), which the Command Palette, the shortcut labels and the page's key listener all read; a Settings dialog (⌘, or the palette) whose one section lists every command and its shortcut, read-only; and a hint for the Command Palette in the empty results pane.

**Tech Stack:** React 19, zustand (`state/store.ts`), shadcn `Dialog`, Tailwind, Vitest, Playwright (server mode, `lgx e2e`). Frontend only: nothing in the backend changes, apart from a comment in `src/quel/menu.lg`.

---

## Design

### Why

Settings will grow: rebinding keys, an editor font size, themes
(`docs/backlog/themes-setting.md`). This round builds the frame and the
part the rest stands on. Today a shortcut is written in up to five places:
the native menu's accelerators (`src/quel/menu.lg`), the labels in
`components/keys.ts`, three `window` keydown listeners in `App.tsx`
(`useRowDetailsKey`, `useStopKey`, `useGlobalKeys` with
`state/shortcuts.ts`), CodeMirror keymaps (`editor/setup.ts`,
`editor/panels.ts`), and components' own `onKeyDown`. A read-only list of
shortcuts written by hand would be one more copy. Instead, one registry
lists every command, and the list, the palette, the labels and the page's
listener read it. Rebinding later edits the registry's keys and nothing
else has to learn about it.

Out of scope, each a backlog entry (Task 1): rebinding, an editor font
size, and a Quel > Settings… item in the macOS app menu (the wails shim
builds the app menu from its role and takes no items of ours). Zoom stays
in View and the palette; it is not a setting.

### The registry: `state/keymap.ts`

A pure module: types and data, no imports from the app beyond
`components/keys.ts` (also pure). Labels are needed in leaf components
(`editor/FindPanel.tsx`, `grid/GridFind.tsx`), and a registry that also
imported the runner would put those in import cycles. The behaviour is
attached by id elsewhere, and tests check that the ids line up:

- the palette's entries (`state/commands.ts`): when an entry can run, its
  title in the current state, and what it runs;
- the page's key actions (`state/pageKeys.ts`): what each key the page
  catches does.

```ts
export type Group = "Tabs" | "Query" | "Connection" | "View" | "Find" | "Help";
// Where a key is caught:
//   "page"  - the page's one capture-phase listener (App.tsx useKeys), which
//             runs the action in state/pageKeys.ts;
//   "menu"  - the native menu's accelerator (src/quel/menu.lg);
//   "local" - CodeMirror or a component's own onKeyDown; the registry only
//             labels it.
// A key may be caught in two places (Cancel: menu and page). That double
// delivery is only safe for actions that can run twice; see DESIGN.md.
export type Catcher = "page" | "menu" | "local";
export interface KeyEntry {
  id: string;
  group: Group;
  name: string;       // the Settings list's name; the palette may word it by state
  keys: { mac: string[]; other: string[] }; // per platform, e.g. "Cmd-Shift-p" / "Ctrl-Shift-p"; [] for none
  range?: boolean;    // keys form a run (⌘1–⌘8): labelled first–last
  caught: Catcher[];  // [] when there are no keys
}
export const KEYMAP = [ /* ... */ ] as const satisfies readonly KeyEntry[];
export type CommandId = (typeof KEYMAP)[number]["id"];
```

**Bindings** are written per platform, with the modifier that platform
actually uses: `keys.mac` for macOS, `keys.other` for Linux and Windows.
A binding is modifiers, then the key, joined by `-`, in CodeMirror's
style. The modifiers are written in the order `Cmd`, `Ctrl`, `Alt`,
`Shift`; `Cmd` is ⌘ and appears only in `keys.mac`. The key is a
lower-case letter, a digit, a named key (`Enter`, `PageUp`, `PageDown`)
or a punctuation character. Split with `binding.split(/-(?!$)/)`, so
`Cmd--` is Cmd plus `-`.

Today every entry is ⌘ on macOS and Ctrl elsewhere, so `other` is `mac`
with `Cmd` written as `Ctrl`. Both are written out in full anyway, with
no helper that derives one from the other. A platform can then differ
where it should: ⌃Tab on macOS, or a key Linux keeps for itself. And a
rebinding later only ever changes the current platform's list. The two
lists of a `range` must have the same length, and an entry has keys on
both platforms or on neither. A test checks both rules.

**Labels** (`formatKey(binding, mac)` in `components/keys.ts`):

- macOS: the symbols `⌃`, `⌥`, `⇧`, `⌘` in that order, then the key, with
  no separator. `Enter` shows as `↵`.
- Elsewhere: `Ctrl`, `Alt`, `Shift`, then the key, joined by `+`.
- Letters are upper-case. Other keys show as written.

These reproduce every constant in `keys.ts` exactly: `⇧⌘↵`,
`Ctrl+Shift+Enter`, `⌥⌘G`, `Ctrl+Alt+G`. A test pins them.
`keyLabel(id)` in `keymap.ts` gives an entry's label from the current
platform's list:

- the first key;
- for a `range`, the first and last joined by `–` (`⌘1–⌘8`, `Ctrl+1–Ctrl+8`);
- `undefined` with no keys.

**Matching** (`matchesKey(e, binding)` in `components/keys.ts`). The
binding is already the platform's, so `Cmd` is `metaKey` and `Ctrl` is
`ctrlKey`. Every one of the four modifiers must match exactly: present
when written, absent when not. On macOS, `Cmd-b` therefore rejects ⌃⌘B,
as `modKey` does today.

How the key matches depends on its kind:

- **Digits** match by `e.code` (`Digit1`), as `shortcutOf` does today:
  Shift or the layout changes `e.key`.
- **Letters** match by `e.key.toLowerCase()`.
- **Other keys** match by `e.key`.

This is the same behaviour as the three listeners it replaces. Each of
them already rejects extra modifiers: ⌘⇧B, ⌘⌥B and Ctrl+J on macOS do
nothing today, and still do nothing after this change.

`keyFor(e, mac)` in `keymap.ts` returns `{ id, index }` for the first
entry caught by `"page"` with a key in that platform's list that matches
the event, where `index` is the key's position in the list. It returns `null` when no
entry matches.

**The entries**, in this order (it is the Settings list's order).
Toggles are named "Toggle …", because the palette words them by state.

| id | group | name | keys | caught |
|---|---|---|---|---|
| new-tab | Tabs | New Tab | Cmd-t / Ctrl-t | menu |
| close-tab | Tabs | Close Tab | Cmd-w / Ctrl-w | menu |
| reopen-tab | Tabs | Reopen Closed Tab | Cmd-Shift-t / Ctrl-Shift-t | menu |
| go-to-tab | Tabs | Go to Tab 1–8 | Cmd-1 … Cmd-8 / Ctrl-1 … Ctrl-8 (range) | page |
| last-tab | Tabs | Go to Last Tab | Cmd-9 / Ctrl-9 | page |
| previous-tab | Tabs | Previous Tab | Cmd-PageUp / Ctrl-PageUp | page |
| next-tab | Tabs | Next Tab | Cmd-PageDown / Ctrl-PageDown | page |
| focus-editor | Tabs | Focus Editor | Cmd-e / Ctrl-e | page |
| focus-result | Tabs | Focus Result | Cmd-r / Ctrl-r | page |
| run | Query | Run | Cmd-Enter / Ctrl-Enter | menu, local |
| run-script | Query | Run Script | Cmd-Shift-Enter / Ctrl-Shift-Enter | menu, local |
| cancel | Query | Cancel | Cmd-. / Ctrl-. | menu, page |
| go-to-connection | Connection | Go to Connection… | Cmd-p / Ctrl-p | menu, page |
| connect | Connection | Connect | — | — |
| cancel-connect | Connection | Cancel Connecting | — | — |
| disconnect | Connection | Disconnect | — | — |
| new-connection | Connection | New Connection… | — | — |
| edit-connection | Connection | Edit Connection… | — | — |
| command-palette | View | Command Palette… | Cmd-Shift-p / Ctrl-Shift-p | menu, page |
| settings | View | Settings… | Cmd-, / Ctrl-, | page |
| row-details | View | Toggle Row Details | Cmd-i / Ctrl-i | page |
| sidebar | View | Toggle Sidebar | Cmd-b / Ctrl-b | page |
| results | View | Toggle Results | Cmd-j / Ctrl-j | page |
| zoom-in | View | Zoom In | Cmd-= / Ctrl-= | menu |
| zoom-out | View | Zoom Out | Cmd-- / Ctrl-- | menu |
| zoom-reset | View | Actual Size | Cmd-0 / Ctrl-0 | menu |
| find | Find | Find | Cmd-f / Ctrl-f | local |
| find-next | Find | Find Next | Cmd-g, F3 / Ctrl-g, F3 | local |
| find-previous | Find | Find Previous | Cmd-Shift-g, Shift-F3 / Ctrl-Shift-g, Shift-F3 | local |
| go-to-line | Find | Go to Line… | Cmd-Alt-g / Ctrl-Alt-g | local |
| check-updates | Help | Check for Updates… | — | — |

F3 and Shift-F3 are second keys, so the label shows only the first. The
editor binds them (`editor/panels.ts`) and the grid's find does not, as
today. An entry's label is its first key; Settings shows the same.

Not listed: CodeMirror's editing keys (undo, comment, indent) and
navigation inside the grid and the tree. They are editing and moving, not
app commands, and they would bury the list. They can join when rebinding
needs them.

**The native menu stays as it is**, accelerators included. Its
accelerators repeat the `"menu"` keys, so a frontend test reads
`src/quel/menu.lg` and checks that both sides have the same set. The test
turns `CmdOrCtrl+Shift+T` into `Cmd-Shift-t` for macOS and
`Ctrl-Shift-t` for the others, and checks each platform. Rebinding (backlog) will
decide who owns the keys. The likely answer is that the page owns them all
and the menu drops its accelerators. Then no key is caught twice, and this
test goes away.

### The palette: `state/commands.ts`

`commands(s)` keeps its shape and its tests: the same entries, conditions,
titles and `keepsFocus`. Two things change:

- The `keys` field goes from each `add({...})`. `add` fills it with
  `keyLabel(c.id)`.
- `Command.id` becomes a `CommandId`, so a typo fails to compile.

The palette also gets a new entry: `{ id: "settings", group: "View",
title: "Settings…", run: openSettings }`. It is always there and not
`keepsFocus`, because it moves focus into the dialog. The palette's groups
stay its own: `Find` has no palette entries, so it never shows there.

### The page's keys: `state/pageKeys.ts`

```ts
export const PAGE_KEYS: Record<string, (index: number) => void> = { ... };
export function onPageKey(e: KeyboardEvent): void; // keyFor → preventDefault, stopPropagation, act
```

Actions, the same calls the old listeners make:

| id | action |
|---|---|
| go-to-tab | `focusTabKey(index + 1)` |
| last-tab | `focusTabKey(9)` |
| previous-tab / next-tab | `cycleTabsKey(-1)` / `cycleTabsKey(1)` |
| focus-editor / focus-result | `focusEditorKey` / `focusResultKey` |
| sidebar / results | `toggleSidebarKey` / `toggleResultsKey` |
| command-palette / go-to-connection | `openPalette("commands")` / `openPalette("connections")` |
| cancel | the selected tab's `cancel`, as `useStopKey` does (no dialog guard, as today) |
| row-details | `toggleRowDetails` (no dialog guard, as today) |
| settings | `openSettings` |

A test checks that `PAGE_KEYS` has exactly the ids of the entries caught
by `"page"`. In `App.tsx`, one hook `useKeys` adds `onPageKey` as a
capture-phase `window` listener. It replaces `useRowDetailsKey`,
`useStopKey` and `useGlobalKeys`. `state/shortcuts.ts` and its test go;
their cases move to `keymap.test.ts`.

### Labels

Every `*_KEY` constant goes from `components/keys.ts`. That file keeps
`isMac` and `modKey`, and gains `formatKey` and `matchesKey`. Each call
site uses `keyLabel(id)` instead:

| File | Constant | Replacement |
|---|---|---|
| `ResultTabs.tsx` | `RUN_KEY` | `keyLabel("run")` |
| `RunButton.tsx` | `RUN_KEY`, `SCRIPT_KEY`, `STOP_KEY` | `run`, `run-script`, `cancel` |
| `EditorTabs.tsx` | `SIDEBAR_KEY`, `RESULTS_PANE_KEY`, `ROW_KEY` | `sidebar`, `results`, `row-details` |
| `FindPanel.tsx`, `GridFind.tsx` | `FIND_NEXT_KEY`, `FIND_PREV_KEY` | `find-next`, `find-previous` |

`keyLabel` returns `string | undefined`. Every one of these ids has keys,
so a non-null assertion is fine there. Alternatively, an overload or a
`keyLabelOf` that throws on an id with no keys works too. Pick one and
keep it consistent.

### Settings

- **State.** `settingsOpen: boolean` in the store (initially `false`).
  `openSettings()` and `closeSettings()` go in a new `state/settings.ts`.
  - `openSettings` does nothing while `modalOpen(s)`: a palette, the
    profile, update or run-confirm dialog. The keys belong to an open
    dialog, as ⌘E's do. A pick from the palette closes the palette before
    it runs, so that path opens.
  - Opening remembers `document.activeElement`.
- **Guards.** `modalOpen` includes `settingsOpen`, so ⌘E, ⌘R, ⌘B, ⌘J and
  the tab keys do nothing under it. `openPalette` refuses while
  `settingsOpen`, as it does under the other dialogs.
- **Focus on close.** Restore the remembered element if it is still in
  the page and is not `document.body`. Otherwise focus the editor
  (`focusEditor`). This happens in the dialog's `onCloseAutoFocus`, after
  `preventDefault()`, the way `CommandPalette.tsx` does it. A Radix
  dialog would otherwise return focus only to a trigger, and this dialog
  has none.
- **`components/SettingsDialog.tsx`.**
  - A shadcn `Dialog` titled "Settings", wider than the default
    (`sm:max-w-lg`), mounted in `AppShell.tsx` next to `UpdateDialog`.
  - The body is a list of sections. Today the list holds one: a
    "Keyboard Shortcuts" heading over the registry, grouped by `Group`,
    with a group heading over each group's rows.
  - Each row shows the entry's `name` on the left and, on the right,
    `keyLabel(id)` in the palette's `CommandShortcut` style, or a muted
    `—` without keys.
  - The body scrolls (`max-h-[70vh] overflow-y-auto`).
  - No side navigation until there is a second section. The sections are
    an array in the component, so adding a nav later stays local.
  - Escape and the close button close it.
  - Rows are plain text, not buttons: nothing in them can be changed yet.

### The palette hint

Below the empty results pane's "Run the statement under the cursor with ⌘↵.
Its rows show here." (`ResultTabs.tsx:204`), a second line: "All commands:
⇧⌘P", with the label from `keyLabel("command-palette")`. The two lines are
two `<p>`s in one wrapper, so `editor.spec.ts`'s check of the first line
still holds. The not-connected state (`NotConnected`) is left as it is.

### Testing

- **`components/keys.test.ts`** (new): `formatKey` reproduces every
  removed constant on both platforms, and `matchesKey` covers modifiers,
  digits by code, letters by key, punctuation and `Cmd--`.
- **`state/keymap.test.ts`** (new):
  - every case from `shortcuts.test.ts`, now through `keyFor`;
  - ⌘. and ⌘I, which had no tests;
  - ⌘, opens settings;
  - ids are unique;
  - an entry has keys if and only if it has catchers;
  - `keyLabel` of a range and of an entry with no keys;
  - the drift check against `src/quel/menu.lg`.
- **`state/pageKeys.test.ts`** (new): `PAGE_KEYS` covers exactly the
  `"page"` entries.
- **`state/commands.test.ts`**:
  - add `"settings"` to `ALWAYS`;
  - every palette command's `keys` equals `keyLabel(id)`.
- **`state/settings.test.ts`** (new):
  - `openSettings` is refused under each dialog and the palette;
  - `modalOpen` counts settings;
  - `openPalette` is refused under settings.
- **`e2e/settings.spec.ts`** (new, server mode, so Ctrl):
  - Ctrl+, opens "Settings", which lists "Command Palette…" with
    `Ctrl+Shift+P` and "Go to Tab 1–8" with `Ctrl+1–Ctrl+8`;
  - Ctrl+B does nothing while it is open;
  - Escape closes it and the editor has focus again;
  - opened with focus on another element (the "New tab" button), it gives
    focus back to that element;
  - the palette's "Settings…" opens it too, and closing it then puts focus
    in the editor (the editor is the fallback here, since the palette
    leaves no element to return to);
  - the empty results pane shows "All commands: Ctrl+Shift+P".
- **Existing e2e** (`palette.spec.ts`, `sidebar.spec.ts`, the tab-cycling
  and row-details specs) must pass unchanged. They are the regression
  check for the listener swap.
- **Manual, on a Mac** (Task 9): ⌘, opens Settings in the app window.
  Nothing native claims the key: the app menu has no Settings item. ⌘.
  still cancels.

## File Structure

| File | Change |
|---|---|
| `docs/backlog/custom-keybindings.md` | Create: rebinding, and who owns the keys |
| `docs/backlog/editor-font-size.md` | Create |
| `docs/backlog/settings-in-app-menu.md` | Create: Quel > Settings… ⌘, needs the wails shim |
| `frontend/src/components/keys.ts` | Keep `isMac`, `modKey`; add `formatKey`, `matchesKey`; drop the `*_KEY` constants |
| `frontend/src/components/keys.test.ts` | Create |
| `frontend/src/state/keymap.ts` | Create: `KEYMAP`, `CommandId`, `keyLabel`, `keyFor` |
| `frontend/src/state/keymap.test.ts` | Create (absorbs `shortcuts.test.ts`) |
| `frontend/src/state/pageKeys.ts` | Create: `PAGE_KEYS`, `onPageKey` |
| `frontend/src/state/pageKeys.test.ts` | Create |
| `frontend/src/state/shortcuts.ts`, `shortcuts.test.ts` | Delete |
| `frontend/src/state/commands.ts`, `commands.test.ts` | Keys from the registry; `settings` entry |
| `frontend/src/state/settings.ts`, `settings.test.ts` | Create: open, close, focus |
| `frontend/src/state/store.ts` | `settingsOpen` |
| `frontend/src/state/palette.ts` | `modalOpen` and `openPalette` know settings |
| `frontend/src/App.tsx` | `useKeys` replaces three listeners |
| `frontend/src/components/SettingsDialog.tsx` | Create |
| `frontend/src/components/AppShell.tsx` | Mount `SettingsDialog` |
| `frontend/src/components/ResultTabs.tsx`, `RunButton.tsx`, `EditorTabs.tsx`, `editor/FindPanel.tsx`, `grid/GridFind.tsx` | `keyLabel(id)` |
| `frontend/e2e/settings.spec.ts` | Create |
| `src/quel/menu.lg` | Comment: accelerators mirror `state/keymap.ts`, checked by its test |
| `docs/DESIGN.md` | Registry, Settings, ⌘, row, hint |

Commands, from the repo root, unless a step says otherwise. On Linux
without a desktop, prefix the e2e task with
`CGO_ENABLED=1 GOFLAGS=-tags=server`.

- Unit tests: `npm --prefix frontend test`
- Types and build: `npm --prefix frontend run build`
- Lint: `npm --prefix frontend run lint`

---

### Task 1: Backlog entries

Each entry is its own commit (AGENTS.md). Each file starts with
`**Status: open**` and follows the existing entries' shape: a title, a
Problem section and a Fix section.

**Files:**
- Create: `docs/backlog/custom-keybindings.md`, `docs/backlog/editor-font-size.md`, `docs/backlog/settings-in-app-menu.md`

- [x] **Step 1: `custom-keybindings.md`, "Commands can't be rebound".**
  - **Problem:** Settings lists the shortcuts read-only.
  - **Fix:** record a shortcut on a row; Escape cancels and Backspace
    unbinds; Reset per row and Reset all. Store the overrides only, as a
    JSON `keybindings` row in `settings` holding the current platform's
    bindings, as the registry writes them (`Cmd-…` on macOS). When a
    key is already taken, offer to reassign it. Refuse ⌘Q, ⌘H, ⌘M and
    the Edit keys. Warn about keys CodeMirror binds. Require a modifier,
    except for F-keys.
  - **Who owns the keys:** the page should own every rebindable key and
    the native menu should drop those accelerators (option A). That ends
    double delivery, so the `menu.lg` drift test goes. Before choosing,
    check that WKWebView hands the page keys no menu item claims,
    including ⌘.. The alternative (B) is to rebuild the menu with the
    user's accelerators, which keeps double delivery.
  - Commit: `git commit -m "Backlog: rebinding commands"`

- [x] **Step 2: `editor-font-size.md`, "No editor font size setting".**
  - **Problem:** the editor's font size is fixed (`fontSize: "16px"` in
    `editor/setup.ts`). It multiplies with zoom.
  - **Fix:** a Settings control, 12–24px with 16 as the default, kept in
    `settings`, applied by reconfiguring the theme. The grid keeps the
    interface's size, because `ROW_H` is in pixels.
  - Commit: `git commit -m "Backlog: editor font size"`

- [x] **Step 3: `settings-in-app-menu.md`, "No Settings item in the macOS app menu".**
  - **Problem:** Settings opens by ⌘, and the palette only.
  - **Fix:** in letgo-packages' wails shim, map Wails' `ServicesMenu`,
    `Hide`, `HideOthers` and `UnHide` roles in `menuRoles`
    (`shim/menu.go`), or let `{:role :app-menu}` take extra items. Then
    Quel builds its app menu with "Settings…" `CmdOrCtrl+,`. It emits an
    event that opens Settings, which tolerates double delivery because
    opening sets state.
  - Commit: `git commit -m "Backlog: Settings in the app menu"`

### Task 2: Key formatting and matching

**Files:**
- Modify: `frontend/src/components/keys.ts`
- Create: `frontend/src/components/keys.test.ts`

- [x] **Step 1: Write the failing tests.**
  - `formatKey`, for each removed constant on both platforms:
    - `Cmd-Enter` gives `⌘↵`, and `Ctrl-Enter` gives `Ctrl+Enter`.
    - `Cmd-Shift-Enter` gives `⇧⌘↵`, and `Ctrl-Shift-Enter` gives `Ctrl+Shift+Enter`.
    - `Cmd-Alt-g` gives `⌥⌘G`, and `Ctrl-Alt-g` gives `Ctrl+Alt+G`.
    - `Cmd--` gives `⌘-`, and `Ctrl--` gives `Ctrl+-`.
    - `Ctrl-Tab` on macOS gives `⌃Tab`.
    - `=`, `0`, `.`, `Shift-t`, `PageUp` and `,` follow the same rules.
  - `matchesKey`:
    - `Cmd-b` needs Meta and rejects Meta with Ctrl; `Ctrl-b` needs Ctrl
      and rejects Ctrl with Meta.
    - Extra Shift or Alt fails.
    - `e.key` `"P"` with Shift matches `Cmd-Shift-p` and not `Cmd-p`.
    - Digits match by `code`: `key: "&", code: "Digit1"` matches `Cmd-1`.
    - `Cmd--` matches `e.key` `"-"`.
- [x] **Step 2: Run them and see them fail.** Run: `npm --prefix frontend test -- keys.test`. Expected: FAIL, because `formatKey` and `matchesKey` don't exist yet.
- [x] **Step 3: Implement** `formatKey` and `matchesKey` as the Design says. Split bindings with `/-(?!$)/`. Leave the `*_KEY` constants in place for now (Task 4 removes them).
- [x] **Step 4: Run them.** Expected: PASS.
- [x] **Step 5: Commit.** `git commit -m "Format and match platform-neutral key bindings"`

### Task 3: The registry

**Files:**
- Create: `frontend/src/state/keymap.ts`, `frontend/src/state/keymap.test.ts`

- [x] **Step 1: Write the failing tests.**
  - Port every case of `state/shortcuts.test.ts` to `keyFor`. Expect
    `{ id, index }` instead of a `Shortcut`; ⌘3, for example, gives
    `{ id: "go-to-tab", index: 2 }`.
  - Add ⌘. (cancel), ⌘I (row-details) and ⌘, (settings).
  - `keyFor` ignores entries that are not caught by `"page"`: ⌘T and
    ⌘Enter give `null`.
  - Ids are unique.
  - An entry has keys if and only if it has catchers. Its `mac` and
    `other` lists are both empty or both not, and are the same length.
  - No `keys.other` binding uses `Cmd`.
  - `keyLabel("go-to-tab")` is `⌘1–⌘8` on macOS. `keyLabel("connect")`
    is `undefined`. Give `keyLabel` an optional `mac` parameter that
    defaults to `isMac`, so the tests can run both platforms.
  - **The menu drift check:**
    - read `../../../src/quel/menu.lg` (path from the test file, via
      `node:fs` and `import.meta.url`);
    - collect every `:accelerator "..."`;
    - turn each into a macOS binding (`CmdOrCtrl` as `Cmd`) and an other
      one (`CmdOrCtrl` as `Ctrl`), with `+` as `-` and a letter key in
      lower case;
    - compare each set with the `keys.mac`, and the `keys.other`, of the
      entries caught by `"menu"`.
- [x] **Step 2: Run them and see them fail.** Run: `npm --prefix frontend test -- keymap.test`. Expected: FAIL, because the module doesn't exist yet.
- [x] **Step 3: Implement** `KEYMAP` (the Design's table, in its order), `CommandId`, `keyLabel` and `keyFor`. Write a header comment saying what the registry is, the three catchers, and that `menu.lg`'s accelerators mirror the `"menu"` keys, checked by the test.
- [x] **Step 4: Run them.** Expected: PASS.
- [x] **Step 5: Commit.** `git commit -m "Add the command and key registry"`

### Task 4: Palette and labels read the registry

**Files:**
- Modify: `frontend/src/state/commands.ts`, `frontend/src/state/commands.test.ts`, `frontend/src/components/keys.ts`, `ResultTabs.tsx`, `RunButton.tsx`, `EditorTabs.tsx`, `editor/FindPanel.tsx`, `grid/GridFind.tsx`

- [x] **Step 1: Add the failing test** to `commands.test.ts`. No single state shows every command: Run and Cancel exclude each other, and so do Connect, Cancel Connecting and Disconnect. So go through the states the file's existing tests already build: disconnected, connecting, connected, running, and with closed tabs. In each, every command's `keys` must equal `keyLabel(c.id)`, and every palette id must turn up in at least one of them. The test must not pass with every label undefined, so also assert that `run`'s label is `⌘↵` or `Ctrl+Enter`, whichever the test platform gives.
- [x] **Step 2: Implement.**
  - In `commands.ts`, type `Command.id` as `CommandId`, drop each entry's `keys`, have `add` set `keys: keyLabel(c.id)`, and drop the `*_KEY` imports.
  - Replace the `*_KEY` uses in the five components with `keyLabel(id)`. Pick one way to handle the `undefined` type, as the Design says.
  - Delete the constants from `keys.ts`.
- [x] **Step 3: Run.** `npm --prefix frontend test && npm --prefix frontend run build`. Expected: PASS, with no type errors.
- [x] **Step 4: Commit.** `git commit -m "Take palette and tooltip key labels from the registry"`

### Task 5: One listener for the page's keys

**Files:**
- Create: `frontend/src/state/pageKeys.ts`, `frontend/src/state/pageKeys.test.ts`
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/state/shortcuts.ts`, `frontend/src/state/shortcuts.test.ts`

- [x] **Step 1: Write the failing tests.**
  - `Object.keys(PAGE_KEYS)` sorted equals the sorted ids of the `"page"` entries. Leave `settings` out for now; Task 6 adds it.
  - `onPageKey`, with the actions mocked as `commands.test.ts` mocks them:
    - ⌘3 calls `focusTabKey(3)`, and ⌘9 calls `focusTabKey(9)`.
    - A match calls `preventDefault` and `stopPropagation`. A miss calls neither.
- [x] **Step 2: Run them and see them fail.**
- [x] **Step 3: Implement** `PAGE_KEYS` and `onPageKey` per the Design's table. `onPageKey` leaves an event alone when the matched id has no action: no `preventDefault`, nothing runs. That way ⌘, does nothing between this commit and Task 6, rather than throwing. The coverage test stops it from hiding a gap once Task 6 is in.
  - In `App.tsx`, replace `useRowDetailsKey`, `useStopKey` and `useGlobalKeys` with `useKeys`, a capture-phase `window` listener calling `onPageKey`. Effects use braces.
  - Move the old hooks' comments to `pageKeys.ts` where they still apply: why ⌘I, ⌘B and ⌘J are page-only, and why ⌘. arriving twice is harmless.
  - Delete `shortcuts.ts` and its test; `keymap.test.ts` holds those cases now.
- [x] **Step 4: Run.** `npm --prefix frontend test && npm --prefix frontend run build && npm --prefix frontend run lint`. Expected: PASS.
- [x] **Step 5: Run the key e2e specs** as the regression check. Run: `lgx e2e` (with the Linux prefix if needed). Expected: everything PASSES. `palette.spec.ts`, `sidebar.spec.ts`, `row-details.spec.ts` and the tab-cycling spec should pass with no changes.
- [x] **Step 6: Commit.** `git commit -m "Catch the page's keys with one registry-driven listener"`

### Task 6: Settings state and dialog

**Files:**
- Create: `frontend/src/state/settings.ts`, `frontend/src/state/settings.test.ts`, `frontend/src/components/SettingsDialog.tsx`
- Modify: `frontend/src/state/store.ts`, `frontend/src/state/palette.ts`, `frontend/src/state/pageKeys.ts`, `frontend/src/state/commands.ts`, `frontend/src/state/commands.test.ts`, `frontend/src/components/AppShell.tsx`

- [x] **Step 1: Write the failing tests.**
  - In `settings.test.ts`:
    - `openSettings` sets `settingsOpen`.
    - It does nothing with a palette, the profile dialog, the update dialog or a run confirm open.
    - `modalOpen` is true while settings is open.
    - `openPalette` is refused while settings is open.
    - `closeSettings` clears it.
  - In `commands.test.ts`, add `"settings"` to `ALWAYS`.
  - In `pageKeys.test.ts`, put `settings` back into the expected ids.
- [x] **Step 2: Run them and see them fail.**
- [x] **Step 3: Implement the state.**
  - `settingsOpen` in the store and in `initialState`.
  - `state/settings.ts`: `openSettings` remembers `document.activeElement`. `restoreSettingsFocus` restores it, falling back to `focusEditor` when the element is gone or is the body.
  - Guards in `palette.ts`.
  - `PAGE_KEYS.settings = openSettings`.
  - The palette's `settings` entry.
- [x] **Step 4: Build `SettingsDialog.tsx`** per the Design, and mount it in `AppShell.tsx`. In `onCloseAutoFocus`, call `preventDefault()`, then `restoreSettingsFocus()`. Add a header comment on what the dialog is, why there is one section, and that it is read-only until rebinding.
- [x] **Step 5: Run.** `npm --prefix frontend test && npm --prefix frontend run build && npm --prefix frontend run lint`. Expected: PASS.
- [x] **Step 6: Commit.** `git commit -m "Add a Settings dialog listing every command's shortcut"`

### Task 7: The palette hint

**Files:**
- Modify: `frontend/src/components/ResultTabs.tsx`

- [x] **Step 1: Implement.** In the empty results state, put the existing line and a second `<p>`, "All commands: {keyLabel("command-palette")}", in one wrapper. Keep the existing padding and muted style.
- [x] **Step 2: Run.** `npm --prefix frontend run build`. Expected: PASS.
- [x] **Step 3: Commit.** `git commit -m "Point to the Command Palette from the empty results pane"`

### Task 8: e2e

**Files:**
- Create: `frontend/e2e/settings.spec.ts`

- [x] **Step 1: Write the spec** per the Design's e2e list. Use `ensureProfile` from `./connect`, as `palette.spec.ts` does, so there is an editor and an empty results pane. Check that the sidebar is still there after `ControlOrMeta+b` with Settings open.
- [x] **Step 2: Run.** `lgx e2e`. Expected: PASS for the new spec and every existing one.
- [x] **Step 3: Commit.** `git commit -m "e2e: Settings dialog and the palette hint"`

### Task 9: Docs and the manual check

**Files:**
- Modify: `docs/DESIGN.md`, `src/quel/menu.lg`

- [x] **Step 1: Update `docs/DESIGN.md`.**
  - In "Palettes and keys", replace "Two dialogs, no registry" with the registry: one list in `state/keymap.ts`, the three catchers, behaviour attached by id, and the `menu.lg` drift test.
  - Rewrite "Keys" around `onPageKey`.
  - Add a ⌘, row to the key table.
  - Add a short Settings section: a dialog, ⌘, or the palette, read-only Keyboard Shortcuts, the focus rule, and the backlog entries that will extend it.
  - Mention the palette hint where the empty results pane is described.
- [x] **Step 2: Add a comment above `spec` in `src/quel/menu.lg`:** the accelerators mirror the `"menu"` keys in `frontend/src/state/keymap.ts`, and `keymap.test.ts` checks that both have the same set.
- [x] **Step 3: Run everything.** Run `npm --prefix frontend test && npm --prefix frontend run lint && lgx test && lgx e2e`. Expected: all PASS. `lgx test` covers the `menu.lg` edit.
- [x] **Step 4: Commit.** `git commit -m "Document the key registry and Settings"`
- [x] **Step 5: Manual check on a Mac** (`lgx dev`). Write the results in the PR description:
  - ⌘, opens Settings and Escape closes it, with focus back in the editor.
  - ⌘. cancels a running `select pg_sleep(5)`.
  - ⌘I, ⌘B, ⌘J and ⌘1–9 work as before.
  - ⇧⌘P and ⌘P open the palettes once each.

---

## Completion summary

Built as planned:

- `state/keymap.ts` is the one registry of every command and its keys,
  written per platform.
- `components/keys.ts` formats and matches bindings.
- The palette, the tooltips and one page listener (`state/pageKeys.ts`)
  read the registry. The listener replaces three.
- A read-only Settings dialog opens with ⌘, or from the palette.
- The empty results pane says "All commands: ⇧⌘P".
- Three backlog entries; `DESIGN.md` updated.
- Frontend: 686 unit tests pass, along with the type check and lint.
  Backend: 242 tests pass. Full e2e: 66 tests pass, 1 skipped (it was
  skipped before too).
- Screenshots of the dialog and the hint checked in server mode.
- The manual macOS check (Task 9, Step 5) is still to be done on a Mac.

Deviations:

- Codex reviews ran in the background while the next task started, not
  as blocking checkpoints. Tasks 6–8 were reviewed together as one diff.
  The docs-only tasks (1 and 9) had no code review. Every review found
  nothing to fix.
- Tests were written alongside the code, without a separate run to see
  them fail first.
- The tooltips use `keyLabelOf(id)`, which throws on an id with no keys,
  rather than `keyLabel(id)!`.
- `keymap.ts` also exports `GROUPS` (the Settings order), `entryOf` and
  `keysOf`.
- Settings rows show the key in a `<kbd>` with the palette shortcut's
  style, not the `CommandShortcut` component, which belongs to cmdk.
- The e2e spec checks that the sidebar is still there with a CSS
  locator: under a modal dialog the rest of the page is hidden from role
  queries.

What the plan could have specified better: the e2e list should have said
that role queries cannot see the page behind a modal dialog.

