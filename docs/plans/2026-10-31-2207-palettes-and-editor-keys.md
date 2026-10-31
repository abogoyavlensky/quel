# Palettes and Editor Keys Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⇧⌘P opens a command palette, ⌘P opens Go to Connection, ⌘E
focuses the current tab's editor from anywhere, and ⌘1–⌘9 switch to an
editor tab by number and focus it.

**Tech Stack:** React + TypeScript, shadcn `Command` (cmdk) on the
existing Radix dialog, zustand store, Vitest, Playwright (server mode);
let-go menu spec (`src/quel/menu.lg`).

---

## Design

### What the user gets

| Key (macOS / other) | What it does |
|---|---|
| ⇧⌘P / Ctrl+Shift+P | Opens the **Command Palette** |
| ⌘P / Ctrl+P | Opens **Go to Connection** |
| ⌘E / Ctrl+E | Focuses the current tab's editor, wherever focus is (the tree, the grid, the sidebar) |
| ⌘1–⌘8 / Ctrl+1–8 | Selects editor tab N, if there is one, and focuses its editor |
| ⌘9 / Ctrl+9 | Selects the last editor tab and focuses it (the browser convention) |

Tabs count left to right, as the tab bar shows them (pinned ones first,
the order of `workspace.tabs`). A digit past the last tab does nothing.

### Two dialogs, no command registry

The palettes are two separate dialogs, both built on shadcn `Command`
(`CommandDialog`). We decided against one palette with modes: nothing
beyond these two is in sight. The planned ⌘K object jump
(`docs/DESIGN.md`, milestone 2) stays a separate, later feature.

The Command Palette's entries are a hand-written list in
`frontend/src/state/commands.ts`. `useMenu` in `App.tsx` stays as it is.
The list repeats some menu actions on purpose: it calls the same runner
functions, so the only things it can drift on are titles and key labels.

### Go to Connection

- It lists every saved profile, in the store's order (by name).
- Each row is drawn like the sidebar's connection row:
  - `ConnMark` (engine, tag colour, status), the name, and the engine label in muted text on the right
  - 38px tall
  - the cmdk highlight is the soft indigo of the selected connection (`bg-primary/10`, `data-[selected=true]`)
- The selected profile reads "Current" in muted text before the engine label.
- Search matches the name and the engine label (cmdk `keywords`).
- ↵ **selects only** (`selectProfile`), like a click in the sidebar, and never connects. Connecting is a command in the Command Palette.
- After the select, focus goes to that workspace's editor.
- The input's placeholder is "Go to connection…". With no match it shows "No matching connections.", and with no profiles at all "No saved connections."

### Command Palette

Entries show only when they can run; nothing is greyed out. Each one has
a title, an optional key label (from `components/keys.ts`) and a group.

| Group | Entry | Shown when |
|---|---|---|
| Tabs | New Tab (⌘T) | a workspace is selected and loaded (no `loadError`) |
| Tabs | Close Tab (⌘W) | that, and the active tab is not pinned |
| Tabs | Reopen Closed Tab (⇧⌘T) | that, and `closed` is not empty |
| Tabs | Focus Editor (⌘E) | a workspace is selected and loaded |
| Query | Run (⌘↵), Run Script (⇧⌘↵) | a loaded workspace, and the active tab is not running |
| Query | Cancel (⌘.) | the active tab is running (`runningQueryId` set) |
| Connection | Connect | the selected profile is `disconnected` |
| Connection | Disconnect | the selected profile is `connected` |
| Connection | Go to Connection… (⌘P) | there is at least one profile |
| Connection | New Connection… | always |
| Connection | Edit Connection… | a profile is selected |
| Connection | Open Database… (⌘O) | always |
| View | Show Row Details / Hide Row Details (⌘I) | always; the title follows `rowDetails` |
| Help | Check for Updates… | always |

What they call:

