# Statement Result Tabs Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every statement a run sends gets its own result tab, created when the statement starts and filled in with its rows, its update count, or its error, so a run no longer jumps to Messages.

**Tech Stack:** React 19, zustand store, TypeScript, Vitest, Playwright. Frontend only: the backend does not change.

---

## Design

### Where this starts

A result tab exists only once a reply with columns arrives
(`frontend/src/state/runner.ts`, `runStatements`). A run first drops the
unpinned results, so Messages is all that is left to show during the run
(`active: MESSAGES` at run start), and the run falls back to Messages on an
error or when no rows came back. That was never a UX choice: it follows
from the data model, and the footer's "Running…" was added to make up for
it.

### The rule

**Each statement that is sent gets one result tab, for as long as the run's
results last.** All tabs work the same (pin, close, the same replacement by
the next run). What is inside depends on what the statement returned:

| Kind | Body | Footer |
|---|---|---|
| `running` | empty | "Running…" and the time, after the usual 300 ms |
| `rows` | the grid | rows text, Export, time (as today) |
| `update` | "3 rows affected" or "Done" | the same text, and the time |
| `error` | the error, in destructive color | none |
| `canceled` | "Query canceled.", muted | none |

- **One spinner, in the footer.** The running tab's body is empty and its
  tab button has no spinner. Quick queries flash nothing: the footer already
  waits 300 ms, and the tab keeps its id from placeholder to filled result.
- **Focus.** A run's first statement always takes focus, even from a pinned
  tab. The pinned tab itself is untouched. Each later statement of a script
  takes focus only if the active tab is the previous statement's, so a user
  who clicked an earlier result to read it mid-script stays there. An error
  or a cancel always takes focus, unless the user closed that tab. When the
  run ends nothing else moves: the last tab is already active.
- **Scripts.** `select; update; select` gives three tabs. `select; bad` gives
  a rows tab and an error tab, and the script stops, as it does now. A stop
  between two statements sends nothing more, so it leaves no tab.
- **Messages stays** as the full history. Every outcome still goes there.
  It is no longer selected automatically. A failed page load (`fetchMore`)
  is not a statement: it still only logs, as it does today.
- **A read-only refusal gets no tab.** Nothing was sent, so results and focus
  stay as they are. It shows as a toast (`notify.error`, id `run-refused`, so
  a second press replaces it), as the not-connected refusal does, and still
  adds its error line to Messages.
- **Closing the running tab cancels the run.** It is the same as pressing
  Stop, and the script stops. The reply finds no tab to fill. If it brings an
  open cursor (the cancel lost the race), that cursor is closed.
- **A failed tab close puts the tab back** with its results (see
  `closeTab`). The run ended with the close, so a `running` result there
  becomes `canceled` with the text "Query canceled.", and no tab stays
  loading forever.

### Model

`ResultTab` becomes a union on `kind`. The type checker then finds every
place that assumes rows. Pin, close and the tab buttons use only the shared
fields.

```ts
interface ResultBase {
  id: string; // the query-id, which is also the backend's result id
  sql: string;
  pinned: boolean;
}

export interface RowsResult extends ResultBase {
  kind: "rows";
  columns: Column[];
  rows: Cell[][];
  cursor: CursorState;
  fetching: boolean;
  elapsedMs: number;
  selectedRow: number | null;
}

export type ResultTab =
  | RowsResult
  | (ResultBase & { kind: "running" })
  | (ResultBase & { kind: "update"; text: string; elapsedMs: number })
  | (ResultBase & { kind: "error" | "canceled"; text: string });
```

New helpers in `state/store.ts`, used wherever code needs a rows result:

```ts
export function findRows(tabId: string, resultId: string): RowsResult | undefined;
export function updateRows(tabId: string, resultId: string, f: (r: RowsResult) => RowsResult): void; // no-op for other kinds
export function closedCursor(r: ResultTab): ResultTab; // open rows become closed and not fetching; anything else unchanged
```

`closedCursor` replaces the three copies of the `r.cursor === "open"` map
(two in `runStatements`, one in `closeCursors`).

