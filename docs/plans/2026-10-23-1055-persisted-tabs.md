# Persisted Editor Tabs Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every profile's editor tabs (title, text, order, cursor, pinned) are saved to the app database as you work and come back on the next launch, with renamable tabs, pinned tabs that cannot be closed, and a per-profile "Recently closed" list that reopens closed tabs.

**Tech Stack:** let-go backend (`quel.store`, ragtime migrations, `sql.core`), React 19 + zustand + CodeMirror 6 frontend, shadcn `dropdown-menu`, Vitest, Playwright.

---

## Design

### Where this starts

Runs after `2026-10-23-1055-profile-workspaces.md`: each profile already
has an in-memory `Workspace` (`tabs`, `activeTab`, `nextTabNumber`), and
selecting a profile is separate from connecting it. This plan makes the
workspace's tabs durable.

### What is saved, and what is not

Saved per profile: each open tab's id, title, text, pinned flag, position,
and cursor/selection (`from`, `to`); the active tab; the next "Query N"
number; and up to 20 recently closed tabs. Saved app-wide: the selected
profile.

Not saved: results, messages, undo history, running state. They belong to
a live session; stale rows would mislead.

Nothing connects on launch: the last selected profile's workspace shows,
disconnected.

### Data model (migration `002-create-editor-tabs`)

```sql
create table editor_tabs (
  id          text primary key,
  profile_id  text not null references profiles(id) on delete cascade,
  title       text not null,
  body        text not null default '',
  pinned      integer not null default 0,
  position    integer not null default 0,
  sel_from    integer not null default 0,
  sel_to      integer not null default 0,
  closed_at   integer             -- ms since epoch; null while open
);
create index editor_tabs_profile on editor_tabs (profile_id, closed_at);

create table workspaces (
  profile_id      text primary key references profiles(id) on delete cascade,
  active_tab      text,
  next_tab_number integer not null default 1
);

create table settings (key text primary key, value text);
```

`foreign_keys` is already on for every app-db connection (the DSN pragmas
in `quel.store`), so deleting a profile removes its tabs and workspace row.
Down drops the three tables.

### Backend (`quel.workspace`, new namespace)

```clojure
(load db profile-id)
;; => {:tabs [{:id :title :body :pinned :sel-from :sel-to} ...]   ; open, by position
;;     :active-tab "id" | nil :next-tab-number n
;;     :closed [{:id :title :body :closed-at} ...]}                ; newest first, ≤ 20

(save! db profile-id {"tabs" [...] "active-tab" "id" "next-tab-number" n})
;; One transaction:
;;  - upsert every listed tab as open (closed_at null), position = its index;
;;  - an open tab of this profile that is NOT listed becomes closed, as a
;;    safety net only: the frontend closes tabs through close!, which runs
;;    first (see the frontend queue);
;;  - keep the 20 newest closed tabs, delete older ones;
;;  - upsert the workspaces row.
;; Returns nil. Refuses an unknown profile ("This connection no longer exists.").

(close! db profile-id {"id" "title" "body"})
;; Closing is explicit, not inferred from a save: it writes the tab's final
;; title and text with closed_at = now (inserting the row if the tab was
;; never saved) and trims the closed list to 20. A blank body deletes the
;; row instead. Returns the closed entry {:id :title :body :closed-at}, or
;; nil for a blank tab.

(reopen! db profile-id closed-id)
;; Removes the closed row and returns it as an open tab with a NEW id
;; (quel.conn/new-id), title, body, appended last. A new id because the old
;; one may be a retired session id on a still-open connection (quel.conn
;; refuses retired ids). The frontend adds it and the next save persists it.

(selected-profile db) / (select-profile! db id-or-nil)   ; the settings row "selected-profile"
```

Saves are serialised with a lock (the `async` channel pattern from
`quel.profiles`), since a save reads then writes. `body` is untrimmed and
uncapped; a tab is SQL a person typed, so size is not a concern at this
scale.

Handlers (`quel.api`): `load-workspace`, `save-workspace`, `close-tab`, `reopen-tab`,
`selected-profile`, `select-profile` (names as in DESIGN's handler table
where they exist).

### Frontend

**Editor state seeding.** Restored tabs have text but no CodeMirror state.
`editor/states.ts` gains a `seeds` map (`seed(tabId, text, sel)`); the
editor's `newState` moves from `SqlEditor.tsx` to `editor/setup.ts` so
`states.ts` and `SqlEditor` share it. `SqlEditor` uses
`savedState(tabId) ?? newState(engine, seedOf(tabId))`. `currentInput` and
the save path read a tab's text from the mounted view, the saved state, or
the seed, in that order (`textOf(tabId)`).