- **Run, Run Script:** `runCurrent`. The runner already refuses a run while disconnected and says so.
- **Close Tab, Cancel:** `closeTab` and `cancel` on `selectedTabId()`.
- **New Tab:** `newTab` then focuses the editor, as `menu:new-tab` does.
- **Connect, Disconnect:** `connectProfile` and `disconnectProfile` on `selected`.
- **Edit Connection…:** `openProfileDialog({ mode: "edit", id })`.
- **Open Database…:** `api.chooseFile()` (the backend's "choose-file" handler), then `openProfileDialog({ mode: "new", path })` when a file was chosen, as `menu:open-db` does.
- **Go to Connection…:** switches straight to that palette.
- **Check for Updates…:** `checkForUpdates({ manual: true })`.

### State

- The store gets `palette: "commands" | "connections" | null`. Only one palette can be open, and opening the other one switches to it.
- `frontend/src/state/palette.ts` holds the shared functions:
  - `openPalette(kind)`, `closePalette()`
  - `modalOpen(s)`: true while the profile dialog, the update dialog or a palette is open
  - `focusEditorKey()` and `focusTabKey(n)`, for ⌘E and ⌘1–9
- `openPalette` does nothing while the profile or update dialog is open, so neither the key nor the native menu can stack a palette over them.
- `focusEditorKey` and `focusTabKey` do nothing while `modalOpen` is true. In those dialogs the keys belong to the dialog.
- Picking an entry closes the palette first, then runs the action on the next tick (`setTimeout`). The close guard is off by then, so actions that open the profile dialog work.
- Focus on close is handled explicitly. A Radix Dialog only gives focus back to its `DialogTrigger` (`@radix-ui/react-dialog`, `onCloseAutoFocus`), and these palettes have none: they open from keys, menu events and the store.
  - `openPalette` keeps `document.activeElement` in a module variable when no palette is open yet. Switching between the two palettes keeps the first one.
  - Both dialogs always prevent Radix's default in `onCloseAutoFocus`.
  - A dismissal (Escape, a click outside) calls `restoreFocus()`. It focuses the kept element if it is still in the document (`isConnected`), and otherwise the editor.
  - After an entry runs, nothing is restored, because the action decides where focus goes.

### Keys: one window listener, plus a View menu

- One capture-phase `window` keydown listener, `useGlobalKeys` in `App.tsx`, handles all of ⇧⌘P, ⌘P, ⌘E and ⌘1–9. It works the way ⌘I and ⌘. do now.
- The matching is a pure function, `shortcutOf(e, mac)` in `frontend/src/state/shortcuts.ts`, so it can be unit-tested.
  - It returns `{ kind: "palette", palette }`, `{ kind: "editor" }`, `{ kind: "tab", n }` or `null`.
  - The modifier is the same as today: `metaKey && !ctrlKey` on macOS, `ctrlKey && !metaKey` elsewhere. Alt never matches.
  - Shift only matches with P.
  - Digits match on `e.code` (`Digit1`–`Digit9`), because ⇧ or a keyboard layout can change `e.key`.
- On a match the listener calls `preventDefault` and `stopPropagation`. That keeps the webview or browser from printing on ⌘P.
- None of these keys collide with CodeMirror. Its default, search, history and completion keymaps bind none of Mod-p, Mod-Shift-p, Mod-e or Mod-1…9 (checked in `node_modules/@codemirror/*`). The emacs-style Ctrl-p and Ctrl-e bindings are macOS-only, where our modifier is ⌘.
- A new native **View** menu sits between Edit and Query. It has "Command Palette…" (`CmdOrCtrl+Shift+P`) and "Go to Connection…" (`CmdOrCtrl+P`), so they can be found in the menu bar. Each item sends an event (`menu:command-palette`, `menu:go-to-connection`) that `useMenu` turns into `openPalette`.
- If the native menu and the page both see the key, the palette opens twice. That's harmless, because opening sets the state, it doesn't toggle it.
- ⌘E and ⌘1–9 get no menu items: nine "Tab N" items would be clutter, and the window listener covers server mode too.

### Testing

- **Vitest, `state/shortcuts.test.ts`:** the key matching for both platforms. The wrong modifier, Alt and Shift+digit don't match. `Digit1` matches when `key` is "!".
- **Vitest, `state/commands.test.ts`:** which entries show for given store states: no profile, disconnected, connected, a running tab, a pinned active tab, closed tabs, row details open and closed.
- **Vitest, `state/palette.test.ts`:**
  - the guards: no palette over the profile or update dialog; no tab or editor key while a dialog or palette is open
  - `focusTabKey`: tab N, ⌘9 picks the last tab, past the end does nothing (`focusEditor` mocked)
- **Backend, `test/quel/menu_test.lg`:** the View items exist with their accelerators, and Wails accepts the spec.
- **Playwright, `e2e/palette.spec.ts` (server mode, so Ctrl):**
  - ⌘P selects a profile, and its editor has focus
  - ⇧⌘P → "New Tab" adds a tab; ⇧⌘P → "Connect" connects
  - ⌘1/⌘2 switch tabs and focus the editor
  - ⌘E from the structure tree focuses the editor
  - Escape closes a palette
- **Manual, in the macOS app** (`lgx package-macos && lgx verify-macos`, then open the app): ⌘P, ⇧⌘P, ⌘E and ⌘1 reach the page and don't trigger a webview default; the View menu items open the palettes.

## File Structure

| File | Change |
|---|---|
| `frontend/src/components/ui/command.tsx` | Create, via `npx shadcn@latest add command` (adds `cmdk` to `package.json`) |
| `frontend/src/state/store.ts` | Modify: `palette` in `AppState` and `initialState` |
| `frontend/src/state/shortcuts.ts` (+ `.test.ts`) | Create: `shortcutOf` |
| `frontend/src/state/palette.ts` (+ `.test.ts`) | Create: open, close, guards, `focusEditorKey`, `focusTabKey` |
| `frontend/src/state/commands.ts` (+ `.test.ts`) | Create: `Command` type and `commands(s)` |
| `frontend/src/components/keys.ts` | Modify: labels for the new and listed keys |
| `frontend/src/components/GoToConnection.tsx` | Create |
| `frontend/src/components/CommandPalette.tsx` | Create |
| `frontend/src/components/AppShell.tsx` | Modify: render both dialogs |
| `frontend/src/App.tsx` | Modify: `useGlobalKeys`, the two menu events |
| `src/quel/menu.lg`, `test/quel/menu_test.lg` | Modify: View menu |
| `frontend/e2e/palette.spec.ts` | Create |
| `docs/DESIGN.md` | Modify: a "Palettes and keys" section under Frontend |

Shared shapes, which tasks 2–6 must agree on:

```ts
// state/shortcuts.ts
export type Shortcut =
  | { kind: "palette"; palette: "commands" | "connections" }
  | { kind: "editor" }
  | { kind: "tab"; n: number }; // 1–9; 9 means the last tab
export function shortcutOf(
  e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  mac: boolean,
): Shortcut | null;

// state/commands.ts
export interface Command {
  id: string; // stable, also the cmdk value
  group: "Tabs" | "Query" | "Connection" | "View" | "Help";
  title: string;
  keys?: string; // a label from components/keys.ts
  run: () => void | Promise<void>;
}
export function commands(s: AppState): Command[]; // only the runnable ones, in table order
```

---

### Task 1: The Command component and the palette state

**Files:**
- Create: `frontend/src/components/ui/command.tsx`
- Modify: `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/state/store.ts`
- Create: `frontend/src/state/palette.ts`, `frontend/src/state/palette.test.ts`

- [x] **Step 1: Add the shadcn component.** From `frontend/`, run `npx shadcn@latest add command`. It uses the project's `radix-nova` style and should add `cmdk` and `components/ui/command.tsx` without changing `dialog.tsx`. If it offers to overwrite `dialog.tsx` or another existing component, decline. Check `git diff --stat`: the only changes should be the new file and the package files.
- [x] **Step 2: Store.** Add `palette: "commands" | "connections" | null` to `AppState`, with a comment, and `palette: null` to `initialState()`.
- [x] **Step 3: `palette.ts`.**
  - `modalOpen(s)` is true when `s.profileDialog !== null || s.updateDialogOpen || s.palette !== null`.
  - `openPalette(kind)` returns early when the profile or update dialog is open. Otherwise, when `palette` is `null`, it keeps `document.activeElement` (an `HTMLElement`) as the element to return to, then sets `palette`.
  - `closePalette()` sets `null`.
  - `restoreFocus()` focuses the kept element if it is still `isConnected`, else calls `focusEditor()`, then forgets it.
  - `focusEditorKey()`: if `!modalOpen` and a loaded workspace is selected, call `focusEditor()`.
  - `focusTabKey(n)`: if `!modalOpen` and a loaded workspace is selected, pick `tabs[n - 1]`, or the last tab for n = 9; if there is one, `selectTab(id)` and then `setTimeout(focusEditor)`.
- [x] **Step 4: Tests.** In `palette.test.ts`, mock `@/editor/states` (`focusEditor` as a spy), seed the store with `newWorkspace`, and cover:
  - open is refused under each dialog
  - opening the other kind switches
  - the keys do nothing while `modalOpen`
  - `focusTabKey(1)` and `(2)` select and focus
  - `(9)` picks the last of three tabs
  - `(5)` with three tabs does nothing
  - the keys do nothing with no workspace or with a `loadError`
  - `restoreFocus` returns to the element focused before the first open, also after a switch to the other palette. It calls `focusEditor` when that element has left the document.

  Use fake timers for the `setTimeout`. Vitest runs in Node here, with no DOM (`vite.config.ts` sets no environment). So `palette.ts` reads `document` only inside its functions, never at import time, and the test uses `vi.stubGlobal("document", { activeElement })`, where `activeElement` has a `focus` spy and an `isConnected` flag.
- [x] **Step 5: Run** `npm --prefix frontend test`. Expected: all pass.
- [x] **Step 6: Commit** `Palette state and the shadcn Command component`.

> Deviation: `shadcn add command` (CLI 4.23.0) would overwrite `button.tsx`, `input.tsx` and `dialog.tsx` (our customised versions) and add `textarea.tsx` and `input-group.tsx`; with no TTY it aborted on the prompt after adding `cmdk` to `package.json`. I wrote `command.tsx`, `input-group.tsx` and `textarea.tsx` by hand from the registry source (`--view`), importing `cn` from `@/lib/utils` like the existing components, and left the existing three alone. `CommandDialog` spreads its props onto the `Dialog` root, so it could not pass `onCloseAutoFocus` to `DialogContent`; I added that one prop to it and moved the sr-only title inside `DialogContent`.
> Deviation: `palette.ts` reads `document.activeElement` with a cast, not `instanceof HTMLElement` (Node has no `HTMLElement`).
> Deviation: `palette.test.ts` mocks `@/state/runner` (`selectTab` spy) as well as `@/editor/states`, to keep the runner's api imports out of the test.
> Note: no session task list (TaskCreate is not available here); this document is the only tracker.

### Task 2: Key matching

**Files:**
- Create: `frontend/src/state/shortcuts.ts`, `frontend/src/state/shortcuts.test.ts`

- [x] **Step 1: Implement `shortcutOf`** with the signature above.
  - The modifier must match the platform (`mac`: `metaKey && !ctrlKey`; else `ctrlKey && !metaKey`), and Alt must be up.
  - P (`key.toLowerCase() === "p"`) gives `connections` without Shift and `commands` with it.
  - E without Shift gives `editor`.
  - `code` `Digit1`…`Digit9` without Shift gives `tab` with that n.
  - Anything else is `null`.
- [x] **Step 2: Tests.** Both platforms. Cover:
  - Ctrl+P on macOS is `null`, and so is Meta+P on Linux.
  - Alt+⌘P is `null`, and so is ⇧⌘1.
  - ⇧⌘P with `key: "P"` gives `commands`.
  - ⌘1 with `key: "1"` gives tab 1, and so does `key: "&"` with `code: "Digit1"`.
  - ⌘0 is `null`, and so is ⌘E with Shift.
- [x] **Step 3: Run** `npm --prefix frontend test`. Expected: all pass.
- [x] **Step 4: Commit** `Match the palette, editor and tab keys`.

### Task 3: The command list

**Files:**
- Modify: `frontend/src/components/keys.ts`
- Create: `frontend/src/state/commands.ts`, `frontend/src/state/commands.test.ts`

- [x] **Step 1: Key labels.** Next to the existing ones, add `NEW_TAB_KEY` (⌘T / Ctrl+T), `CLOSE_TAB_KEY` (⌘W), `REOPEN_KEY` (⇧⌘T), `OPEN_DB_KEY` (⌘O), `PALETTE_KEY` (⇧⌘P), `GOTO_KEY` (⌘P) and `FOCUS_KEY` (⌘E), each with its Ctrl+… form.
- [x] **Step 2: Implement `commands(s)`** as in the Design table, in table order.
  - The run functions call the runner, profiles, updates and api functions listed in the Design.
  - Entries that move focus (New Tab, Focus Editor) end with `setTimeout(focusEditor)`.
  - "Go to Connection…" calls `openPalette("connections")`. This is the one entry that runs while a palette is open; see Task 5.
  - Disconnect shows only for `connected`; while `connecting` or `disconnecting`, neither Connect nor Disconnect shows.
- [x] **Step 3: Tests.** Assert the ids that show for:
  - no profiles, where only New Connection, Open Database, Row Details and Updates show
  - a selected profile with a disconnected loaded workspace
  - the same profile connected
  - a running active tab, where Cancel shows and Run does not
  - a pinned active tab, where Close does not show
  - a workspace with closed tabs
  - a workspace with a `loadError`, where no tab or query entries show

  Also check that the Row Details title follows `rowDetails`, and that Connect's `run` calls `connectProfile` with the selected id (mock `./runner`).
- [x] **Step 4: Run** `npm --prefix frontend test`. Expected: all pass.
- [x] **Step 5: Commit** `The command palette's entries`.

> Deviation: Run and Run Script show when the active tab's `runningQueryId` is null (the plan's wording), not by `isRunning`, so Cancel and Run are exact opposites. The Connect and Disconnect entries read the selected workspace's `status`, so they need that workspace to exist but not to be free of `loadError`.

