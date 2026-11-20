# About Quel, Quel's Queries in Messages, and Polish Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Quel its own macOS app menu with an About dialog and Settings…, show every catalog query Quel sends in Messages, let the row details filter search values (JSON first), keep the Run button clear of the editor's scrollbars, and use a copy icon for Copy row.

**Tech Stack:** let-go (lgx) on Wails v3 through letgo-packages' `wails` package; Vite + React + TypeScript + Tailwind + shadcn; vitest; Playwright e2e in server mode.

---

## Design

Five changes from one discussion. They ship together as one Quel PR, after one letgo-packages release.

### 1. App menu and About dialog

**Now.** `{:role :app-menu}` in `src/quel/menu.lg` is Wails' fixed `NewAppMenu`: About, Services, Hide, Hide Others, Show All, Quit. Its About is a native alert with the app's `:name` and `:description` ("Quel / A database client", `src/quel/system.lg:62`): no version, no links. The shim takes no items of ours in that menu, which is why Check for Updates sits in Help and why `docs/backlog/settings-in-app-menu.md` is open.

**Upstream (letgo-packages, `wails/shim/menu.go`).** Add four roles to `menuRoles`:

| keyword | Wails role | macOS selector |
|---|---|---|
| `:services-menu` | `ServicesMenu` | (submenu: Wails registers it with `setServicesMenu:`) |
| `:hide` | `Hide` | `hide:` (⌘H) |
| `:hide-others` | `HideOthers` | `hideOtherApplications:` (⌥⌘H) |
| `:show-all` | `ShowAll` | `unhideAllApplications:` |

Use `ShowAll`, not `UnHide`. Wails' `UnHide` item has no selector in `menuitem_selectors_darwin.go`, so it would be a dead item. These four are macOS roles. On Linux and Windows Wails still makes the items, but they do nothing, so the README says to add them on macOS only. Then: update `knownRoles`, add a menu test, update the README's menu section, open a PR, merge it, and tag `wails-v0.11.0` on the merge commit. The shim is in-tree (`{:go/local "shim"}`), so the package tag is the whole release. There's no Go module tag (see the letgo-packages README, "In-tree shims"). The user said to publish this without asking again.

**Quel's menu.** The first top-level menu is the app menu on macOS, whatever its label. `quel.menu/spec` replaces `{:role :app-menu}` with:

```clojure
{:label "Quel"
 :items [About Quel…            ; emits "menu:about"
         Check for Updates…     ; moved from Help; emits "menu:check-updates"
         ---
         Settings… CmdOrCtrl+,  ; emits "menu:settings"
         ;; macOS only:
         --- {:role :services-menu} --- {:role :hide} {:role :hide-others} {:role :show-all}
         ---
         {:role :quit}]}
```

- File loses its Quit, and the Help menu goes (its only item moved). On Linux, the "Quel" menu holds About, Check for Updates, Settings and Quit, which works fine there.
- `spec` takes the OS name so tests can build both variants: `(spec env)` calls `(spec env (os/os-name))`, and `(spec env os-name)` adds the macOS-only items when `os-name` is `"darwin"`.
- The keymap registry's `settings` entry gets the `"menu"` catcher (`caught: ["menu", "page"]`), so the drift test in `state/keymap.test.ts` stays green. If both the menu and the page see ⌘, it does no harm: `openSettings` does nothing while a modal is open (`modalOpen`).
- `App.tsx` listens for `menu:about` → `openAbout()` and `menu:settings` → `openSettings()`.

**The About dialog** (`components/AboutDialog.tsx`) is a shadcn `Dialog` titled "About Quel":
- The app icon, a 256×256 PNG made from `build/macos/icon.png` and imported from `frontend/src/assets/quel-icon.png`.
- **Quel**, **Version 0.2.8**, and "A database client".
- A **Check for Updates** button. It closes About and then calls `checkForUpdates({ manual: true })`, so the update dialog never opens on top of About.
- Links: **GitHub** (`https://github.com/abogoyavlensky/quel`) and **Release notes** (`…/releases`), opened with `openUrl` (`lib/browser.ts`).
- A **Copy version info** button. It copies `Quel 0.2.8 (darwin arm64)` and shows a check for a moment, like `CopyButton` in `RowDetails.tsx`.
- "MIT License · © 2026 Andrey Bogoyavlenskiy" in small muted text.