**Loading.** `ensureWorkspace(profileId)` becomes async: if the workspace
is not in memory, `api.loadWorkspace(profileId)`; zero open tabs gives one
fresh "Query 1". Tabs are seeded; `activeTab` falls back to the first tab.
`closed` goes to `workspace.closed` (new field).

If `loadWorkspace` fails, the workspace is marked `loadError` and shown
with the error and a Retry; it is read-only and nothing is ever saved for
it, so a failed read can never overwrite the saved tabs with an empty set.

**Start-up.** The workspaces plan's `restoreSelection()` becomes: read
`api.selectedProfile()`; select that profile if it still exists, else the
first; this selection is *not* written back (only a user's click on a
profile calls `api.selectProfile`). So the saved choice is read before any
fallback could overwrite it.

**Saving.** `state/persist.ts` keeps one queue per profile; its operations
run in order, one at a time: `save`, `close`, `reopen`. `scheduleSave(profileId)`
debounces 800 ms, then enqueues a `save` built from the state at the moment it
runs (so a queued save always sends the latest tabs). Triggers: editor document or selection change (an
`EditorView.updateListener` in `setup.ts` calls `onEdit(tabId)`), new tab,
close, rename, pin/unpin, reorder, active tab change, reopen. Flush pending
saves on `visibilitychange` (hidden) and `pagehide`. `selectProfile` calls
`api.selectProfile(id)` (not debounced). A failed save shows "Could not save
tabs: …" as the status bar notice and is retried on the next change.

Known gap: an edit made in the last 800 ms before quitting with ⌘Q may be
lost; the window hides first in practice, which flushes. Accepted.

**Rename.** Double-click a tab's title: an inline input with the title
selected; Enter or blur commits, Escape cancels, blank keeps the old title.
Titles are not unique.

**Pin.**
- `EditorTab.pinned` (new field).
- Pinned tabs sort before unpinned ones; pinning moves the tab to the end
  of the pinned group, unpinning to the start of the unpinned group.
- A pinned tab shows a pin icon in place of the close button. ⌘W, the
  middle-click and the menu's Close Tab do nothing on it, and the status
  bar notice says "Unpin the tab to close it."
- Toggle: right-click a tab for a small menu (Rename, Pin/Unpin, Close),
  using shadcn `context-menu`. The pin icon on a pinned tab is also a
  button that unpins.
- The result "pin" stays as is, but its tooltip and label become "Keep
  result" / "Keep result across runs", so the two pins read differently.

**Closing a tab.** `closeTab` captures the tab's title and `textOf(tabId)`
*before* `dropState`, removes the tab from the store, then flushes any pending
debounced save for the profile and enqueues `close` with that snapshot. When
`close` returns an entry, it is put at the front of `workspace.closed` (keep
20). So the text typed just before closing is what gets kept, including for
a tab never saved before, and the history menu updates at once. If `close`
fails, the tab comes back where it was, with its captured title and text
re-seeded, and the status bar notice says "Could not close the tab: …".
Nothing is lost, and the queue moves on to its next operation.

**Recently closed.**
- A history button at the end of the tab bar (shadcn `dropdown-menu`)
  lists the workspace's closed tabs: title, the first line of its text, and
  when it was closed. A click enqueues `reopen` on the profile's queue (so it
  runs after the `close` that put the entry there), removes the entry from
  `workspace.closed`, adds the returned tab (new id, seeded) as active, and
  schedules a save.
- ⌘⇧T reopens the most recent one: a menu item "Reopen Closed Tab"
  (`CmdOrCtrl+Shift+T`) emitting `menu:reopen-tab`.
- Closing a tab whose text is blank does not add it to the list (the
  backend deletes blank tabs instead of closing them).

**Delete confirm.** The profile delete dialog says "Its N saved tabs are
deleted too." when the workspace has tabs with text.

### Testing