### Task 4: Go to Connection

**Files:**
- Create: `frontend/src/components/GoToConnection.tsx`
- Modify: `frontend/src/components/AppShell.tsx`

- [ ] **Step 1: Implement** a `CommandDialog`, open when `palette === "connections"`; `onOpenChange(false)` calls `closePalette`.
  - The dialog title is "Go to Connection", visually hidden but there for screen readers and tests.
  - One `CommandItem` per profile, with `value` = the profile id and `keywords` = [name, engine label].
  - Each row is drawn like the sidebar row in `ConnectionsPanel.tsx`: `ConnMark` with the workspace status, the truncated name, "Current" for the selected profile, and the engine label (the `engineLabel` map in `colors.ts`). 38px tall, with the selected style `data-[selected=true]:bg-primary/10` as in `docs/DESIGN.md` "Look".
  - On select: mark "an entry ran", `closePalette()`, then on the next tick `await selectProfile(id)` and `setTimeout(focusEditor)`.
  - `onCloseAutoFocus` always calls `preventDefault`. If no entry ran (a dismissal), it calls `restoreFocus()`. It then clears the "an entry ran" mark.
  - Empty states as in the Design.
- [ ] **Step 2: Render it** in `AppShell` next to `ProfileDialog` and `UpdateDialog`.
- [ ] **Step 3: Type-check** with `npm --prefix frontend run build`. Expected: success.
- [ ] **Step 4: Commit** `Go to Connection`.