The version, OS and architecture come from a new backend call, `app-info` → `{:version quel.version/version :os (os/os-name) :arch (os/arch)}`. Opening and closing follow `state/settings.ts`: `openAbout` does nothing when `modalOpen(s)`, it remembers the focused element, and focus goes back there on close. `AppState` gets `aboutOpen: boolean`, and `modalOpen` checks it. The Command Palette gets an "About Quel" command, so About can be reached in server mode and e2e too, where there is no native menu.

### 2. The Run button and the scrollbars

`RunButton.tsx` sits at `absolute right-4 bottom-3` over the editor, so it covers the scrollbars when the editor scrolls both ways. A hook, `editor/useScrollbarInset.ts`, finds the editor's `.cm-scroller` (a sibling inside the same `relative` wrapper in `AppShell.tsx`) and measures:

```ts
right = scroller.offsetWidth - scroller.clientWidth;   // vertical bar's width
bottom = scroller.offsetHeight - scroller.clientHeight; // horizontal bar's height
```

It re-measures from a `ResizeObserver` on both `.cm-scroller` (the pane resizing) and `.cm-content` (the document growing, which is when scrollbars appear). The button's offsets become `right: 16 + right` and `bottom: 12 + bottom` as an inline style in px, replacing the `right-4 bottom-3` classes. When scrollbars only show while scrolling (the macOS default), both values are 0 and the button stays where it is. The effect body uses braces (AGENTS.md).

### 3. Copy row icon

In `RowDetails.tsx`, "Copy row as JSON" uses `<Copy />` instead of `<Braces />` (the default icon of `CopyButton`), with the same label and tooltip. Remove the unused `Braces` import.

### 4. Row details: filter by value too

The "Filter columns" box matches only column names. It becomes "Filter columns and values":

- **What it searches is what the panel shows.** For a JSON value, that's the reformatted text from `jsonText(cell, type, engine)`, so `"status": "x"` matches even when the database stores `{"status":"x"}`. Any other value is searched as `String(cell)`, including JSON that is too long to reformat (over `MAX_JSON_CHARS`). NULL never matches.
- A field shows when its column name **or** its shown text contains the search text. Case doesn't matter, the same as now. When nothing matches, the list shows "No columns or values match."
- **Matches inside values are highlighted** with a `<mark>` (a quiet highlight that works in light and dark themes, e.g. `bg-yellow-300/40 text-inherit rounded-[2px]`). Column names are not highlighted; only values are.
- `RowDetails` works out each field's shown text once per row (memoized on row, columns and engine) and passes it to `Field`, so filtering and rendering use the same text.

A pure helper, `grid/marks.ts`, holds the matching logic:

```ts
// Non-overlapping [start, end) ranges where needle occurs in text,
// ignoring case. Empty needle → [].
export function matchRanges(text: string, needle: string): Array<[number, number]>;
```

`JsonCode` gets an optional `ranges` prop. While `highlightCode` emits tokens, it keeps a running character offset (each line break counts as 1). Any token that crosses a range is split into pieces, and the pieces inside the range are wrapped in `<mark>` inside the token's colored `<span>`. Plain values use a small `MarkedText` component built on the same ranges.

### 5. Quel's queries in Messages (for transparency)

**Now.** Messages belong to each editor tab (`EditorTab.messages`, at most 500, in memory). Quel's own SQL runs on the connection's shared pool, never on a tab's session (`src/quel/meta.lg:11`). That SQL is the catalog queries in `meta/{postgres,duckdb,sqlite}.lg` and the `select 1` ping on connect (`conn.lg` `ping!`).

**Backend: record what ran.**
- `quel.meta/execute!` `[db sqlv]` wraps `sql.core/execute!`. It times the call (`System/nanoTime`) and adds an entry to the atom at `(::queries db)`, if there is one:

  ```clojure
  {:sql "select …" :params ["public"] :ms 3 :rows 12}       ; success
  {:sql "select …" :params ["public"] :ms 3 :error "msg"}   ; failure, then rethrow
  ```

  `:params` are the statement's parameters as strings. Every `sql/execute!` in `src/quel/meta/*.lg` (30 calls) goes through it instead. That's a mechanical swap: `sql.core` ignores the extra key on the connectable map (`normalize` keeps any map with `:sql/handle`). This uses no `with-redefs` and no dynamic vars: the log travels on the `db` value.
