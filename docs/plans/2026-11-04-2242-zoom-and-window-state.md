# Interface Zoom and Remembered Window State Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** View > Zoom In / Zoom Out / Actual Size scales the interface and the level survives a restart; a window left maximised or fullscreen opens that way on the next run.

**Tech Stack:** Wails v3.0.0 through letgo-packages' `wails` package (a new `wails-v0.9.0`), let-go with integrant, the SQLite `settings` table, React + zustand, Vitest, Playwright (server mode).

---

## Design

### What Wails allows

- `SetZoom` scales the whole webview, pixel values included, so the grid's `ROW_H`, the tree and the editor scale without any change, and the virtualizers' scroll math stays right. CSS `zoom` on the root stays ruled out (`docs/backlog/zoom-setting.md`).
- `SetZoom` clamps to at least 1.0 on macOS and on Linux, and `ZoomOut` stops at 1.0. Zooming below 100% needs Objective-C in the shim. This plan does not do that: **the ladder starts at 100%**, and `zoom-below-100.md` goes in the backlog.
- `ZoomIn`/`ZoomOut` step differently per platform (+0.05 on macOS, ×1.10 on Linux), and `GetZoom` passes through a C `float` (1.1 comes back as 1.10000002). Quel keeps its own ladder and never reads the level back.
- macOS ignores `options.Zoom` (the line is commented out in Wails). Before `w/run!` `impl` is nil, so `SetZoom` only stores the option. The saved level therefore has to be applied once the window runs.
- `StartState` is honoured on macOS and Linux, and is set before the window exists, so it is a creation option.
- The green button on macOS enters fullscreen by default (`NSWindowCollectionBehaviorFullScreenPrimary`), while a double-click on the title strip or Option-click maximises. "Max size" therefore covers both states.

### Zoom

- The ladder is `[1.0 1.1 1.25 1.5]`, 100% to 150%. Defaults are already large (15.5px body text). 150% is the top because the window's minimum of 720×480 becomes 480×320 CSS px there, and the title strip's pill and button (24px) still fit a 38pt strip (below). Adding a step later is a one-line change.
- The level lives in the `settings` table under `zoom`, as text. An unreadable value reads as 1.0; a readable one snaps to the nearest step.
- Every path goes through the frontend, as the other menu items do: a menu click emits `menu:zoom-in` / `menu:zoom-out` / `menu:zoom-reset`, and the Command Palette calls the same function, `stepZoom`. It calls the `zoom` handler, which takes `"in"`, `"out"` or `"reset"`, saves the new level, applies it, and answers with it.
- Bridge calls run concurrently and a step reads then writes, so `stepZoom` chains its calls on one promise, like the `saving` chain in `state/layout.ts`.
- At start the frontend calls `restore-zoom`, which applies the saved level and answers with it. The call sits in the same `useEffect` as `loadSidebar`, and goes on the same promise chain as `stepZoom`, so a step made during start-up cannot be overwritten by a late restore.

**Keys.** ⌘= / ⌘- / ⌘0 (Ctrl on Linux) are native accelerators on the View menu, with no page keydown handler. A zoom step is not idempotent, so the double delivery that `App.tsx` tolerates for Run and the palettes would step twice. The accelerator is `=`, not `Plus`: the unshifted key must work on US and Russian layouts. Whether ⇧⌘= also lands on it is a macOS check in Task 7. If it does not, add a shift-only `+` key: a `zoom-in` kind in the `Shortcut` union, a clause in `shortcutOf`, its dispatch in `useGlobalKeys`, and a case in `shortcuts.test.ts`.

**The title strip.** A 38px strip matches the 38pt band macOS centres the traffic lights in. Under zoom the strip would scale while the lights do not, so it would outgrow the band and the lights would sit high. The frontend sets `--zoom` on the root element, and on macOS `TitleBar.tsx` divides the height by it: `h-[calc(38px/var(--zoom,1))]`. At 150% that is 25.3 CSS px, which still holds the 24px pill and button. Other platforms keep `h-[38px]`: the height exists for the lights. The `px-40` padding stays as it is. It only grows in pt, so it still clears the lights, and on the right it clears the Update button, which scales with the page.

### Window state