### Task 5: The Command Palette

**Files:**
- Create: `frontend/src/components/CommandPalette.tsx`
- Modify: `frontend/src/components/AppShell.tsx`

- [ ] **Step 1: Implement** a `CommandDialog`, open when `palette === "commands"`, with the visually hidden title "Command Palette" and the placeholder "Type a command…".
  - `useApp(commands)` would make a new array on every store change, so read `useApp((s) => s)`, or the few fields the list needs, and call `commands(state)` in render.
  - One `CommandGroup` per group in order, `CommandItem value={c.id} keywords={[c.title]}`, and `CommandShortcut` for `keys`. The same selected style as Task 4.
  - On select:
    - "Go to Connection…" runs at once. It only switches the palette, so no close and no focus handling.
    - Everything else: mark that an entry ran, `closePalette()`, then `setTimeout(() => void c.run())`.
  - `onCloseAutoFocus` works as in Task 4.
- [ ] **Step 2: Render it** in `AppShell`.
- [ ] **Step 3: Type-check** with `npm --prefix frontend run build`. Expected: success.
- [ ] **Step 4: Commit** `Command Palette`.

### Task 6: Keys and the View menu

**Files:**
- Modify: `frontend/src/App.tsx`, `src/quel/menu.lg`, `test/quel/menu_test.lg`