- `quel.api` gets a private helper `(logged db f)`. It assocs a fresh atom at `::meta/queries`, calls `(f db')`, and returns `{:result r :queries @log}`. On a throw it rethrows `(ex-info (ex-message e) {:queries @log})`. The wails shim hands ex-info data to the frontend as the error's `cause` (wails README, "Throwing from a handler"), and the message stays the same. `list-schemas`, `describe-schema`, `describe-object` and `completion-schema` use it.
- `connect`: `conn/ping!` returns how long it took, and `open-target!` adds `:queries [{:sql "select 1" :params [] :ms n :rows 1}]` to its result for Postgres, Redshift and DuckDB. SQLite has no ping, so it returns `[]`.
- Not logged (backlog entry, Task 10): the `select 1` liveness check that `exec/dead?` runs on a tab's session after a failed run, and the ping of a connect that fails. Both fail through paths that carry only a message, and the lost-connection and connect-error UI already explain them.

**Frontend: a log per connection, merged into Messages.**
- `Workspace` gets `quelLog: QuelQuery[]`, in memory, newest last, at most `MAX_MESSAGES`. It lives as long as the workspace, across reconnects, like the tabs' messages.

  ```ts
  export interface QuelQuery {
    id: string;
    sql: string;
    params: string[];
    ms: number;
    rows: number | null;   // null on error
    error: string | null;
    at: number;            // Date.now() when the reply arrived
  }
  ```
- `lib/api.ts` unwraps `{result, queries}` for the four catalog calls, so their callers (`StructureTree`, `lib/query.ts`) don't change. It hands `queries` to a sink, `setQuelQueriesSink((connId, queries) => void)`. On a rejection it reads `err.cause?.queries`, passes them to the sink, and rethrows. A sink keeps `lib/` from importing `state/`. `state/quelLog.ts` sets the sink when it loads: it finds the workspace whose `connId` matches and appends.
- `connect` in `runner.ts` appends `opened.queries` to the workspace right after it stores the `connId`. The sink would miss them, because no workspace has that `connId` yet.
- `MessagesView` merges `tab.messages` with the workspace's `quelLog` by `at`. A stable sort keeps the order within a batch. Each Quel entry shows the time, a small muted **Quel** label and its SQL on one line, followed by "12 rows in 3 ms" (or the error, in red) and "Parameters: public, users" when there are any. The whole entry is a `<details>`: opening it shows the full SQL, formatted as it was sent (`whitespace-pre-wrap`). The catalog queries are long, and reading them is the point.
- **The toggle: on by default.** The point is transparency: a user who never finds a toggle should still see what Quel sends. The noise stays small, because these queries run only on connect, on loading completion and when a tree node expands for the first time (react-query caches the rest). Hiding is one click, and the choice is remembered app-wide. The flag is `quel-queries-hidden` in the settings table: a row while hidden, none while shown, the same pattern as `sidebar-hidden` (`workspace.lg` `flag?`/`set-flag!`). `AppState.quelQueriesHidden: boolean | null` is null until it's read at start-up, which means shown.
  - A slim header row at the top of `MessagesView` holds a checkbox labeled "Show Quel's queries". It shows even when the tab has no messages of its own.
  - Command Palette: "Hide Quel's Queries" / "Show Quel's Queries".
  - The empty state ("Nothing has run in this tab yet.") shows only when nothing is left to show after the toggle.

### Testing

- letgo-packages: a menu test that builds an app menu from the four new roles (`check-menu`), and that an unknown role still errors and lists them. Runs as `cd wails && CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`, the same as CI.
- Backend (`lgx test`): menu spec for `"darwin"` and `"linux"`, `app-info`, `meta/execute!` logging success and failure, `logged` returning queries and rethrowing with them, connect's ping entry.
- Frontend (`npm --prefix frontend test`): `matchRanges`, the keymap drift test, the store's Quel log (append, cap, connId lookup), api unwrapping and the rejection path, the toggle's load and save, the merge order in Messages.
- e2e (`lgx e2e`, server mode, SQLite): the About dialog from the palette; the Run button clear of both scrollbars; the row details value filter with highlights; Quel's queries showing after a tree expand, and hiding with the toggle.

### Non-goals

- Logging the failure-path SQL listed above (backlog).
- A General section in Settings (the Messages header and the palette are enough for one toggle).
- Credits or a build hash in About.
- Moving the Run button out of the editor.
- Changing the user's own Messages entries (no `<details>` for them).