- The `settings` row `window-state` holds `maximised` or `fullscreen`; there is no row for a normal window, matching `sidebar-hidden`.
- `:quel.shell/window` gets a `:store` ref and passes `:start-state` to `w/new-window`.
- A debounced (400 ms) frontend `resize` listener calls `save-window-state`, and the handler asks the window with `w/fullscreen?` and `w/maximised?`. Fullscreen is checked first, as a fullscreen window may also report as zoomed.
- Resize events cover every route on both platforms: the green button, a title-strip double-click, a window manager's snap. They need no native event plumbing. Saving at shutdown does not work: with `:quit-on-last-window-closed` the window is gone by then and `IsMaximised` answers false.
- Only the state is remembered, not the normal window's size or position. That was not asked for. Coming out of a remembered state returns the window to the default 1200×800.

### Upstream: `wails-v0.9.0`

Everything is a thin pass-through in the shape of the existing window controls:

| let-go | Shim | Notes |
|---|---|---|
| `new-window` `:start-state` | `o.StartState` | `:normal`, `:maximised` or `:fullscreen`; keyword or string; an unknown value throws, as `:mac-title-bar` does |
| `(set-zoom! win level)` | `SetZoom(w, float64)` | Documents the clamp at 1.0 and that it needs a running window |
| `(maximised? win)` | `IsMaximised(w) bool` | False in server mode |
| `(fullscreen? win)` | `IsFullscreen(w) bool` | False in server mode |

`:minimised` is left out: nothing here needs it.

### Testing

The ladder and the settings are pure or database-backed, so backend tests cover them. Server mode has no real window: `set-zoom!` is a no-op there and both predicates answer false, so the handlers run end to end and e2e can assert the level through `--zoom`. What a native window does cannot be checked on Linux, so Task 7 ends with a manual macOS checklist.

## File Structure

**Upstream, `~/Projects/letgo-packages/wails`:**
- Modify `shim/window.go`: the `:start-state` option, `SetZoom`, `IsMaximised`, `IsFullscreen`.
- Modify `src/wails/core.lg`: `set-zoom!`, `maximised?`, `fullscreen?`, the `new-window` docstring.
- Modify `README.md`, `test/wails/window_test.lg`.

**Quel:**
- Modify `lgx.edn`: `wails-v0.9.0`.
- Create `src/quel/window.lg`: the ladder, the zoom and window-state settings, and the pure helpers. Nothing here calls Wails.
- Create `test/quel/window_test.lg`.
- Modify `src/quel/shell.lg`, `src/quel/system.lg`, `test/quel/system_test.lg`: the window's start state and the `:window` ref for the handlers.
- Modify `src/quel/api.lg`, `test/quel/api_test.lg`: `zoom`, `restore-zoom`, `save-window-state`.
- Modify `src/quel/menu.lg`, `test/quel/menu_test.lg`: the View menu items.
- Modify `scripts/smoke.sh`: the three handlers.
- Modify `frontend/src/lib/api.ts`: three typed calls.
- Create `frontend/src/state/window.ts`, `frontend/src/state/window.test.ts`: `loadZoom`, `stepZoom`, `watchWindowState`.
- Modify `frontend/src/App.tsx`, `frontend/src/components/keys.ts`, `frontend/src/state/commands.ts`, `frontend/src/state/commands.test.ts`, `frontend/src/components/TitleBar.tsx`, `frontend/e2e/palette.spec.ts`.
- Modify `docs/DESIGN.md`, `docs/backlog/zoom-setting.md`; create `docs/backlog/zoom-below-100.md`.

## Part 1: upstream (letgo-packages)

### Task 1: Zoom and window state in the `wails` package

**Files:**
- Modify: `~/Projects/letgo-packages/wails/shim/window.go`
- Modify: `~/Projects/letgo-packages/wails/src/wails/core.lg`
- Modify: `~/Projects/letgo-packages/wails/README.md`
- Test: `~/Projects/letgo-packages/wails/test/wails/window_test.lg`

- [x] **Step 1: Branch.** Run: `cd ~/Projects/letgo-packages && git switch master && git pull --ff-only && git switch -c wails-zoom-window-state`.

- [x] **Step 2: Add the failing tests to `window_test.lg`.** `new-window` takes `:normal`, `:maximised`, `:fullscreen` and the string `"maximised"`; `:sideways` and `1` throw a message naming `:start-state`, following `new-window-refuses-an-unknown-mac-title-bar`. `set-zoom!` answers nil for `1.25` and for the integer `1`. `maximised?` and `fullscreen?` answer false in server mode.