- [ ] **Step 1: `useGlobalKeys`** in `App.tsx`. It is a capture-phase `window` keydown listener with braces in the effect cleanup, like `useRowDetailsKey`.
  - It calls `shortcutOf(e, isMac)`. On a match, `preventDefault` and `stopPropagation`, then dispatch: `openPalette`, `focusEditorKey()` or `focusTabKey(n)`.
  - Its comment should explain why it isn't a set of native menu items: server mode, and nine digits.
- [ ] **Step 2: Menu events.** In `useMenu`, `menu:command-palette` → `openPalette("commands")` and `menu:go-to-connection` → `openPalette("connections")`.
- [ ] **Step 3: The View menu.**
  - In `menu.lg`, add the `command-palette!` and `go-to-connection!` emitters.
  - In `spec`, add `{:label "View" :items [...]}` between `{:role :edit-menu}` and Query: "Command Palette…" `CmdOrCtrl+Shift+P` and "Go to Connection…" `CmdOrCtrl+P`, registered by var (`(partial #'command-palette! env)`).
  - Extend the comment above `spec` with one line on why opening tolerates the double delivery.
- [ ] **Step 4: Menu tests.**
  - Raise the on-click count from 9 to 11.
  - Add "View", "Command Palette…" and "Go to Connection…" to the labels test.
  - Add a test for both accelerators, like `reopen-closed-tab-has-its-key`.