- **Backend** (`workspace_test.lg`, temp store): load of a fresh profile is
  empty; save then load round-trips order, pinned, selection, active tab and
  next number; a tab missing from a save becomes closed and shows in
  `:closed`; a blank one is deleted instead; only 20 closed are kept, newest
  first; `close!` stores the given (newer) body and inserts a never-saved tab;
  `close!` of a blank tab deletes it and returns nil; `reopen!` returns a
  new id with the old title/body and removes the closed row; deleting the profile cascades; save for an unknown profile
  throws; concurrent saves of one profile leave a consistent state;
  `selected-profile` round-trips and returns nil for a deleted profile.
  `api_test`: the handler set and one round trip. `system_test` unchanged.
  `store_test`: the migration list has `002-create-editor-tabs`.
- **Frontend unit:** `persist.test.ts` (debounce; queue order; one op in
  flight; a queued save sends the latest state; flush; nothing saved for a
  workspace with `loadError`); closing right after typing keeps the typed
  text; closing a never-saved tab keeps it; a `close` that fails once puts the tab back with its text and later operations still run; close then immediate reopen
  waits for the close; restoring a saved selection that is not the first
  profile, and not writing the fallback back; `runner.test.ts` (pinned tab refuses close, rename,
  pin ordering, reopen adds a tab with the returned id);
  `states.test.ts` (seeded text read by `currentInput`).
- **e2e** (`tabs.spec.ts`): type in two tabs of the fixture profile, rename
  one, pin it, reload the page, and the tabs, names, pin and text are back;
  ⌘W on the pinned tab leaves it; close the other, reopen it from the
  history menu with its text. The reload stands in for an app restart
  (server mode keeps the backend; the frontend state is rebuilt from the
  app database).
- **Smoke:** `save-workspace` then `load-workspace` over the bridge.

## File Structure

| File | Change |
|---|---|
| `src/quel/migrations.lg` | `002-create-editor-tabs` |
| `src/quel/workspace.lg` | new: load, save!, close!, reopen!, selected-profile, select-profile! |
| `src/quel/api.lg` | six handlers |
| `src/quel/menu.lg` | "Reopen Closed Tab" (`CmdOrCtrl+Shift+T`, `menu:reopen-tab`) |
| `test/quel/workspace_test.lg` | new |
| `test/quel/{api,store,menu}_test.lg` | extended |
| `scripts/smoke.sh` | workspace round trip |
| `frontend/src/editor/setup.ts` | new: `newState` (moved), the edit listener |
| `frontend/src/editor/states.ts` (+ test) | seeds, `textOf` |
| `frontend/src/editor/SqlEditor.tsx` | use `setup.ts` and seeds |
| `frontend/src/state/persist.ts` (+ test) | debounced per-profile saves |
| `frontend/src/state/store.ts` | `EditorTab.pinned`, `Workspace.closed` |
| `frontend/src/state/runner.ts` (+ test) | async ensureWorkspace, rename, pin, reopen, close rules |
| `frontend/src/lib/{api,types}.ts` | workspace calls and shapes |
| `frontend/src/components/EditorTabs.tsx` | rename, pin, context menu, history menu |
| `frontend/src/components/ResultTabs.tsx` | "Keep result" wording |
| `frontend/src/components/ProfileDialog.tsx` | tab count in the delete confirm |
| `frontend/src/components/ui/{context-menu,dropdown-menu}.tsx` | shadcn add |
| `frontend/src/App.tsx` | `menu:reopen-tab`; start-up restore |
| `frontend/e2e/tabs.spec.ts` | new |
| `docs/DESIGN.md` | workspace persistence; handler table; milestone line |

## Tasks

### Task 1: Migration and `quel.workspace`

**Files:** `src/quel/migrations.lg`, `src/quel/workspace.lg`, `test/quel/workspace_test.lg`, `test/quel/store_test.lg`.

- [x] **Step 1: Write** `workspace_test.lg` per the Testing list (reuse `quel.store-test/with-store`, `quel.profiles` to make profiles).
- [x] **Step 2: Run** `CGO_ENABLED=0 GOFLAGS=-tags=server mise exec -- lgx test`. Expected: FAIL.
- [x] **Step 3:** Add the migration and implement `quel.workspace` per the Design (`close!` included). Rows map with one `row->tab` fn (`sel_from` → `:sel-from`, `pinned` 0/1 → boolean). Read the map from the frontend with string or keyword keys (the `field` pattern in `quel.profiles`).
- [x] **Step 4: Run** the tests. Expected: PASS. Update `store_test`'s migration-id assertion.
- [x] **Step 5: Commit** `Save editor tabs per profile in the app database`.

> Deviation: `reopen!` also inserts the reopened tab as open (last position), so a quit before the next frontend save keeps it; the plan left that to the next save.
> Deviation: `close!` and save-time closes stamp `closed_at` strictly after the profile's latest one, so two closes in one millisecond keep their order.