- [x] **Step 3: Run them to see them fail.** Run: `cd ~/Projects/letgo-packages/wails && CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`. Expected: FAIL on the new tests only.

- [x] **Step 4: Implement the shim.** In `NewWindow`, call a `startState(opts)` helper shaped like `macTitleBar`, mapping `normal`, `maximised` and `fullscreen` to `application.WindowState*`, defaulting to normal, and returning an error that lists the values. Add `SetZoom`, `IsMaximised` and `IsFullscreen` next to the other pass-throughs.

- [x] **Step 5: Implement `core.lg`.** Add `:start-state` to the `new-window` docstring. Add `set-zoom!`, which passes `(double level)` so an integer works; its docstring says Wails clamps below 1.0 and that before `run!` the level is not applied on macOS. Add `maximised?` and `fullscreen?`. Add the new fns to `README.md` wherever it lists the window controls.

- [x] **Step 6: Run the tests.** Run: `cd ~/Projects/letgo-packages/wails && CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`. Expected: PASS.

- [x] **Step 7: Commit, push, open the PR.** Commit with `git commit -m "wails: start state, zoom and maximised/fullscreen checks"`, push the branch and open a PR against `abogoyavlensky/letgo-packages`. Once its checks pass, merge it and push the `wails-v0.9.0` tag (one tag, by name). The user authorized both for this plan when approving it. Part 2 needs the tag.

> Deviation: the shim also needed `ns.Def` entries in `shim/shim.go`; the plan named only `window.go`. Merged as PR #19 (`493a6df`), tag `wails-v0.9.0` pushed.

## Part 2: Quel

### Task 2: Move to `wails-v0.9.0`

**Files:**
- Modify: `lgx.edn`

- [x] **Step 1: Confirm the branch.** Run: `git branch --show-current`. Expected: `zoom-and-window-state`, which holds this plan's commit. Run `git merge --ff-only origin/master` if master has moved.

- [x] **Step 2: Bump the tag.** In `lgx.edn`, change `abogoyavlensky/letgo-wails` to `:git/tag "wails-v0.9.0"`.

- [x] **Step 3: Run the backend tests.** Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`. Expected: PASS.

- [x] **Step 4: Commit.** `git commit -am "Move to wails-v0.9.0"`

> Deviation: skipped the blocking review for this one-line tag bump.

### Task 3: The ladder and the settings

**Files:**
- Create: `src/quel/window.lg`
- Test: `test/quel/window_test.lg`

The namespace holds these, and requires only `sql.core`:

```clojure
(def zoom-levels [1.0 1.1 1.25 1.5])

(zoom-level db)              ; the saved level on the ladder, else 1.0
(save-zoom! db level)        ; upsert the `zoom` row; delete the row at 1.0
(next-zoom level direction)  ; "in" | "out" | "reset"; stops at the ends;
                             ; another direction throws
(start-state db)             ; :normal | :maximised | :fullscreen
(save-start-state! db state) ; upsert `window-state`; delete the row at :normal
(state-of maximised? fullscreen?) ; fullscreen wins, then maximised, else :normal
```

- [x] **Step 1: Write the failing tests** in `test/quel/window_test.lg`, using a temp `:dir` store as `workspace_test.lg` does. Cover:
  - `next-zoom` walks up to 1.5 and stays there, walks down to 1.0 and stays there, `"reset"` answers 1.0 from anywhere, and an unknown direction throws.
  - A fresh database reads 1.0 and `:normal`.
  - Both settings round-trip, and the default values leave no row.
  - A stored `"1.2"` snaps to 1.25, and `"abc"` reads 1.0. Write these straight with `sql/execute!`.
  - A stored `window-state` of `"sideways"` reads `:normal`.
  - `state-of` for all four inputs.

- [x] **Step 2: Run them to see them fail.** Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`. Expected: FAIL, `quel.window` not found.

- [x] **Step 3: Implement `src/quel/window.lg`.** `parse-double` answers nil for unreadable text. Snap by the smallest absolute difference. Upsert as `set-sidebar-hidden!` does. Add a header comment on why zoom is capped at 150% and starts at 100%, and update the `settings` comment at the top of `workspace.lg`, which lists what the table keeps.