- [ ] **Step 5: Run** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test` (plain `lgx test` where GTK headers exist) and `npm --prefix frontend test`. Expected: all pass.
- [ ] **Step 6: Commit** `Keys for the palettes, the editor and tabs; a View menu`.

### Task 7: End to end

**Files:**
- Create: `frontend/e2e/palette.spec.ts`

- [ ] **Step 1: Write the spec**, using `ensureProfile`, `profileRow` and the locators from `tabs.spec.ts` and `connect.ts`. Use a profile of its own (`Palette ${Date.now()}`) and a second profile so the switch is visible. Cover:
  - `ControlOrMeta+p` shows the "Go to Connection" dialog. Typing the name and pressing Enter puts it in the banner, closes the dialog, and the "SQL editor" is focused.
  - `ControlOrMeta+Shift+p`, type "New Tab", Enter: the tab bar has two tabs.
  - `ControlOrMeta+Shift+p`, "Connect", Enter: the status reads "Ready".
  - `ControlOrMeta+1`: the first tab is `aria-selected` and the editor is focused. `ControlOrMeta+2` does the same for the second.
  - Click a node in the structure tree, then `ControlOrMeta+e`: the editor is focused.
  - Focus the editor, open either palette, press Escape: no dialog is left and the editor is focused again. Do the same from a structure tree node: that node gets focus back.
- [ ] **Step 2: Run** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e` (or plain `lgx e2e`). Expected: all specs pass. If Chromium takes Ctrl+1–9 for itself before the page sees them, write it down in the spec and in `docs/DESIGN.md` "Testing", and test `focusTabKey` through ⌘2 only where it works; don't drop the unit tests.
- [ ] **Step 3: Commit** `e2e: palettes, editor focus and tab keys`.

### Task 8: Docs and the macOS check

**Files:**
- Modify: `docs/DESIGN.md`

- [ ] **Step 1: Write a "### Palettes and keys" section** under Frontend, after "Row details". Cover:
  - the key table
  - the two dialogs and why there is no registry
  - that Go to Connection only selects
  - the hide-don't-grey rule
  - the window listener plus View menu, and why double delivery is harmless
  - the dialog guards
  - that ⌘K stays separate

  In the milestones, leave `Cmd+K` where it is.
- [ ] **Step 2: Manual macOS pass** (Apple Silicon Mac): `lgx package-macos && lgx verify-macos`, then open the app with `QUEL_SECRETS=memory` and a scratch `QUEL_DATA_DIR`. Check:
  - ⌘P, ⇧⌘P, ⌘E, ⌘1 and ⌘9 work from the editor, the tree and the grid
  - the View menu items open the palettes
  - no print dialog or other webview default shows

  Without a Mac, list this as not done in the hand-off.
- [ ] **Step 3: Commit** `Design: palettes and editor keys`.