## File Structure

**letgo-packages** (`/home/agent/Projects/letgo-packages`)
- Modify `wails/shim/menu.go`: four roles and `knownRoles`.
- Modify `wails/test/wails/menu_test.lg`: an app menu built from the new roles.
- Modify `wails/README.md`: menu roles, macOS-only note, and the changelog line if the README keeps one.

**Quel backend**
- Modify `lgx.edn`: `wails-v0.10.0` → `wails-v0.11.0`.
- Modify `src/quel/menu.lg`: own app menu, `menu:about`/`menu:settings` emitters, OS-aware `spec`.
- Modify `src/quel/api.lg`: `app-info`, `quel-queries-hidden`/`set-quel-queries-hidden`, `logged` around the catalog calls, registry entries.
- Modify `src/quel/workspace.lg`: `quel-queries-hidden` / `set-quel-queries-hidden!`.
- Modify `src/quel/meta.lg`: `execute!` and the `::queries` key.
- Modify `src/quel/meta/{postgres,duckdb,sqlite}.lg`: `sql/execute!` → `meta/execute!`.
- Modify `src/quel/conn.lg`: `ping!` timing, `:queries` on `open-target!`.
- Modify `scripts/smoke.sh`: the completion check reads through `result`.
- Tests: `test/quel/{menu,api,meta,conn,workspace}_test.lg`.

**Quel frontend** (`frontend/src`)
- Create `assets/quel-icon.png` (256×256).
- Create `components/AboutDialog.tsx`, `state/about.ts` (+ `state/about.test.ts`).
- Create `editor/useScrollbarInset.ts`.
- Create `grid/marks.ts` (+ `grid/marks.test.ts`).
- Create `state/quelLog.ts` (+ `state/quelLog.test.ts`).
- Modify `App.tsx` (events, AboutDialog), `state/store.ts` (`aboutOpen`, `quelQueriesHidden`, `Workspace.quelLog`, `QuelQuery`), `state/palette.ts` (`modalOpen`), `state/commands.ts` (About, toggle), `state/keymap.ts` (settings catcher), `lib/api.ts` (+ test), `lib/types.ts`, `state/runner.ts` (connect), `components/RunButton.tsx`, `components/RowDetails.tsx`, `grid/JsonCode.tsx`, `components/MessagesView.tsx`.
- e2e: `frontend/e2e/{about,run-button,row-details,quel-queries}.spec.ts`.

**Docs**
- Modify `docs/DESIGN.md`: app menu, About, Messages, row details filter.
- Modify `docs/backlog/settings-in-app-menu.md`: done.
- Create `docs/backlog/quel-queries-failure-paths.md` (its own commit).

Commands below run from `/home/agent/Projects/quel` unless they say otherwise. There's no desktop here, so the lgx tasks run with `CGO_ENABLED=1 GOFLAGS=-tags=server` (written as `$SRV` below: `SRV="CGO_ENABLED=1 GOFLAGS=-tags=server"`, used as `env $SRV lgx test`).

---

### Task 1: Upstream: app menu roles in the wails shim, released as wails-v0.11.0

**Files:**
- Modify: `/home/agent/Projects/letgo-packages/wails/shim/menu.go`
- Modify: `/home/agent/Projects/letgo-packages/wails/README.md`
- Test: `/home/agent/Projects/letgo-packages/wails/test/wails/menu_test.lg`

- [x] **Step 1: Branch.** `cd /home/agent/Projects/letgo-packages && git checkout master && git pull --ff-only && git checkout -b wails-app-menu-roles`
- [x] **Step 2: Write the failing test.** In `menu_test.lg`, `check-menu` accepts `[{:label "App" :items [{:label "About"} {:separator true} {:role :services-menu} {:separator true} {:role :hide} {:role :hide-others} {:role :show-all} {:separator true} {:role :quit}]}]`. The unknown-role error message lists `:services-menu :hide :hide-others :show-all`.
- [x] **Step 3: Run it and watch it fail.** `cd wails && CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`. Expected: the new test fails with `unknown role :services-menu`.
- [x] **Step 4: Implement.** Add the four `menuRoles` entries from the Design table (`ShowAll`, not `UnHide`, with a comment saying why), and extend `knownRoles`. In the README's menu section, list the roles and say these four are macOS-only (elsewhere Wails makes items that do nothing). Show an own-app-menu example.
- [x] **Step 5: Run the tests.** Same command. Expected: PASS. Also `cd shim && go vet ./...`.
- [x] **Step 6: Commit, push, PR, merge, tag.**
  `git commit -am "wails: services, hide, hide-others and show-all menu roles"`, `git push -u origin wails-app-menu-roles`, `gh pr create --fill`, link the PR (`link_pull_request`) and wait for CI with `watch_pull_request` (no polling or `gh pr checks --watch`), then `gh pr merge --merge` and `unwatch_pull_request`. Then `git checkout master && git pull --ff-only && git tag wails-v0.11.0 && git push origin wails-v0.11.0`. Push that one tag by name.

