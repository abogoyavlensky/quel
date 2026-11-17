# Remember the Window's Frame Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quel reopens at the size and position it was left at, so a window that filled the screen opens filling it again. A window left maximised or fullscreen still opens that way.

**Tech Stack:** let-go (lgx), Wails v3 (`v3.0.0-beta.30`) through the `wails` package in letgo-packages, React + TypeScript, Vitest.

---

## Design

### The problem

Quel saves only a flag, `window-state` = `maximised` or `fullscreen` (`src/quel/window.lg:59-71`). The flag comes from Cocoa's `isZoomed` (`webview_window_darwin.go:545` in Wails). Every other window opens at the default 1200×800. On macOS there are several ways to fill the screen that are not "zoom":

- Fill, from the green button's menu or Window > Fill;
- dragging the window to the top edge (tiling);
- the double-click setting "Fill" (Wails' own double-click handler does nothing for it: `titlebar_doubleclick_action.go:11-19`);
- resizing the window by hand.

For all of them `isZoomed` answers false, Quel saves "normal", and the next start opens at 1200×800.

### Behaviour

- **A normal window** reopens at the size and position it was left at. This covers every route above: a filled or tiled window is a normal window the size of the screen.
- **A maximised or fullscreen window** reopens that way, through `:start-state`, as now. Its saved frame is the normal frame from before it was maximised. Restoring the window brings that frame back, size and position, not 1200×800 centred.
- **A frame that no longer fits** is pulled inside the work area of the screen the window is on, or of the primary screen when it is on none (a display that was unplugged). The size shrinks to the work area first, then the position moves inside it. A window left partly off-screen on purpose comes back fully on screen. That is accepted.
- **No saved frame** (a fresh install, or the frame was never saved): 1200×800, centred, as now.
- Tiled windows are not restored as tiled. AppKit has no public API for that, and a frame the same size looks the same.

### Data

A new `settings` row, `window-frame`, holds `"x,y,width,height"`: four integers in Wails' coordinates. On macOS these are points from the top-left of the primary screen, the same system as `Screen.WorkArea`. The row is written only while the window is normal and its bounds are non-zero; server mode and a destroyed window answer zeros. It is never deleted. An unreadable row reads as no frame. No migration: an older build ignores the row.

### Saving

- `watchWindowState` (`frontend/src/state/window.ts`) already debounces the DOM `resize` event by 400 ms and calls `save-window-state`. A move fires no `resize`, so it also listens to Wails' `common:WindowDidMove` through `onEvent` (`frontend/src/lib/bridge.ts`). Wails maps `mac:WindowDidMove` to it (`events/defaults.go:35`) and sends every window event to the page (`dispatchWindowEvent`, `webview_window.go:1608`). GTK4 sends no move event, so Linux saves on resize only. Linux is a development platform, so that is acceptable.
- `save-window-state` saves the state as now. When the state is `:normal`, it also saves `(w/bounds window)`, unless the bounds are all zero. While maximised or fullscreen the frame is left alone, so the normal frame survives.
- **Leaving maximised or fullscreen.** When the saved state is `:maximised` or `:fullscreen` and the window now reads `:normal`, the window has just been restored. Then `save-window-state` does not save the current bounds. It applies the saved frame instead, through the same fit-and-`set-bounds!` path as `restore-window-frame`, and then records `:normal`. This matters for a session that started maximised or fullscreen: Cocoa restores the frame it had when it was zoomed, which is the uncorrected creation frame, centred. In a session that was maximised during use, Cocoa restores the frame from before the zoom, which equals the saved frame, so the call changes nothing. The `set-bounds!` fires another `resize`, and that save is normal to normal, so it records the frame as is.

### Restoring, in two steps

1. **At creation** (`:quel.shell/window`). A pure `window/start-opts` turns the saved state and frame into `new-window` options:
   - `:start-state` as now;
   - `:width`/`:height` from the frame, raised to at least the minimum (720×480);
   - `:x`/`:y` only when the state is `:normal`.

   Wails applies the start state first and then the position (`webview_window_darwin.go:1727-1747`). Passing `:x`/`:y` with `:maximised` would push a zoomed window off its zoomed frame. Without them, Wails centres it, which is today's behaviour and passed the Mac check.
2. **Once the window runs.** The frontend calls `restore-window-frame` at start, next to `loadZoom()` in `App.tsx`. When the state is `:normal` and a frame is saved, the handler moves the window to the saved frame if it is not there already. It then fits the frame into the work area of the screen the window is now on, with `window/fit-frame`, and calls `w/set-bounds!` again only if the fit changed it. Moving first matters when leaving a maximised start (below): the window then sits on the main display, not necessarily the frame's. The fit cannot happen at creation for two reasons:
   - Wails caches the screen list only after the app finishes launching (`application_darwin.go:337`), and integrant builds the window before `w/run!`.
   - The frame Wails builds from `:width`/`:height` is not exactly that size on macOS: `createNativeWindow` asks for a content rect of `width-1` × `height-1`, and the title bar is added to that. Without the correction the size would drift on every run.

   On macOS the window is shown only once the page finishes loading (`webview_window_darwin.go:1759-1768`), so the correction usually lands before the window appears, or as it does.

`fit-frame` is pure, and a frame that already fits is returned unchanged:

```clojure
;; frame and area are {:x :y :width :height}; area nil -> frame as is.
(let [w (min width (:width area)) h (min height (:height area))]
  {:width w :height h
   :x (-> x (max (:x area)) (min (- (+ (:x area) (:width area)) w)))
   :y (-> y (max (:y area)) (min (- (+ (:y area) (:height area)) h)))})
```

### Upstream: `wails-v0.10.0`

These are thin pass-throughs in the shape of the existing window controls (`shim/window.go`), each registered in `shim/shim.go` with `ns.Def`:

| let-go | Shim | Notes |
|---|---|---|
| `new-window` `:x`, `:y` | `o.X`, `o.Y`, `o.InitialPosition = application.WindowXY` | Both or neither: one alone throws, naming `:x` and `:y`. Without them the window centres, as now. |
| `(bounds win)` | `Bounds(w) map` | `{:x :y :width :height}`. All zero in server mode and once the window is gone. |
| `(set-bounds! win frame)` | `SetBounds(w, x, y, width, height)` | The let-go fn takes the map and passes four ints. The shim calls `w.SetSize` first and then `w.SetPosition`, not Wails' `SetBounds`. On macOS that one positions first, using the old height, and then resizes from the bottom-left corner (`webview_window_darwin.go:330`, `:1873-1877`), so a change in height would move the top edge. `windowSetSize` animates synchronously, so the position lands after it. No-op in server mode. |
| `(work-area win)` | `WorkArea(w) map-or-nil` | The work area of the window's screen (`w.GetScreen()`), in the same units as `bounds`. When the window is on no screen (zero work area), the primary screen's (`application.Get().Screen.GetPrimary()`, which Wails has already scaled to DIPs). nil when neither is known; server mode's `GetScreen` errors, so it answers nil there. |

**Units of `work-area`.** On macOS, `GetScreen` returns the work area multiplied by the backing scale factor (`cScreenToScreen`, `screen_darwin.go:207-247`), while window bounds are in points. On a Retina display the area would come back twice too large. GTK4's `getScreen` already answers logical pixels (`linux_cgo.go:1064`). The shim therefore normalises in a platform file pair: `shim/screen_darwin.go` divides each `WorkArea` field by `ScaleFactor` and rounds, and `shim/screen_other.go` (`//go:build !darwin`) returns `WorkArea` as is. Both define one `windowWorkArea(s *application.Screen) application.Rect`. The primary-screen fallback comes from Wails' cache, which is already in DIPs, so it is not divided.

A map comes back as a let-go map with keyword keys. Follow the updater's pattern: the shim returns `FromJSON(map[string]any{...})` (`shim/updater.go:120`), which gives string keys, and `core.lg` runs it through its private `keywordize` (`core.lg:198`), as `check-update` does. `optInt` (`shim/convert.go:93`) answers `ok` false for a missing key and for a non-integer alike, so `position` checks `opt(opts, "x") != nil` to tell "absent" from "wrong type".

### Testing

- **Backend unit tests (`quel.window`):** frame round-trip, unreadable rows, `start-opts` in each state, `fit-frame` (fits, too big, off each edge, nil area).
- **Backend API tests:** in server mode, bounds are zero and the work area is nil. So `save-window-state` saves no frame there, and `restore-window-frame` is a callable no-op. Backend tests use the memory store, as `api_test.lg` already does.
- **Frontend tests:** the watcher saves after a `common:WindowDidMove` event as it does after a `resize`.
- **Upstream tests:** the new option and fns in server mode.
- **Manual macOS check (last task):** what a native window does cannot be checked on Linux.

### Decisions to veto

- **Position is restored too, not only size.** Users expect it, and it costs nothing extra once bounds exist.
- **The fit happens after the window runs**, with a possible small correction as it appears, rather than a hidden window shown after the fit. A hidden window that the frontend must show risks a window that never appears if the page fails to load.
- **Merging the upstream PR and pushing the `wails-v0.10.0` tag** (one tag, by name) are part of this plan. Approving the plan authorises both, as for `wails-v0.9.0`.

## File Structure

**Upstream, `~/Projects/letgo-packages/wails`:**
- Modify `shim/window.go`: the `:x`/`:y` options, `Bounds`, `SetBounds`, `WorkArea`.
- Create `shim/screen_darwin.go`, `shim/screen_other.go`: `windowWorkArea`, the work area in the units of the window's bounds.
- Modify `shim/shim.go`: `ns.Def` for the three new fns.
- Modify `src/wails/core.lg`: `bounds`, `set-bounds!`, `work-area`, the `new-window` docstring.
- Modify `README.md`, `test/wails/window_test.lg`.

**Quel:**
- Modify `lgx.edn`: `wails-v0.10.0`.
- Modify `src/quel/window.lg`, `test/quel/window_test.lg`: the frame setting, `start-opts`, `fit-frame`.
- Modify `src/quel/shell.lg`: options from `window/start-opts`.
- Modify `src/quel/api.lg`, `test/quel/api_test.lg`: the frame in `save-window-state`; the new `restore-window-frame` handler.
- Modify `scripts/smoke.sh`: call `restore-window-frame`.
- Modify `frontend/src/lib/api.ts`: `restoreWindowFrame`.
- Modify `frontend/src/state/window.ts`, `frontend/src/state/window.test.ts`: the move listener.
- Modify `frontend/src/App.tsx`: call `restoreWindowFrame` at start.
- Modify `docs/DESIGN.md`: the window state paragraph (around line 661) and the `quel.window` row (line 134).

## Part 1: upstream (letgo-packages)

### Task 1: Bounds, work area and position in the `wails` package

**Files:**
- Modify: `~/Projects/letgo-packages/wails/shim/window.go`
- Modify: `~/Projects/letgo-packages/wails/shim/shim.go`
- Modify: `~/Projects/letgo-packages/wails/src/wails/core.lg`
- Modify: `~/Projects/letgo-packages/wails/README.md`
- Test: `~/Projects/letgo-packages/wails/test/wails/window_test.lg`

- [ ] **Step 1: Branch.** Run: `cd ~/Projects/letgo-packages && git switch master && git pull --ff-only && git switch -c wails-window-bounds`.

- [ ] **Step 2: Write the failing tests** in `window_test.lg`, next to the start-state tests:
  - `new-window` takes `{:hidden true :x 10 :y 20}`.
  - `:x` alone and `:y` alone throw a message naming `:x`, following `new-window-refuses-an-unknown-start-state`.
  - A non-integer `:x` (`"left"`) also throws.
  - In server mode, `(w/bounds win)` is `{:x 0 :y 0 :width 0 :height 0}`, `(w/set-bounds! win {:x 1 :y 2 :width 300 :height 200})` is nil, and `(w/work-area win)` is nil.

- [ ] **Step 3: Run them to see them fail.** Run: `cd ~/Projects/letgo-packages/wails && CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`. Expected: FAIL on the new tests only. If the server tag needs cgo on this box, use `CGO_ENABLED=1` as AGENTS.md describes.

- [ ] **Step 4: Implement the shim.**
  - In `NewWindow`, add a `position(opts)` helper shaped like `startState`. It reads `x` and `y` with `optInt`; with both it sets `o.X`, `o.Y` and `o.InitialPosition = application.WindowXY`; with neither it leaves the defaults; anything else returns an error naming `:x` and `:y`. `optInt` reports a missing key and a non-integer the same way, so test presence with `opt(opts, "x") != nil`, then require `optInt` to succeed; that way `"left"` is refused rather than ignored.
  - Add `Bounds` and `WorkArea` next to `IsMaximised`. In `WorkArea`, pass the window's screen through `windowWorkArea`. Treat an error from `GetScreen`, a nil screen and a zero-width work area alike: fall back to `application.Get().Screen.GetPrimary().WorkArea`, and return nil if that is nil too.
  - Add `SetBounds`: `w.SetSize(width, height)`, then `w.SetPosition(x, y)`. Comment why it does not call Wails' `SetBounds` (see the Design).
  - Create `shim/screen_darwin.go` and `shim/screen_other.go` with `windowWorkArea`, as the Design describes. Comment in the darwin file that it undoes `cScreenToScreen`'s multiplication.
  - Register all three in `shim.go` with `ns.Def`, next to `IsFullscreen`.

- [ ] **Step 5: Implement `core.lg`.** Add `:x`/`:y` to the `new-window` docstring ("both or neither; without them the window centres"). Add `bounds`, `set-bounds!` (takes the map and passes four ints) and `work-area`. Each docstring says what server mode answers, like `maximised?`. Add them to the window controls in `README.md`.

- [ ] **Step 6: Run the tests.** Run: `cd ~/Projects/letgo-packages/wails && CGO_ENABLED=0 GOFLAGS=-tags=server lgx test`. Expected: PASS.

- [ ] **Step 7: Commit, push, open the PR, merge, tag.** Stage the new files too: `git add shim/screen_darwin.go shim/screen_other.go && git commit -am "wails: window bounds, work area and initial position"`. Push the branch and open a PR against `abogoyavlensky/letgo-packages`. Once its checks pass, merge it. Then on the updated master: `git tag wails-v0.10.0 && git push origin wails-v0.10.0` (one tag, by name). Part 2 needs the tag.

## Part 2: Quel

### Task 2: Branch and move to `wails-v0.10.0`

**Files:**
- Modify: `lgx.edn`

- [ ] **Step 1: Confirm the branch.** Run: `git branch --show-current`. Expected: `remember-window-frame`, which holds this plan's commit. Run `git merge --ff-only origin/master` if master has moved.

- [ ] **Step 2: Bump the tag.** In `lgx.edn`, change `abogoyavlensky/letgo-wails` to `:git/tag "wails-v0.10.0"`.

- [ ] **Step 3: Run the backend tests.** Run: `CGO_ENABLED=1 GOFLAGS=-tags=server lgx test`. Expected: PASS.

- [ ] **Step 4: Commit.** `git commit -am "Move to wails-v0.10.0"`

### Task 3: The frame in `quel.window`

**Files:**
- Modify: `src/quel/window.lg`
- Test: `test/quel/window_test.lg`

The shared shapes:

```clojure
(window-frame db)          ;=> {:x 1 :y 2 :width 1300 :height 900} or nil
(save-window-frame! db f)  ;=> nil; f is the same map
(start-opts state frame)   ;=> {:start-state state :width .. :height .. [:x .. :y ..]}
(fit-frame frame area)     ;=> frame; area may be nil
```

- [ ] **Step 1: Write the failing tests.**
  - **Frame round-trip:** a fresh database has no frame; a saved frame round-trips; `"1,2,3"`, `"a,b,c,d"` and `""` read as nil.
  - **`start-opts`:**
    - with no frame, it gives `{:start-state :normal :width 1200 :height 800}`;
    - with a normal frame, it adds that frame's size and position;
    - with `:maximised` or `:fullscreen`, it gives the frame's size and no `:x`/`:y`;
    - a frame of 500×300 comes back as 720×480.
  - **`fit-frame`:**
    - a frame inside the area comes back unchanged;
    - nil area comes back unchanged;
    - a frame off the right or bottom edge moves in;
    - a frame off the left or top edge moves in;
    - a frame larger than the area shrinks to it and sits at its origin;
    - an area with a non-zero origin works (a second display at x 1728).

- [ ] **Step 2: Run them to see them fail.** Run: `CGO_ENABLED=1 GOFLAGS=-tags=server lgx test`. Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement.**
  - Store the frame as text under `window-frame`, through the existing `setting`/`put-setting!`.
  - Parse with `str/split` and `parse-long`; any part that does not parse, or a count other than four, gives nil.
  - Defaults and minimum: `default-size` `{:width 1200 :height 800}` and `min-size` `{:width 720 :height 480}` here. `system.lg` reads them, so the numbers live in one place: replace the literals at `system.lg:69-70` with `window/default-size` and `window/min-size` merged into the `:quel.shell/window` opts.
  - `fit-frame` follows the fragment in the Design.
  - Update the namespace comment: it now also remembers the normal window's frame.

- [ ] **Step 4: Run the tests.** Run: `CGO_ENABLED=1 GOFLAGS=-tags=server lgx test`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -am "Remember the window's frame in the app database"`

### Task 4: Save and restore the frame in the backend

**Files:**
- Modify: `src/quel/shell.lg`
- Modify: `src/quel/system.lg`
- Modify: `src/quel/api.lg`
- Modify: `scripts/smoke.sh`
- Test: `test/quel/api_test.lg`, `test/quel/system_test.lg`

- [ ] **Step 1: Write the failing tests** in `api_test.lg`:
  - `"restore-window-frame"` joins the handler-names list at line 56.
  - With a server-mode window, `save-window-state` leaves no `window-frame` row, because the bounds are zero.
  - With a frame saved by hand through `window/save-window-frame!`, `restore-window-frame` returns nil and does not throw (the work area is nil in server mode).
  - With a saved state of `:maximised` and a saved frame, `save-window-state` (the server-mode window reads normal) records `:normal` and leaves the frame row unchanged.

- [ ] **Step 2: Run them to see them fail.** Run: `CGO_ENABLED=1 GOFLAGS=-tags=server lgx test`. Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement.**
  - **`shell.lg`:** `::window` merges `(window/start-opts (window/start-state store) (window/window-frame store))` over the opts, instead of setting only `:start-state`. Update the comment above it.
  - **`api.lg`, a private `apply-saved-frame!`:** when a frame is saved:
    1. If `(w/bounds window)` differs from it, `w/set-bounds!` to the saved frame as is. This puts the window on the display the frame belongs to. A session that started maximised was centred on the main display, and its current screen is the wrong one to fit against.
    2. Fit the saved frame into `(w/work-area window)`, which is now that frame's screen, or the primary screen when the frame is on none (a display that was unplugged). If the fitted frame differs from the saved one, `w/set-bounds!` to it.
  - **`api.lg`, `save-window-state`:** read the saved state before writing the new one.
    - Saved state `:maximised` or `:fullscreen`, current state `:normal`: call `apply-saved-frame!` and save the state only (see "Leaving maximised or fullscreen" in the Design).
    - Otherwise, when the state is `:normal` and `(w/bounds window)` has a non-zero width, also call `save-window-frame!`.
    - Update the comment to say the frontend calls it after a resize or a move.
  - **`api.lg`, `restore-window-frame`:** a new handler. When the start state is `:normal`, call `apply-saved-frame!`. Return nil. Register it by var, like `save-window-state` at `api.lg:255`.
  - **`system.lg`:** take the size and minimum from `window/default-size` and `window/min-size`. Update `system_test.lg` if it pins those literals.
  - **`scripts/smoke.sh`:** next to `save-window-state` at line 228, call `restore-window-frame` and expect nothing back, the same way.

- [ ] **Step 4: Run the backend tests and the smoke test.** Run: `CGO_ENABLED=1 GOFLAGS=-tags=server lgx test`, then `CGO_ENABLED=1 GOFLAGS=-tags=server lgx smoke`. Expected: PASS for both.

- [ ] **Step 5: Commit.** `git commit -am "Save the window's frame and restore it at start"`

### Task 5: The frontend saves on a move and restores at start

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/state/window.ts`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/state/window.test.ts`

- [ ] **Step 1: Write the failing test** in `window.test.ts`. Mock `@/lib/bridge`'s `onEvent` with `vi.hoisted`, the way `@/lib/api` is mocked there, and capture the listener for `common:WindowDidMove`. Calling it and advancing past `WINDOW_STATE_DELAY_MS` calls `saveWindowState` once. A move and a resize together inside the delay also save once. The fn `watchWindowState` returns removes the move listener too. Add `restoreWindowFrame` to the hoisted `api` mock.

- [ ] **Step 2: Run it to see it fail.** Run: `npm --prefix frontend test -- window`. Expected: FAIL on the new tests only.

- [ ] **Step 3: Implement.**
  - **`api.ts`:** `export const restoreWindowFrame = () => call<void>("restore-window-frame");`. Update the comment on `saveWindowState`: it remembers the state, and the frame of a normal window.
  - **`window.ts`:** in `watchWindowState`, subscribe `onResize` to `onEvent("common:WindowDidMove", ...)` as well, and call its remover in the returned fn. Add `restoreWindowFrame()`, which calls the API and drops a failure, as the zoom chain does. Update the comments.
  - **`App.tsx`:** call `void restoreWindowFrame();` in the start-up effect next to `void loadZoom();` (line 81).

- [ ] **Step 4: Run the frontend tests and the e2e suite.** Run: `npm --prefix frontend test`, then `CGO_ENABLED=1 GOFLAGS=-tags=server lgx e2e`. Expected: PASS for both. In server mode the restore is a no-op, so e2e should not change.

- [ ] **Step 5: Commit.** `git commit -am "Save the window state on a move and restore the frame at start"`

### Task 6: Docs, then the macOS check

**Files:**
- Modify: `docs/DESIGN.md`

- [ ] **Step 1: Update `docs/DESIGN.md`.**
  - In the **Window state** paragraph (around line 661), replace the sentence about the normal window's size not being remembered. Describe the `window-frame` row, the save on resize and on `common:WindowDidMove`, the two restore steps, and the fit to the work area.
  - In the namespace table (line 134), say that `quel.window` also holds the frame and its fit.
  - Commit: `git commit -am "Document the remembered window frame"`.

- [ ] **Step 2: Build once natively.** Run: `CGO_ENABLED=1 GOFLAGS=-tags=server lgx build`. Expected: `bin/quel` builds.

- [ ] **Step 3: Ask the user for the macOS check.** None of this can be checked on Linux. Report what passed, then ask them to run `lgx run` on a Mac and confirm each of these:
  1. **Fill:** Fill the window (green button menu > Fill, or drag it to the top edge), quit, start: it opens filling the screen.
  2. **A hand-made frame:** resize and move the window by hand, quit, start: it opens at the same size and place. Quit and start twice more: the size does not creep.
  3. **Move only:** move the window without resizing it, quit, start: it opens where it was left. This checks that `common:WindowDidMove` reaches the page.
  4. **Maximised:** maximise it (double-click the strip, or Option-click the green button), quit, start: it opens maximised. Restore it: it comes back at the frame from step 2, both size and position, not 1200×800 centred. A short second move just after the restore animation is expected.
  5. **Fullscreen:** the same round trip with fullscreen.
  6. **Exact bounds after a height change:** with the window at a known frame, make it much taller by hand, quit, start: the top edge is where it was left, not shifted by the height change. Do this on a Retina display: the window must not be squeezed into a quarter of the screen or pushed off it.
  7. **Two displays (if a second one is at hand):**
     - Leave the window on the external display, quit, start: it opens there.
     - Then maximise it there, quit, start, and restore it: it returns to its frame on the external display.
     - Finally leave it on the external display, quit, unplug the display, start: the window opens on the built-in display, fully visible.
  8. **No visible jump at start**, or at most a small correction as the window appears.

  If item 3 fails, the move event does not reach the page. The fallback is to listen in the backend with `OnWindowEvent(events.Common.WindowDidMove, ...)`, through a new upstream `on-window-event!`. Plan that separately.

## Rollout notes

No migration: `window-frame` is a new row in the existing `settings` table. An older build ignores it, and `window-state` keeps its meaning.