### Task 2: Handlers, menu, smoke

**Files:** `src/quel/api.lg`, `src/quel/menu.lg`, their tests, `scripts/smoke.sh`.

- [x] **Step 1: Tests:** handler set; a load/save/reopen round trip in `api_test`; the menu item in `menu_test` (8 clickable items).
- [x] **Step 2:** Implement; smoke: save a workspace for the smoke profile, load it back, check the tab text.
- [x] **Step 3: Run** `lgx test` and `lgx smoke` (server-mode env). Expected: PASS.
- [x] **Step 4: Commit** `Add the workspace handlers and Reopen Closed Tab`.

### Task 3: Editor seeding

**Files:** `frontend/src/editor/{setup,states,SqlEditor}.ts(x)`, `states.test.ts`.

- [x] **Step 1:** Move `newState` and its extensions to `setup.ts`, adding an optional seed (doc and selection, clamped to the doc length) and the update listener hook. `states.ts`: `seed`, `seedOf`, `textOf`; `currentInput` falls back to the seed.
- [x] **Step 2: Test** `states.test.ts`: a seeded, never-mounted tab reports its text and selection; a mounted one reports the view's.
- [x] **Step 3: Run** `npm --prefix frontend test`. Expected: PASS.
- [x] **Step 4: Commit** `Seed editor tabs from saved text`.

> Deviation: the edit listener is wired in Task 4, with `persist.onEdit`, since Task 3 has nothing for it to call yet.

### Task 4: Persisting from the frontend

**Files:** `frontend/src/state/{persist,runner,store}.ts`, `frontend/src/lib/{api,types}.ts`, tests, `frontend/src/App.tsx`.

- [x] **Step 1: Tests:** `persist.test.ts` with fake timers; runner tests for async `ensureWorkspace` from a loaded workspace, start-up selection, save triggers.
- [x] **Step 2:** Implement per the Design (Loading, Saving). Every tab mutation in the runner calls `scheduleSave` for its profile.
- [x] **Step 3: Run** `npm --prefix frontend test`. Expected: PASS.
- [x] **Step 4: Commit** `Restore and save each profile's tabs`.

> Deviation: `ensureWorkspace` moved from `store.ts` to `runner.ts` (it now calls the backend); concurrent callers and Retry share one in-flight load.
> Deviation: a closed tab's backend session closes only after `close-tab` succeeds, and a run in flight is cancelled at close; a failed close restores the original tab (results, messages, session) rather than a fresh one with the text.
> Deviation: ⌘⇧T picks "the most recent closed" inside its queued operation, so ⌘W then ⌘⇧T reopens that tab even before the close returns.
> Deviation: the status bar shows a notice when connected too (it showed one only when disconnected), so "Unpin the tab to close it." and "Could not save tabs: …" are visible.
> Deviation: `select-profile` writes go through an app-wide queue, latest wins (codex: concurrent bridge calls could land out of order).
> Deviation: Retry keeps a connection opened while the workspace was in its load-error state (codex).

### Task 5: Rename, pin, recently closed

**Files:** `frontend/src/components/{EditorTabs,ResultTabs,ProfileDialog}.tsx`, `frontend/src/state/runner.ts` (+ test), shadcn components, `App.tsx`.

- [x] **Step 1:** `npx shadcn@latest add context-menu dropdown-menu` (fix any `import { cn } from "cn"` to `@/lib/utils`, as before).
- [x] **Step 2: Tests** (runner): rename, blank rename ignored, pin ordering, pinned close refused with the notice, reopen.
- [x] **Step 3:** Implement per the Design (Rename, Pin, Recently closed, Delete confirm, "Keep result" wording, `menu:reopen-tab`).
- [x] **Step 4: Verify by hand** in server mode: rename, pin, ⌘W on a pinned tab, close and reopen, reload the page and see everything back; light and dark.
- [x] **Step 5: Run** frontend test, lint, build. Expected: PASS.
- [x] **Step 6: Commit** `Rename and pin editor tabs, and reopen closed ones`.

> Deviation: kept shadcn's `import { cn } from "cn"`: `cn` is a real package (`@/lib/utils` re-exports it) and the existing ui components import it the same way, so the plan's "fix the import" step no longer applies.
> Deviation: no drag-to-reorder: the Design names reorder as a save trigger but specifies no UI for it; pin is the only reordering.
> Deviation: the delete confirm counts the open tabs with text of a loaded workspace only (a profile never selected this run has no count).