> Deviation: `go vet ./...` in `wails/shim` fails on a missing go.sum entry (the updater provider) with or without this change, because the shim is built only through lgx. The lgx tests are the check. Released: letgo-packages#23, tag `wails-v0.11.0` on 1e1ef84.

### Task 2: Quel's own app menu

**Files:**
- Modify: `lgx.edn`, `src/quel/menu.lg`, `frontend/src/state/keymap.ts`, `frontend/src/App.tsx`
- Test: `test/quel/menu_test.lg`, `frontend/src/state/keymap.test.ts` (unchanged, must pass)

- [x] **Step 1: Bump the dep.** In `lgx.edn`, `wails-v0.10.0` → `wails-v0.11.0`. Run `env $SRV lgx test` once to fetch and build. Expected: PASS.
- [x] **Step 2: Update the tests first.** `menu_test.lg`: the `"darwin"` spec's first menu is labeled "Quel" and has About Quel…, Check for Updates…, Settings… (`CmdOrCtrl+,`), `:services-menu`, `:hide`, `:hide-others`, `:show-all` and `:quit`. The `"linux"` spec's first menu has none of the four macOS roles. No menu is labeled "Help", and File has no `:quit`. `wails-accepts-the-spec` checks both OS variants. The click count goes from 13 to 15 (about and settings added; check-updates moved).
- [x] **Step 3: Run them and watch them fail.** `env $SRV lgx test`. Expected: menu tests FAIL.
- [x] **Step 4: Implement `menu.lg`.** Add `about!` (`"menu:about"`) and `settings!` (`"menu:settings"`) emitters and an OS-aware `spec` as in the Design. Replace the comment about the app menu taking no items with one describing the own app menu.
- [x] **Step 5: Keymap and events.** `keymap.ts`: `settings` gets `caught: ["menu", "page"]`. `App.tsx`: `onEvent("menu:settings", openSettings)`; `menu:about` is wired in Task 3.
- [x] **Step 6: Run the tests.** `env $SRV lgx test && npm --prefix frontend test`. Expected: PASS, including the keymap drift test.
- [x] **Step 7: Commit.** `git commit -am "Build Quel's own app menu with Settings"`

> Deviation: the codex review of this commit flagged that `menu:about` had no listener yet. Task 3 wires it (next commit, same PR).

### Task 3: About dialog

**Files:**
- Create: `frontend/src/assets/quel-icon.png`, `frontend/src/components/AboutDialog.tsx`, `frontend/src/state/about.ts`, `frontend/src/state/about.test.ts`, `frontend/e2e/about.spec.ts`
- Modify: `src/quel/api.lg`, `frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`, `frontend/src/state/store.ts`, `frontend/src/state/palette.ts`, `frontend/src/state/commands.ts`, `frontend/src/App.tsx`
- Test: `test/quel/api_test.lg`

