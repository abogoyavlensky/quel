# Profile Workspaces Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each connection profile gets its own workspace (editor tabs, result tabs, messages). Several profiles can be connected at once. Selecting a profile in the sidebar shows its workspace whether it is connected or not, and each profile has its own Connect/Disconnect button.

**Tech Stack:** React 19, zustand, TypeScript, Vitest, Playwright (frontend only). Backend unchanged: `quel.conn` already holds many open databases keyed by conn-id.

---

## Design

### Where this starts

Builds on the profiles work (PR #4, branch `profiles`). Execute on a branch
cut from master once PR #4 is merged; if it is not merged yet, cut it from
`profiles` and rebase later.

Today the frontend has one connection and one set of tabs:
`AppState.conn: Conn | null` and `AppState.tabs` (`frontend/src/state/store.ts`).
Clicking a profile goes through `switchDb` (`state/runner.ts`), which closes
the open database, every cursor and every tab's session before opening the
next one. The backend never had that limit: `quel.conn`'s registry maps
conn-id → database, sessions are keyed per conn-id, and `connect` /
`close-db` work per database. This plan is frontend only.

### Scope

In: a workspace per profile, held in memory; select versus connect; several
connected profiles; a Connect/Disconnect button per profile; ⌘Enter on a
disconnected profile refused, with a Connect offer; the menu actions apply
to the selected workspace.

Out (the next plan, `2026-10-23-1055-persisted-tabs.md`): saving tabs
between runs, restoring the selected profile, rename, pin, recently closed.
Workspaces here live as long as the app runs.

Also out: one shared connection per profile (decided against: tabs keep a
connection each), connection-lost events, and auto-connect on launch.

### State shape

```ts
// state/store.ts
export type ConnStatus = "disconnected" | "connecting" | "connected" | "disconnecting";

export interface Workspace {
  profileId: string;
  status: ConnStatus;
  connId: string | null;       // set while connected (and while disconnecting)
  error: string | null;        // the last connect error, shown in the panel
  tabs: EditorTab[];           // never empty
  activeTab: string;
  nextTabNumber: number;
}

export interface AppState {
  profiles: Profile[];
  profilesError: string | null;
  profileDialog: ProfileDialog;
  selected: string | null;                  // the profile whose workspace shows
  workspaces: Record<string, Workspace>;    // by profile id, made on first select
  notice: string | null;                    // a one-line hint for the status bar
}
```

`conn`, `switching`, `dbError`, the top-level `tabs`, `activeTab` and
`nextTabNumber` go away. `EditorTab`, `ResultTab` and `Message` are
unchanged.

Tab ids stay globally unique UUIDs (they are also backend session ids), so
the runner keeps addressing tabs by id alone. Store helpers find a tab's
workspace by scanning workspaces:

```ts
export function workspaceOfTab(tabId: string): Workspace | undefined;
export function findTab(tabId: string): EditorTab | undefined;              // across workspaces
export function updateTab(tabId: string, f: (t: EditorTab) => EditorTab): void;
export function updateWorkspace(profileId: string, f: (w: Workspace) => Workspace): void;
export function selectedWorkspace(s: AppState): Workspace | undefined;
export function closeCursors(profileId: string): void;   // replaces closeAllCursors
```

A workspace is created the first time its profile is selected
(`ensureWorkspace(profileId)`: one "Query 1" tab, status
`disconnected`). Deleting a profile drops its workspace.

### Select versus connect

- **Select** (`selectProfile(id)`): a click on a profile row. Sets
  `selected`, creating the workspace if needed. It never connects. The editor
  shows that workspace's tabs and stays editable. The editor dialect comes
  from the profile's engine, known without a connection.
- **Connect** (`connectProfile(id)`): the row's Connect button, the status
  bar's Connect button, or the button in the "not connected" notice. Sets
  status `connecting`, calls `api.connect(id)`, then `connected` with the
  connId, or back to `disconnected` with `error`. A second Connect while
  `connecting` is ignored. Connecting does not change `selected`, so
  connecting a row you are not looking at keeps your view.
- **Disconnect** (`disconnectProfile(id)`): status `disconnecting`; every
  open result in that workspace becomes `closed` and a running statement's
  tab state is cleared as today. Then `api.closeDb(connId)`, which closes the
  database's sessions, cursors and pools on the backend. Status
  `disconnected`, connId null. Tabs and their text stay.
- Other workspaces are untouched by any of these: no global switch any more.

A run's "is this still the connection I started on" checks (`runStatements`,
`fetchMore`) compare against the tab's own workspace's connId, not a global
one.