`showsResult` stays named as it is but is true only for a `rows` result: it
gates ⌘R and the Focus Result command, which need a grid.

### Run flow

`runStatements` keeps its structure: the gate, the drop of unpinned results,
the loop, the `finally`. The changes:

- The first `updateTab` no longer sets `active`.
- `lastResult` and `failed` go. A `previous` variable (the previous
  statement's query id, `null` for the first) takes their place.
- After the "stop or disconnected" check, the per-statement `updateTab`
  appends the placeholder and moves focus:

  ```ts
  results: [...t.results.map(closedCursor), { kind: "running", id: queryId, sql: stmt.text, pinned: false }],
  active: previous === null || t.active === previous ? queryId : t.active,
  ```

- On a reply, `updateResult` turns the placeholder into `rows` or `update`,
  keeping `pinned` (it can be pinned while it runs). If the tab was closed
  meanwhile and the reply has `has-more` and is `live`, call
  `api.closeResult(queryId)`.
- On an error, `updateResult` turns it into `error` or `canceled`, and if
  the tab is still there it becomes `active`. Then `break`.
- `finally` keeps `runningQueryId: null`, `stopping: false` and
  `runStartedAt: null`, and no longer touches `active`.

`closeResult` calls `cancel(tabId)` for a `running` result, and closes the
cursor only for an open `rows` result.

### Testing

`state/runner.test.ts` covers the flow, with no store or API mocks beyond the
existing ones. `frontend/e2e` covers what a user sees. Several specs read the
Messages log after a run; it is no longer shown then, so they read the new
outcome body (a `region` named "Statement outcome") instead, or select
Messages first where the history is the point.

## File Structure

| File | Change |
|---|---|
| `frontend/src/state/store.ts` | `ResultTab` union, `RowsResult`, `findRows`, `updateRows`, `closedCursor`; `isRunning`, `showsResult`, `closeCursors` narrowed |
| `frontend/src/state/runner.ts` | the run flow above; refusal toast; `closeResult`, `closeTab`, `fetchMore`, `loadAll`, `exportResult`, `selectRow` narrowed |
| `frontend/src/components/ResultOutcome.tsx` | new: the body of a tab with no rows |
| `frontend/src/components/ResultTabs.tsx` | picks the grid or the outcome; comment |
| `frontend/src/components/ResultFooter.tsx` | footer by kind; comment |
| `frontend/src/components/RowDetails.tsx` | rows results only |
| `frontend/src/components/ExportMenu.tsx`, `frontend/src/grid/ResultGrid.tsx` | take `RowsResult` |
| `frontend/src/state/palette.ts` | comment |
| `frontend/src/state/*.test.ts` | fixtures get `kind: "rows"`; run-flow tests change |
| `frontend/e2e/*.spec.ts` | read the outcome body; new script and cancel checks |
| `docs/DESIGN.md` | Results and pinning, run policy, keys, the no-status-bar paragraph |

## Tasks

Run commands from the repo root, on a feature branch.

### Task 1: The result union, with no change in behavior

**Files:**
- Modify: `frontend/src/state/store.ts`, `frontend/src/state/runner.ts`, `frontend/src/components/ResultTabs.tsx`, `frontend/src/components/ResultFooter.tsx`, `frontend/src/components/RowDetails.tsx`, `frontend/src/components/ExportMenu.tsx`, `frontend/src/grid/ResultGrid.tsx`
- Test: `frontend/src/state/store.test.ts`, `frontend/src/state/status.test.ts`, `frontend/src/state/commands.test.ts`, `frontend/src/state/palette.test.ts`, `frontend/src/state/runner.test.ts`

- [x] **Step 1: Write implementation**
  Add the types and helpers from Design > Model. `isRunning` checks `r.kind === "rows" && r.fetching`. `showsResult` requires a `rows` result. `ResultGrid`, `rowsText` and `ExportMenu` take `RowsResult`. `RowDetails`'s selector returns only a `rows` result. `ResultTabs` renders the grid only for `current?.kind === "rows"`, otherwise `MessagesView`; `ResultFooter` treats a non-rows result as no result (Task 4 fills in both). In `runner.ts`, `runStatements` builds results with `kind: "rows"`, and `fetchMore`, `loadAll`, `exportResult` and `selectRow` use `findRows`/`updateRows`; `closeResult` and the failed-close path in `closeTab` narrow on `kind`. Use `closedCursor` for the three maps.

- [x] **Step 2: Add `kind: "rows"` to the test fixtures**
  Fixtures in `store.test.ts` and `status.test.ts`, and the `{ id: "r1" }` casts in `palette.test.ts` and `commands.test.ts`. Add one test in each of `palette.test.ts` and `commands.test.ts`: an active `update` result gives no ⌘R focus and no Focus Result command.

- [x] **Step 3: Run tests and the type check**
  Run: `npm --prefix frontend run build && npm --prefix frontend test`
  Expected: PASS, with no change to run behavior.

- [x] **Step 4: Commit**
  `git commit -m "Model result tabs as a union on kind"`

### Task 2: A tab for every statement

**Files:**
- Modify: `frontend/src/state/runner.ts`
- Test: `frontend/src/state/runner.test.ts`

- [ ] **Step 1: Write the failing tests**
  In `describe("runStatements")`:
  - A run shows a `running` tab, active, while `api.run` is pending, and it keeps its id when filled.
  - A statement with no rows ends as an `update` tab with its text and time, active (replaces "shows messages for a run with no rows"). A DDL reply says "Done".
  - A script of select, update, select gives three tabs in order, and the last is active.
  - An error ends as an `error` tab, active, and the script stops (replaces the `MESSAGES` assertion in "stops a script at the first error"). The message is still logged.
  - A cancel ends as a `canceled` tab with "Query canceled.".
  - A Stop that loses the race to a successful reply keeps that statement's outcome, and the script sends nothing more.
  - A pinned active result loses focus to the running tab and keeps its rows.
  - A pin set on a running tab survives the fill.
  - A user who selected an earlier result mid-script stays there when the next statement starts; the same user is moved to the tab of a statement that fails.
  - Selecting Messages mid-script holds too.
  - Closing the running tab calls `api.cancel`, stops the script, adds no tab; a late reply with `has-more` calls `api.closeResult`.

  Rewrite "does not activate a result closed while the script ran on": closing an earlier result mid-script leaves the running tab active, and the script's `update` tab active at the end.

  In `describe("closing and reopening")`, "a failed close of a running tab": after the close, the restored tab's result for the cancelled statement is `canceled`, the earlier results are as they were, and the late reply changes nothing.

- [ ] **Step 2: Run them to see them fail**
  Run: `npm --prefix frontend test -- src/state/runner.test.ts`
  Expected: the new tests FAIL.

- [ ] **Step 3: Implement the run flow**
  As in Design > Run flow. In the failed-close path of `closeTab`, map a `running` result to `{ ...r, kind: "canceled", text: "Query canceled." }`. Update the comment above `runStatements`.

- [ ] **Step 4: Run tests**
  Run: `npm --prefix frontend test`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git commit -m "Give every statement of a run its own result tab"`

### Task 3: A read-only refusal is a toast

**Files:**
- Modify: `frontend/src/state/runner.ts`
- Test: `frontend/src/state/runner.test.ts`

- [ ] **Step 1: Write the failing test**
  Change "read-only refuses a script with a write, sending nothing": run a `select` first and select its result. The refused run leaves `results` and `active` as they were, adds the error to `messages`, and calls `notify.error` with the text and the id `run-refused`.

- [ ] **Step 2: Implement**
  In the `refuse` branch of `runStatements`, keep `addMessage`, add `notify.error(text, { id: "run-refused" })`, and drop the `active: MESSAGES` update.

- [ ] **Step 3: Run tests**
  Run: `npm --prefix frontend test -- src/state/runner.test.ts`
  Expected: PASS.

- [ ] **Step 4: Commit**
  `git commit -m "Show a read-only refusal as a toast"`

### Task 4: Show the outcome in the tab

**Files:**
- Create: `frontend/src/components/ResultOutcome.tsx`
- Modify: `frontend/src/components/ResultTabs.tsx`, `frontend/src/components/ResultFooter.tsx`, `frontend/src/state/palette.ts`

- [ ] **Step 1: Write `ResultOutcome`**
  Takes a non-rows result. Renders `<div role="region" aria-label="Statement outcome" className="h-full overflow-auto p-4 text-sm">`, empty for `running`, otherwise the text in a `<p className="break-words whitespace-pre-wrap">`: `text-destructive` for `error`, `text-muted-foreground` for `canceled`.

- [ ] **Step 2: Wire it up**
  `ResultTabs`: a `rows` result gets `ResultGrid`, any other result gets `ResultOutcome`, and no selected result gets `MessagesView`. Update its comment. `ResultFooter`: `words` as before; otherwise `rows` as today; `update` shows its text and `{elapsedMs.toLocaleString()} ms`, in the same places; every other kind has no footer. Update its comment, which still says the footer shows over Messages. Reword the ⌘R comment in `palette.ts`: nothing without a grid.

- [ ] **Step 3: Type check, tests, lint**
  Run: `npm --prefix frontend run build && npm --prefix frontend test && npm --prefix frontend run lint`
  Expected: PASS.

- [ ] **Step 4: Commit**
  `git commit -m "Show updates and errors in their result tab"`

### Task 5: End-to-end specs

**Files:**
- Modify: `frontend/e2e/query-loop.spec.ts`, `frontend/e2e/structure.spec.ts`, `frontend/e2e/workspaces.spec.ts`, `frontend/e2e/run-policy.spec.ts`

Where a spec needs the body: `const outcome = (page: Page) => page.getByRole("region", { name: "Statement outcome" });`

- [ ] **Step 1: `query-loop.spec.ts`**
  - The script test is now "a script gives each statement its own tab": `resultTabs` has `Messages` and the three statements. The update's tab shows "1 row affected" in `outcome`. Selecting Messages still shows the log with that text.
  - "Stop cancels a runaway query": while running, the selected result tab is the statement and the footer says "Running…". After Stop, `outcome` shows "Query canceled.", and the footer has count 0 (reword the comment: a canceled tab has no footer).
  - "the Stop key cancels": read `outcome`.
  - "each editor tab is its own session": read "Done" and "no such table: only_here" from `outcome`.

- [ ] **Step 2: `structure.spec.ts`, `workspaces.spec.ts`**
  - `runText` waits for the selected result tab to have `title` equal to the SQL, then for `outcome` to contain "Done". The order matters: the old tab's "Done" would pass on its own, and the new running tab's body is empty.
  - `workspaces.spec.ts`: read "no such table: only_a" from `outcome`; drop the `messages` helper if nothing else uses it.

- [ ] **Step 3: `run-policy.spec.ts`**
  The refusal: expect the toast text to be visible, and the log still contains it (a fresh tab stays on Messages). After Run on the confirmed statement, expect "Done" in `outcome`, not `log`.

- [ ] **Step 4: Run them**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e`
  Expected: all PASS. If a spec not listed here fails because it read Messages after a run, fix it the same way.

- [ ] **Step 5: Commit**
  `git commit -m "Update e2e specs for statement result tabs"`

### Task 6: Design doc

**Files:**
- Modify: `docs/DESIGN.md`

- [ ] **Step 1: Update the text**
  - Results and pinning (around line 305): every statement gets a tab, from when it starts, and what it holds. Replace "Each row-returning statement of a run gets its own result tab". Say Messages is the history, focus follows the running statement, and a failed statement's tab takes focus.
  - Run policy (line 426): a refusal is a toast and a line in the messages; the results do not change.
  - No status bar (line 484): the footer also has an update's count and time.
  - Keys (line 649): ⌘R does nothing on Messages or on a result with no rows.

- [ ] **Step 2: Commit**
  `git commit -m "Design: a result tab per statement"`