- [x] **Step 1: The icon.** Downscale `build/macos/icon.png` (1024²) to 256². There's no ImageMagick or PIL here, so use a throwaway Go program in the scratchpad (not the repo): standard library `image/png`, averaging each 4×4 block, including alpha. Write it to `frontend/src/assets/quel-icon.png` and check it with `file` (expect `256 x 256`).
- [x] **Step 2: Backend `app-info`.** Test in `api_test.lg`: `(api/app-info env)` returns `quel.version/version`, a non-blank `:os` and `:arch`. Implement it and register `"app-info"`. Run `env $SRV lgx test`. Expected: PASS.
- [x] **Step 3: State.** `store.ts`: `aboutOpen: false`. `about.ts`: `openAbout` / `closeAbout` / `restoreAboutFocus`, modeled on `state/settings.ts`. `palette.ts`: `modalOpen` includes `s.aboutOpen`. Tests in `about.test.ts`: it opens, and it doesn't open while another modal is open. Run `npm --prefix frontend test`. Expected: PASS.
- [x] **Step 4: Dialog.** `AboutDialog.tsx` as described in the Design. `api.appInfo()` loads once when the dialog opens; until it answers, the version line shows nothing. Check for Updates calls `closeAbout()` and then `checkForUpdates({ manual: true })`. Mount it in `App.tsx` next to the other dialogs, add `onEvent("menu:about", openAbout)`, and add an "About Quel" palette command in `commands.ts`.
- [x] **Step 5: e2e.** `about.spec.ts`: open About from the palette. It shows "Version " plus the version from `VERSION`, a GitHub link, and the Copy version info and Check for Updates buttons. Escape closes it. Run `env $SRV lgx e2e`. Expected: PASS.
- [x] **Step 6: Commit.** `git add -A && git commit -m "Add the About Quel dialog"`

> Deviation: the palette's command ids come from the key registry, so `about` also got a key-less registry entry (Help group). The About dialog's title is "Quel" (the e2e finds it by that name).

### Task 4: Run button clear of the scrollbars

**Files:**
- Create: `frontend/src/editor/useScrollbarInset.ts`, `frontend/e2e/run-button.spec.ts`
- Modify: `frontend/src/components/RunButton.tsx`

- [x] **Step 1: Write the failing e2e.** Type 80 lines, each 400 characters long, into the editor. In Playwright's Chromium on Linux the scrollbars always show, so the editor now scrolls both ways. Read `.cm-scroller`'s box and its scrollbar sizes `vbar = offsetWidth − clientWidth` and `hbar = offsetHeight − clientHeight`. First assert both are > 0; if headless Chromium uses overlay scrollbars, the test is meaningless, so fail with that message rather than passing. Then assert the inset itself, not just clearance (the old 16px/12px offsets could clear a 15px bar by accident): the button's right edge is at `scroller right − vbar − 16` and its bottom edge at `scroller bottom − hbar − 12`, both ±1px. Run `env $SRV lgx e2e`. Expected: FAIL (it overlaps).
- [x] **Step 2: Implement.** Write the hook as in the Design: it takes a ref to the button's wrapper, finds `.cm-scroller` among the wrapper's siblings, and returns `{right, bottom}`. Observe both elements and disconnect on cleanup, with braces in the effect. Wire it into `RunButton` with an inline style.
- [x] **Step 3: Run the tests.** `env $SRV lgx e2e && npm --prefix frontend test`. Expected: PASS.
- [x] **Step 4: Commit.** `git add -A && git commit -m "Keep the Run button clear of the editor's scrollbars"`

> Deviation: Playwright's headless Chromium hides scrollbars (`--hide-scrollbars`), so the spec drops that default argument with `test.use({ launchOptions: { ignoreDefaultArgs: [...] } })`.

### Task 5: Copy icon for Copy row

**Files:**
- Modify: `frontend/src/components/RowDetails.tsx`

- [ ] **Step 1: Implement.** Drop the `icon={<Braces />}` prop on the "Copy row as JSON" button and the `Braces` import.
- [ ] **Step 2: Verify.** `npm --prefix frontend run lint && npm --prefix frontend run build`. Expected: no errors. The row-details e2e still finds the button by its label.
- [ ] **Step 3: Commit.** `git commit -am "Use the copy icon for Copy row as JSON"`

### Task 6: Row details: filter by value, JSON first

**Files:**
- Create: `frontend/src/grid/marks.ts`, `frontend/src/grid/marks.test.ts`
- Modify: `frontend/src/components/RowDetails.tsx`, `frontend/src/grid/JsonCode.tsx`, `frontend/e2e/row-details.spec.ts`