### Task 6: End to end, docs, review, PR

- [x] **Step 1:** `frontend/e2e/tabs.spec.ts` per the Testing list. **Run** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e`. Expected: all pass. Commit `Test persisted tabs end to end`.
- [x] **Step 2:** DESIGN: workspace persistence (what is saved, the tables, the handlers, reopen's new id); mark "workspace restore" done in milestone 1 with the date. Commit `Document persisted tabs`.
- [x] **Step 3:** Codex review of the branch in the background; fold real findings; re-run `lgx test-pg`, frontend tests, `lgx smoke-pg`, `lgx e2e`.
- [x] **Step 4:** Push, open a PR, link it, wait for CI. Do not merge without the user. Hand the user a macOS check: quit with ⌘Q right after typing and relaunch; tabs and text are back.

> Deviation: `tabs.spec.ts` checks the pinned-tab refusal with a middle click, not ⌘W: native menu accelerators do not exist in server mode, and both go through `closeTab`. Its profile name is unique per run, so a Playwright retry starts with no saved tabs.

## Completion

**Status: completed** (2026-10-23, branch `persisted-tabs`).

**What was implemented.** Migration `002-create-editor-tabs` (`editor_tabs`, `workspaces`, `settings`) and `quel.workspace` (`load`, `save!`, `close!`, `reopen!`, `selected-profile`, `select-profile!`, serialised by a lock); six handlers; File > Reopen Closed Tab (⌘⇧T). Frontend: editor seeding (`editor/setup.ts`, seeds in `editor/states.ts`), `state/persist.ts` (a per-profile queue of save/close/reopen, 800 ms debounced saves built at run time, flush on hide/pagehide), async `ensureWorkspace` with a load-error state and Retry, the saved selection restored at start-up (never written back by the fallback), rename (double-click or menu), pin (context menu, pin icon unpins), the recently-closed history menu, "Keep result" wording, and the tab count in the delete confirm. DESIGN documents it (Saved tabs, tables, handlers, milestone line). Tests: 13 backend workspace tests plus api/menu/store updates (140 backend tests), 163 frontend tests (new `persist.test.ts`, `states.test.ts`, runner and profiles tests), `tabs.spec.ts` e2e (9 e2e tests), and a smoke round trip. All green: `lgx test-pg`, `lgx smoke-pg`, `lgx e2e`, frontend test, lint, build. Checked by hand in server mode, light and dark.

**Issues found in review and fixed** (codex, per task and on the branch):
- Retry after a failed load dropped a live connection; a failed close restored a blank tab instead of the original; concurrent `select-profile` writes could land out of order; double Retry could wipe seeded text; a rolled-back close could reuse a tab number.
- Rename from the context menu lost focus to the closing menu; unpinning did not clear the "Unpin the tab to close it." hint.
- A failed close could let the original script run on (now: a per-tab run epoch); a save between a tab leaving the store and its `close-tab` would close it with stale text and trim unrelated history (now: saves list closing tabs until the close lands); a page load cut off by a failed close left an "open" cursor that would skip rows (now closed).

**Deviations, all in one place:**
- `reopen!` saves the reopened tab as open at once (a quit before the next save keeps it).
- Closes stamp `closed_at` strictly after the profile's latest, so same-millisecond closes keep their order.
- The editor's edit listener was wired in Task 4 (with `persist.onEdit`), not Task 3.
- `ensureWorkspace` lives in `runner.ts`; concurrent callers and Retry share one load.
- A closed tab's session closes only after `close-tab` succeeds; a run in flight is cancelled at close; a failed close restores the original tab.
- ⌘⇧T picks "the most recent closed" inside its queued operation.
- The status bar shows notices while connected too.
- `select-profile` writes go through an app-wide queue, latest wins; Retry keeps a connection opened meanwhile.
- Kept shadcn's `import { cn } from "cn"` (a real package; the existing ui components use it).
- No drag-to-reorder (the Design named it as a trigger but specified no UI).
- The delete confirm counts tabs only for a loaded workspace.
- The e2e uses a middle click for the pinned-close check, and a per-run profile name.

**What the plan could have specified better:** the failure interleavings around closing a tab (a run or page load in flight, a save queued between removal and `close-tab`, a failed close restoring the tab) — the plan specified the happy-path order but not what the restored tab and the in-flight work should become, and every review round's must-fix came from there.