- [x] **Step 4: Run the tests.** Same command. Expected: PASS.

- [x] **Step 5: Commit.** `git commit -m "Add the zoom ladder and window-state settings"`

### Task 4: Start state, handlers, wiring

**Files:**
- Modify: `src/quel/shell.lg`, `src/quel/system.lg`, `src/quel/api.lg`, `scripts/smoke.sh`
- Test: `test/quel/system_test.lg`, `test/quel/api_test.lg`

The handlers, all registered by var in the `handlers` map:

```clojure
(defn zoom [{:keys [store window]} direction]
  (let [level (window/next-zoom (window/zoom-level store) direction)]
    (window/save-zoom! store level)
    (w/set-zoom! window level)
    level))

(defn restore-zoom [{:keys [store window]}]
  (let [level (window/zoom-level store)]
    (w/set-zoom! window level)
    level))

(defn save-window-state [{:keys [store window]}]
  (window/save-start-state! store (window/state-of (w/maximised? window) (w/fullscreen? window)))
  nil)
```

- [x] **Step 1: Write the failing tests.**
  - In `system_test.lg`, `:quel.shell/window` has `:store` as a ref to `:quel.store/db`, and `:quel.api/handlers` has `:window` as a ref to `:quel.shell/window`.
  - In `api_test.lg`, add the three names to `every-handler-is-a-var`. Add a hidden `:window` to `with-env`, built like `menu_test.lg`'s `app`: a `defonce` delay of `(w/new-app {:name "quel-test"})`, then `(w/new-window app {:hidden true})`.
  - New test: `zoom` with `"in"` answers 1.1 and `restore-zoom` then answers 1.1. `"reset"` answers 1.0. `save-window-state` leaves `:normal` in server mode.

- [x] **Step 2: Run them to see them fail.** Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`. Expected: FAIL on the new assertions.

- [x] **Step 3: Wire the start state.** In `system.lg`, add `:store (ig/ref :quel.store/db)` to `:quel.shell/window` and `:window (ig/ref :quel.shell/window)` to `:quel.api/handlers`. In `shell.lg`, `::window` drops `:store` along with `:app` and adds `:start-state (window/start-state store)`, requiring `quel.window`. Keep the comment above it accurate.

- [x] **Step 4: Add the handlers to `api.lg`** and register them as `"zoom"`, `"restore-zoom"` and `"save-window-state"`.

- [x] **Step 5: Run the tests.** Same command. Expected: PASS.

- [x] **Step 6: Extend `scripts/smoke.sh`.** After the existing checks: `call zoom '["in"]'` contains `1.1`, `call restore-zoom '[]'` contains `1.1`, `call zoom '["reset"]'` contains `1`, and `call save-window-state '[]'` answers nothing, using the script's `nothing` helper.

- [x] **Step 7: Run the smoke test.** Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx smoke`. Expected: PASS.

- [x] **Step 8: Commit.** `git commit -am "Open the window in its saved state and add the zoom handlers"`

### Task 5: The View menu

**Files:**
- Modify: `src/quel/menu.lg`
- Test: `test/quel/menu_test.lg`

- [x] **Step 1: Update the tests.** `every-item-with-a-click-has-one` expects 13. Add `"Zoom In"`, `"Zoom Out"` and `"Actual Size"` to the labels. Add an assertion for the three accelerators, as the test around line 39 does for others.