- [ ] **Step 1: Write the failing tests for `matchRanges`.** Case is ignored; ranges don't overlap (`"aaaa"`, `"aa"` → `[[0,2],[2,4]]`); an empty needle gives `[]`; no match gives `[]`; a match at the very end works.
- [ ] **Step 2: Run them and watch them fail.** `npm --prefix frontend test -- marks`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `matchRanges`.** Run the tests again. Expected: PASS.
- [ ] **Step 4: Highlight in `JsonCode`.** Add the optional `ranges` prop and split tokens by a running offset, as in the Design. Add `MarkedText` for plain values in the same file or in `marks.tsx`, whichever keeps `marks.ts` free of JSX.
- [ ] **Step 5: Filter in `RowDetails`.** Work out the shown texts once per row (memoized); filter on name or text, with NULL never matching; pass ranges only for value matches; set the placeholder and `aria-label` to "Filter columns and values"; show the empty line when nothing matches.
- [ ] **Step 6: e2e.** Update `row-details.spec.ts` for the new label. Add a case for a JSON value: typing a key that's only inside the JSON (not a column name) keeps that field, hides the others, and shows a `mark` with the key's text. Typing a plain value keeps its field. Typing `null` does not keep a NULL field. Reuse the spec's existing `doc` JSON literal (SQLite reformats text that starts with `{`, `grid/json.ts` `jsonText`) and search for one of its keys. Run `env $SRV lgx e2e`. Expected: PASS.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "Filter row details by value, with highlights"`

### Task 7: Backend: record Quel's own queries

**Files:**
- Modify: `src/quel/meta.lg`, `src/quel/meta/postgres.lg`, `src/quel/meta/duckdb.lg`, `src/quel/meta/sqlite.lg`, `src/quel/api.lg`, `src/quel/conn.lg`, `scripts/smoke.sh`
- Test: `test/quel/meta_test.lg`, `test/quel/api_test.lg`, `test/quel/conn_test.lg`