### Running on a disconnected profile

`runCurrent` (⌘Enter, ⌘⇧Enter, the menu items) on a workspace that is not
`connected` sends nothing. It sets `notice` to "Not connected." The status
bar shows the notice with a Connect button that connects the selected
profile. The notice clears on the next connect, select or edit in the
editor. While `connecting`, the run is dropped silently, as a second run in
flight is today.

### Sidebar

Each profile row (`ConnectionsPanel.tsx`):

- **The row button selects.** The selected row gets the highlight
  (`aria-current="true"`). Connected is no longer what is highlighted.
- **Status mark:** `ConnMark` gains a `status` prop. Connected shows a
  filled dot in the profile's colour (or engine colour); disconnected shows
  a hollow ring in the same colour; connecting/disconnecting shows a pulsing
  dot. The row's title says "Connected", "Not connected" or "Connecting…".
- **Connect/Disconnect button:** an icon button on the right (`PlugIcon` /
  `UnplugIcon`), always visible when connected, on hover/focus otherwise,
  named "Connect X" / "Disconnect X". It is disabled while
  connecting/disconnecting.
- **Edit button:** unchanged.
- **Errors:** a failed connect shows the error under that row (the
  workspace's `error`), not in a global spot.

### Status bar

`StatusBar` reads the selected workspace: its profile's mark and name, then
"Ready" / "Running…" / "Canceling…" when connected, "Connecting…", or "Not
connected" with a Connect button when disconnected (or the `notice`). With
no profile selected (no profiles yet) it says "No connection".

### Menus and other wiring

- `menu:new-tab`, `menu:close-tab`, `menu:run`, `menu:run-script` and
  `menu:cancel` act on the selected workspace's active tab. With nothing
  selected they do nothing.
- `AppShell` passes the selected workspace's active tab and the profile's
  engine to `SqlEditor` and `ResultTabs`. `EditorTabs` lists the selected
  workspace's tabs.
- Choosing a default selection is its own step, never a side effect of
  `loadProfiles`: `restoreSelection()` runs once at start-up, after
  `loadProfiles()`, and selects the first profile when nothing is selected.
  (The persisted-tabs plan replaces its body with "the saved selection,
  else the first", so it must stay a separate function.) After a new
  profile is saved, select it. After the selected profile is deleted,
  select the first remaining one or none.
- `deleteProfile(id)`: refused while that workspace is
  `connecting`/`disconnecting` (the existing guard becomes per workspace).
  If connected, disconnect first; then delete; then drop the workspace. Its
  tabs' editor states are dropped (`dropState`).
- `saveProfile` updates nothing connection-wise: the workspace reads name
  and colour from `profiles` when rendering, so a rename shows at once.
  (The `Conn` copy of label/colour disappears.)
- `closeTab(tabId)`: closes the tab's backend session only if its workspace
  is connected (`api.closeSession(connId, tabId)`). The last tab in a
  workspace is replaced by a fresh one, as today.

### Resource note

Each tab that has run something holds one connection, per connected
profile. Disconnecting a profile releases all of them. No idle release in
this plan.

### Testing

- **Unit (Vitest):** `store.test.ts` (new: helpers find tabs across
  workspaces, `ensureWorkspace`, `closeCursors` touches one workspace);
  `runner.test.ts` reworked to the workspace shape: two workspaces connected
  at once run independently; disconnect of one closes only its cursors;
  `runCurrent` on a disconnected workspace sends nothing and sets the
  notice; a run whose workspace was disconnected meanwhile marks its result
  closed; `closeTab` skips `closeSession` when disconnected;
  `profiles.test.ts`: delete refused while connecting, delete of a
  connected profile disconnects first and drops the workspace,
  `restoreSelection` selects the first profile only when nothing is
  selected, and `loadProfiles` alone selects nothing.
- **e2e:** `connect.ts` helper becomes "select the fixture profile, click
  Connect". New `workspaces.spec.ts`: two SQLite profiles (the fixture file
  and a second file the script makes) connected at once; typing in A, then
  selecting B shows B's own tabs; switching back shows A's text and its
  result grid; disconnecting B keeps its tabs; ⌘Enter on B then shows "Not
  connected" and its Connect button reconnects and the run works on the
  next ⌘Enter; a temp table in A is not visible in B.
- **Existing suites:** `profiles.spec.ts` and `query-loop.spec.ts` adjusted
  to select + Connect.

## File Structure

| File | Change |
|---|---|
| `frontend/src/state/store.ts` | `Workspace`, `ConnStatus`, new `AppState`, workspace helpers |
| `frontend/src/state/store.test.ts` | new |
| `frontend/src/state/runner.ts` | per-workspace connection checks; `selectProfile`, `connectProfile`, `disconnectProfile`; `runCurrent` notice; tab actions on the selected workspace |
| `frontend/src/state/runner.test.ts` | reworked to workspaces |
| `frontend/src/state/profiles.ts` (+ test) | select on load/save/delete; per-workspace delete guard |
| `frontend/src/components/ConnMark.tsx` | `status` prop |
| `frontend/src/components/ProfileDialog.tsx` | the delete guard reads the edited profile's workspace status, not the removed `switching` |
| `frontend/src/components/ConnectionsPanel.tsx` | select rows, Connect/Disconnect, per-row error |
| `frontend/src/components/StatusBar.tsx` | selected workspace, Connect button, notice |
| `frontend/src/components/AppShell.tsx`, `EditorTabs.tsx`, `ResultTabs.tsx` | read the selected workspace |
| `frontend/src/App.tsx` | menu events on the selected workspace |
| `frontend/e2e/connect.ts`, `profiles.spec.ts`, `query-loop.spec.ts` | select + Connect |
| `frontend/e2e/workspaces.spec.ts` | new |
| `scripts/e2e.sh` | a second fixture file for the workspaces spec (`QUEL_E2E_DB2`) |
| `docs/DESIGN.md` | Frontend section: workspaces, select vs connect; layout sketch |

## Tasks

### Task 1: Branch and store

**Files:** `frontend/src/state/store.ts`, `frontend/src/state/store.test.ts`.

- [ ] **Step 1:** Cut branch `workspaces` from master (after PR #4 merged), or from `profiles` if not merged yet.
- [ ] **Step 2: Write** `store.test.ts` for the helpers in the Design (`workspaceOfTab`, `findTab`, `updateTab` across two workspaces, `ensureWorkspace` idempotent, `closeCursors` limited to one workspace, `selectedWorkspace`).
- [ ] **Step 3:** Implement the new state shape and helpers. Keep `newTabState`, `addMessage`, `updateResult` (now via `updateTab`). Remove `conn`, `switching`, `dbError` and the top-level tab fields. TypeScript will now flag every reader; leave them broken until Task 2-4.
- [ ] **Step 4: Run** `npm --prefix frontend test -- store`. Expected: the new tests PASS (others may fail to compile until Task 2).

### Task 2: Runner

**Files:** `frontend/src/state/runner.ts`, `frontend/src/state/runner.test.ts`.

- [ ] **Step 1: Rework the tests** to the workspace shape (the Testing list). Seed state with two workspaces through a small helper in the test file.
- [ ] **Step 2:** Implement: `runStatements`/`fetchMore` read the connId from `workspaceOfTab(tabId)` and treat "workspace not connected or connId changed" as today's "database changed"; `selectProfile`, `connectProfile`, `disconnectProfile` per the Design; `runCurrent` with the notice; `newTab`, `selectTab`, `closeTab` on the owning/selected workspace. Remove `switchDb` and `closeDb` (callers move to `disconnectProfile`).
- [ ] **Step 3: Run** `npm --prefix frontend test`. Expected: runner and store PASS; profiles tests may still fail.
- [ ] **Step 4: Commit** `Hold a workspace per profile, several connected at once`.

### Task 3: Profiles actions

**Files:** `frontend/src/state/profiles.ts`, `frontend/src/state/profiles.test.ts`.

- [ ] **Step 1: Tests** per the Testing list.
- [ ] **Step 2:** Implement: `restoreSelection()` (called from `App.tsx` after `loadProfiles()`); select the saved profile after creating one; delete guard per workspace; disconnect then delete then drop the workspace and its editor states; re-select after deleting the selected one.
- [ ] **Step 3: Run** `npm --prefix frontend test`. Expected: PASS.
- [ ] **Step 4: Commit** `Select, connect and delete profiles per workspace`.

### Task 4: UI

**Files:** `ConnMark.tsx`, `ConnectionsPanel.tsx`, `StatusBar.tsx`, `AppShell.tsx`, `EditorTabs.tsx`, `ResultTabs.tsx`, `ProfileDialog.tsx`, `App.tsx`.

- [ ] **Step 1:** `ConnMark` `status` prop (filled / hollow ring / pulsing; `aria-hidden` stays, the row title carries the words).
- [ ] **Step 2:** `ConnectionsPanel` per the Sidebar section. `StatusBar` per its section. `AppShell`/`EditorTabs`/`ResultTabs` read the selected workspace (render a quiet "Add a connection to start" placeholder in the main area when there is none). `App.tsx` menu events target the selected workspace.
- [ ] **Step 3: Verify by hand** in server mode (`QUEL_SECRETS=memory QUEL_DATA_DIR=$(mktemp -d)`, the server-mode env from AGENTS.md, headless browser): two SQLite profiles, connect both, run in each, switch back and forth, disconnect one, ⌘Enter on it, Connect from the status bar; light and dark.
- [ ] **Step 4: Run** `npm --prefix frontend test && npm --prefix frontend run lint && npm --prefix frontend run build`. Expected: PASS, no new lint warnings.
- [ ] **Step 5: Commit** `Select profiles in the sidebar and connect each on its own`.

### Task 5: End to end

**Files:** `frontend/e2e/*`, `scripts/e2e.sh`.

- [ ] **Step 1:** `scripts/e2e.sh`: make a second fixture file (`t2` with 10 rows) and pass `QUEL_E2E_DB2`. `connect.ts`: select the profile, click "Connect <name>", wait for the status bar to show the name and "Ready". Adjust `profiles.spec.ts` (connect is now a button; the connected row is no longer the highlighted one).
- [ ] **Step 2:** Write `workspaces.spec.ts` per the Testing list.
- [ ] **Step 3: Run** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e`. Expected: all pass.
- [ ] **Step 4: Commit** `Test profile workspaces end to end`.

### Task 6: Docs, review, PR

- [ ] **Step 1:** DESIGN Frontend section: the workspace model, select vs connect, the "not connected" behaviour, one connection per tab per connected profile; update the layout sketch (sidebar = profiles with status and Connect). Commit `Document profile workspaces`.
- [ ] **Step 2:** Codex review of the branch against its base in the background; fold real findings; re-run frontend tests, `lgx smoke`, `lgx e2e`.
- [ ] **Step 3:** Push, open a PR, link it, wait for CI. Do not merge without the user.