- [x] **Step 2: Run them to see them fail.** Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`. Expected: FAIL on the count and the labels.

- [x] **Step 3: Add the items.** Add `zoom-in!`, `zoom-out!` and `zoom-reset!` as `emitter`s of `menu:zoom-in`, `menu:zoom-out` and `menu:zoom-reset`. Below the palette items in View, add a separator and then Zoom In (`CmdOrCtrl+=`), Zoom Out (`CmdOrCtrl+-`) and Actual Size (`CmdOrCtrl+0`), each `(partial #'x env)`. Add a comment that these have no page key, because a step cannot take the double delivery.

- [x] **Step 4: Run the tests.** Same command. Expected: PASS, including `wails-accepts-the-spec`, which proves Wails parses the accelerators.

- [x] **Step 5: Commit.** `git commit -am "Add zoom items to the View menu"`

> Deviation: Tasks 4 and 5 were reviewed together, as one Codex pass over both commits. Its two findings were the missing frontend wiring, which is Task 6.

### Task 6: The frontend

**Files:**
- Create: `frontend/src/state/window.ts`
- Test: `frontend/src/state/window.test.ts`, `frontend/src/state/commands.test.ts`, `frontend/e2e/palette.spec.ts`
- Modify: `frontend/src/lib/api.ts`, `frontend/src/App.tsx`, `frontend/src/components/keys.ts`, `frontend/src/state/commands.ts`, `frontend/src/components/TitleBar.tsx`

```ts
// frontend/src/lib/api.ts
export type ZoomDirection = "in" | "out" | "reset";
export const zoom = (direction: ZoomDirection) => call<number>("zoom", direction);
export const restoreZoom = () => call<number>("restore-zoom");
export const saveWindowState = () => call<void>("save-window-state");

// frontend/src/state/window.ts
export const WINDOW_STATE_DELAY_MS = 400;
export function loadZoom(): Promise<void>;             // restore-zoom on the chain, then set --zoom; a failure is dropped
export function stepZoom(direction: api.ZoomDirection): void; // on the same chain; sets --zoom from the reply; a failure is dropped
export function watchWindowState(): () => void;        // debounced resize listener; returns its remover
```

- [x] **Step 1: Write the failing tests** in `state/window.test.ts`, mocking `@/lib/api`:
  - `stepZoom` sets `--zoom` on `document.documentElement` to the reply.
  - Two quick calls run one after the other: the second `api.zoom` starts only once the first resolves.
  - A `stepZoom` made while `loadZoom` is pending runs after the restore, so `--zoom` ends at the step's reply.
  - A rejected call neither throws nor stops the next one.
  - With fake timers, several `resize` events make one `saveWindowState` call 400 ms after the last.
  - The remover stops that, including a pending save.

- [x] **Step 2: Run them to see them fail.** Run: `npm --prefix frontend test`. Expected: FAIL, `./window` not found.

- [x] **Step 3: Implement `lib/api.ts` and `state/window.ts`.** A failed `saveWindowState` is dropped.

- [x] **Step 4: Run the tests.** Same command. Expected: PASS.

- [x] **Step 5: Wire `App.tsx`.** In `useMenu`, add `menu:zoom-in`, `menu:zoom-out` and `menu:zoom-reset` calling `stepZoom`. In `App`'s start-up effect, add `void loadZoom();`. Add a `useEffect(() => watchWindowState(), [])`. It returns a function, the remover, which is the cleanup React expects, so the braces rule in `AGENTS.md` does not apply; write it as `return watchWindowState();` inside braces anyway, like the update checks' effect.

- [x] **Step 6: Add the palette entries.** In `keys.ts`, add `ZOOM_IN_KEY` (`⌘=`, `Ctrl+=`), `ZOOM_OUT_KEY` (`⌘-`, `Ctrl+-`) and `ZOOM_RESET_KEY` (`⌘0`, `Ctrl+0`). In `commands.ts`, add `zoom-in`, `zoom-out` and `zoom-reset` to the View group, after `sidebar`, always available, with `keepsFocus: true`. Titles: Zoom In, Zoom Out, Actual Size. In `commands.test.ts`, mock `./window` and add the ids wherever a test lists the expected ids exactly.

- [x] **Step 7: Adjust the title strip.** In `TitleBar.tsx`, use `h-[calc(38px/var(--zoom,1))]` when `isMac` and `h-[38px]` otherwise. Tailwind needs both class strings written out in full. Leave `px-40` alone, and extend the comment above the component.

- [x] **Step 8: Add the e2e test** to `palette.spec.ts`: through the palette, Zoom In leaves `--zoom` at `1.1` on the root element; after `page.reload()` it reads `1.1` again; Actual Size brings it back to `1`. The reset also keeps the shared data dir at the default for later tests.

- [x] **Step 9: Run everything.** Run: `npm --prefix frontend test && npm --prefix frontend run build && CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e`. Expected: PASS.

- [x] **Step 10: Check the narrowest layout.** 480×320 is what the minimum window gives at 150%. With Playwright, or the running server-mode app, at a 480×320 viewport, confirm the tab strip and the Run button are reachable. If they are not, drop 1.5 from `zoom-levels` rather than reworking the layout: update `window.lg`'s comment, the ladder tests, and the 150% references in this plan's Task 7 checklist.

- [x] **Step 11: Commit.** `git add -A frontend && git commit -m "Zoom from the menu and palette and save the window state"`

> Deviation: `window.test.ts` stubs `document` and `window` with `vi.stubGlobal`, as Vitest runs under Node here. The 480×320 check passed, so 150% stayed.

### Task 7: Docs, backlog, macOS check

**Files:**
- Modify: `docs/DESIGN.md`, `docs/backlog/zoom-setting.md`
- Create: `docs/backlog/zoom-below-100.md`

- [x] **Step 1: Backlog the gap, as its own commit.** Create `docs/backlog/zoom-below-100.md`, starting with `**Status: open**`: Wails clamps `SetZoom` to at least 1.0, so Quel cannot zoom below 100%. The fix is a darwin-only cgo file in the wails shim that sets `pageZoom` on the window's `webView`, plus lower steps on the ladder. Commit with `git commit -m "Backlog: zoom below 100%"`.

- [x] **Step 2: Update `docs/DESIGN.md`.** In **The window**, say that on macOS the strip's height divides by `--zoom` to keep the traffic lights centred, so it is 38pt rather than 38px. In **Sizes** or next to it, add the ladder and why it stops at 100% and 150%. Add `quel.window` to the namespace table. Add the window state: both states, saved on a debounced `resize`, restored through `:start-state`.

- [x] **Step 3: Mark the zoom entry done.** In `docs/backlog/zoom-setting.md`, set `**Status: done**` with a line saying where it landed, naming this plan and `zoom-below-100.md`. Commit with `git commit -am "Document zoom and the remembered window state"`.

- [ ] **Step 4: Ask the user for the macOS check.** None of this can be checked on Linux. Report what passed, then ask them to run `lgx run` on a Mac and confirm each of these:
  1. ⌘= zooms in one step and ⌘- zooms out one step, including with focus in the editor. ⌘0 returns to 100%. The menu items work too.
  2. ⇧⌘= also zooms in, by one step. If it does nothing, add the shift-only `+` key described under **Keys** in the Design.
  3. The level survives a quit and start, with no distracting jump at start.
  4. At 150% the traffic lights stay centred on the strip, and the pill clears them.
  5. Maximise (double-click the strip), quit, start: the window opens maximised. Then restore it: it should come back at 1200×800, centred. Wails centres the window after applying the start state, so check this one with care. If it misbehaves, add `w/maximise!` upstream and apply the state after the window runs.
  6. The same round trip with the green button (fullscreen).
  7. Fullscreen from maximised, then back out, quit, start: the window opens in the state it was left in.
  8. A normal window still opens normal.

> Deviation: `TaskCreate` was unavailable in the session, so this document was the only progress record.

## Rollout notes

No migration: both settings are rows in the existing `settings` table. An older build ignores them.

## Completion summary

**Status: code complete; the macOS check (Task 7 Step 4) is open.** The branch is not pushed.

- **Upstream:** `wails-v0.9.0` (letgo-packages PR #19, merged as `493a6df`) adds `:start-state`, `set-zoom!`, `maximised?` and `fullscreen?`.
- **Quel:** `quel.window` holds the ladder and settings. View > Zoom In / Zoom Out / Actual Size and the Command Palette step 100–150%, the level survives a restart, and a window left maximised or fullscreen reopens that way. On macOS the title strip stays 38pt under zoom.
- **Verified:** on Linux in server mode, 188 backend tests, 496 frontend tests, 30 e2e specs (1 skipped), smoke, the 480×320 layout, and a native `lgx build` with the server tag. Native zoom, the accelerators and the window restore are not verified: they need the Mac.
- **Issues:** none beyond the deviation notes above. Codex's reviews found no must-fix defects.

**Deviations:**
- The upstream shim also needed `ns.Def` entries in `shim/shim.go`.
- Task 2's one-line tag bump had no review, and Tasks 4 and 5 shared one.
- `window.test.ts` stubs globals, as Vitest runs under Node.
- `TaskCreate` was unavailable, so the plan was the only tracker.

**What the plan could have specified better:** that `lgx` needs `mise exec --` from a non-interactive shell, and that new shim functions are registered in `shim.go`.