- [ ] **Step 1: Write the failing tests.** `meta_test.lg`: `meta/execute!` on an in-memory SQLite db with a `::meta/queries` atom records `{:sql :params :ms :rows}`; a bad SQL records `:error` and rethrows; without the atom it records nothing. `api_test.lg`: `describe-schema` on a temp SQLite connection returns `{:result {...} :queries [non-empty]}`; a failing catalog call throws an ex-info whose data has `:queries`. `conn_test.lg`: opening a DuckDB target returns `:queries` with one `select 1`, and SQLite returns `[]`.
- [ ] **Step 2: Run them and watch them fail.** `env $SRV lgx test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** `meta/execute!`, then swap every `sql/execute!` in `meta/*.lg` (afterwards `grep -n "sql/" src/quel/meta/*.lg` must show no `execute!`, `execute-one!` or `query` call; swap any of those too). Then add `logged` in `api.lg` and use it in the four catalog handlers, and add the ping timing and `:queries` in `conn.lg`. Keep the existing meta tests green: they call the multimethods with a bare db, which records nothing.
- [ ] **Step 4: Update the existing consumers of the four replies.** `test/quel/api_test.lg:166-174` compares `list-schemas`, `describe-schema`, `describe-object` and `completion-schema` against bare values: compare their `:result` instead and check that `:queries` is a vector. The unknown-connection case at `:175` must keep its message (look up the connection outside `logged`, or rethrow with the same message). `scripts/smoke.sh:78-83`: the `describe-schema`/`describe-object` substring checks still pass, but the completion check must read `['result']['schemas']['main']['t']`. Run `grep -rn "describe-schema\|describe-object\|completion-schema\|list-schemas" scripts frontend/e2e test` for any other reader.
- [ ] **Step 5: Run the tests.** `env $SRV lgx test`, `env $SRV lgx smoke`, then `env $SRV lgx test-pg` (Postgres and Redshift catalog paths). Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -am "Record the catalog queries Quel sends"`

### Task 8: Frontend: Quel's queries in Messages

**Files:**
- Create: `frontend/src/state/quelLog.ts`, `frontend/src/state/quelLog.test.ts`, `frontend/e2e/quel-queries.spec.ts`
- Modify: `frontend/src/lib/api.ts`, `frontend/src/lib/api.test.ts`, `frontend/src/lib/types.ts`, `frontend/src/state/store.ts`, `frontend/src/state/runner.ts`, `frontend/src/state/commands.ts`, `frontend/src/components/MessagesView.tsx`, `src/quel/workspace.lg`, `src/quel/api.lg`
- Test: `test/quel/workspace_test.lg`

- [ ] **Step 1: The persisted flag.** In `workspace.lg`, add `quel-queries-hidden` / `set-quel-queries-hidden!` on the flag `"quel-queries-hidden"`; in `api.lg`, the handlers and registry entries (like `sidebar-hidden`). Test them in `workspace_test.lg`. Run `env $SRV lgx test`. Expected: PASS.
- [ ] **Step 2: Write the failing frontend tests.** `api.test.ts`: `describeSchema` unwraps `{result, queries}` and calls the sink with `(connId, queries)`; a rejection with `cause.queries` calls the sink and rethrows the same message; the sink is optional. `quelLog.test.ts`: append goes to the workspace with that `connId` and to no other; the log is capped at `MAX_MESSAGES`; an unknown `connId` is ignored; `loadQuelQueriesHidden` and `toggleQuelQueries` follow `loadSidebar`/`toggleSidebar` in `state/layout.ts` (a toggle made before the read wins; a failed read leaves them shown); the merge for Messages sorts by `at` and keeps the order within a batch.
- [ ] **Step 3: Run them and watch them fail.** `npm --prefix frontend test`. Expected: FAIL.
- [ ] **Step 4: Implement.** Add `QuelQuery` and `Workspace.quelLog: []` to the store (and to wherever workspaces are made), plus `quelQueriesHidden: null`. Add the sink and unwrapping in `api.ts`, keeping the four functions' return types. Write `quelLog.ts` (the sink, `appendQuelQueries(profileId, queries)`, load and toggle, and a `messagesWithQuel(tab, workspace, shown)` merge). Make `runner.ts` append `opened.queries` after the `connId` is set. Load the flag at start-up next to `loadSidebar`/`loadStructure`, and add the palette toggle in `commands.ts`.
- [ ] **Step 5: `MessagesView`.** Add the header row with the "Show Quel's queries" checkbox (shadcn `Checkbox` + `Label`), render the merged list with Quel entries as `<details>` per the Design, and update the empty state. Scroll to the end when the merged list's length changes (braces in the effect).
- [ ] **Step 6: Run the unit tests.** `npm --prefix frontend test && npm --prefix frontend run lint`. Expected: PASS.
- [ ] **Step 7: e2e.** `quel-queries.spec.ts` on the SQLite fixture: connect, open Messages, expand a table in the structure tree, and a "Quel" entry appears whose SQL mentions `pragma` (case-insensitive) and whose text says "rows in". Open the entry and the full SQL shows. Clear the checkbox and the entry goes; the choice holds after a reload. Check the palette command toggles it as well. Run `env $SRV lgx e2e`. Expected: PASS.
- [ ] **Step 8: Commit.** `git add -A && git commit -m "Show Quel's own queries in Messages"`

### Task 9: Docs

**Files:**
- Modify: `docs/DESIGN.md`, `docs/backlog/settings-in-app-menu.md`

- [ ] **Step 1: DESIGN.md.** Describe the app menu (Quel menu items, Help gone), the About dialog, the row details filter on values, Quel's queries in Messages with the toggle, and the Run button inset. Replace the line near 987 about Settings… needing the shim.
- [ ] **Step 2: Backlog.** `settings-in-app-menu.md` → `**Status: done**` with a line saying it landed in Quel's own app menu with wails-v0.11.0 (this plan).
- [ ] **Step 3: Commit.** `git commit -am "Docs: app menu, About, row filter, Quel's queries"`

### Task 10: Backlog the failure-path SQL

**Files:**
- Create: `docs/backlog/quel-queries-failure-paths.md`

- [ ] **Step 1: Write the entry.** Start with `**Status: open**`. Problem: the `select 1` liveness check in `exec/dead?` after a failed run, and the ping of a failed connect, don't show in Messages. Both fail through paths that carry only a message. Possible fix: return the probe on the lost or failed result's ex-data, and log a failed connect's ping in the workspace.
- [ ] **Step 2: Commit on its own.** `git add docs/backlog/quel-queries-failure-paths.md && git commit -m "Backlog: Quel's failure-path queries in Messages"`

### Task 11: Full verification

- [ ] **Step 1:** `env $SRV lgx test && env $SRV lgx test-pg && npm --prefix frontend test && npm --prefix frontend run lint && env $SRV lgx e2e && env $SRV lgx smoke`. Expected: all PASS.
- [ ] **Step 2:** `lgx build` builds the binary. It needs GTK/WebKit headers; if they're missing here, say so instead of skipping silently. The macOS-only menu items can't be checked on Linux. Note in the PR that "About Quel…", Settings… ⌘, and Hide/Show All should be checked on a Mac build (`lgx package-macos && lgx verify-macos`).
