# Cancel a Stuck Connect Implementation Plan

**Status: completed**

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every place Quel dials a database can be stopped by the user,
instead of only by the connect timeout. That covers Connect, the profile
dialog's Test, a tab's first run, and the reconnect after a lost session.

**Tech Stack:** letgo-packages `sql` (Go shim) and its release round;
let-go in Quel (`quel.conn`, `quel.exec`, `quel.api`); React 19, zustand,
Tailwind, lucide; Vitest; Playwright.

---

## Design

### Where this starts

Nothing that dials can be cancelled today. Each dial is bounded only by
pgx's connect timeout, which is 10 s unless the profile sets
`connect_timeout`. pgx 5.10 applies it per resolved address
(`pgconn.go`, `connectPreferred`), so a host with an IPv6 and an IPv4
address can hang for 20 s or more.

| Dial | Where | Why it can't be cancelled |
|---|---|---|
| Connect | `quel.conn/connect` → `ping!` | `(.Ping handle)` uses `context.Background` |
| Test | `quel.conn/check!` → `ping!` | same |
| A tab's first run | `quel.conn/session!` | `shim/Conn` uses `context.Background`. `:sessions-db` keeps no idle connections, so every new session dials |
| Reconnect | `quel.exec/reconnect!` → `session!` | same |

In the UI:
- while connecting, the row's plug button is disabled
  (`ConnectionsPanel.tsx`, `disabled={pending}`);
- `deleteProfile` refuses with "Wait for the connection to finish
  opening." (`state/profiles.ts`);
- the dialog's Delete is disabled (`ProfileDialog.tsx`, `pending`).

So a stuck connect locks the profile until the timeout.

A context passed in does reach pgx's dial. This was checked in the
sources:
- `database/sql`'s `db.conn(ctx)` calls `connector.Connect(ctx)`;
- pgx's stdlib `connector.Connect` calls `pgx.ConnectConfig(ctx, ...)`;
- `connectPreferred` derives each attempt's timeout from that context.

### Upstream: `ConnCtx` in letgo-packages `sql`

let-go cannot build a `context.Context`, and `shim/Conn` takes none.
Add to `sql/shim/shim.go`:

```go
// ConnCtx is Conn under a cancellable Ctx: cancelling ctx stops the wait
// for a connection, the dial included. ctx bounds only the taking; the
// session it returns outlives it.
func ConnCtx(db *sql.DB, ctx *Ctx) (*sql.Conn, error) {
	return db.Conn(ctx.ctx)
}
```

`database/sql` uses that context only to obtain the connection, so
cancelling it afterwards leaves the session usable. A test pins this down.

Release round, per letgo-packages' README ("When `sql/` changed"):
- tag `sql-v0.4.0`;
- point `sqlite`, `postgres`, `duckdb` and `ragtime` at it;
- tag `sqlite-v0.4.0`, `postgres-v0.5.0`, `duckdb-v0.4.0` and
  `ragtime-v0.4.0`.

The `sql` shim is in-tree (`:go/local`), so there is no Go module tag to
cut. The user authorized branching, pushing, opening and merging the PRs,
and pushing these five tags during this plan. Push each tag by name,
never `--tags`, and never move a pushed tag.

### Quel backend

**Connect attempts.** A new component `:quel.conn/attempts`: an atom of
`{attempt-id <shim Ctx>}`. Two functions in `quel.conn`:

```clojure
(defn attempt!
  "Call (f ctx) with a fresh shim Ctx, registered under attempt-id (when
   given) so cancel-attempt! can stop it. Deregisters and cancels it when
   f returns." [attempts attempt-id f])

(defn cancel-attempt!
  "Cancel the attempt; true if one was running." [attempts attempt-id])
```

An attempt-id the frontend reuses while it is still running throws, as
`exec/register!` does for query ids. `halt-key!` cancels whatever is
still registered.

There is no tombstone for a cancel that arrives before its connect is
registered. Bridge calls run concurrently, so this can happen. The
frontend already treats the connect as abandoned once it cancels (see
below), and closes a connection that lands late. The backend dial then
runs on to its timeout, which is harmless.

**Dialing under a ctx** (`quel.conn`):
- `ping!` takes the ctx and runs `(shim/ExecCtx handle ctx "select 1" [])`
  in place of `.Ping`. This works on Postgres and Redshift. On failure:
  - if `(.Canceled ctx)`, throw `(ex-info "Connecting canceled."
    {:canceled true})`;
  - otherwise throw the redacted error, as today.
- `connect`, `open-target!` and `check!` gain a ctx argument, passed down
  to `ping!`. Keep the old arities, which use a fresh `(shim/NewCtx)`, so
  `open!` and the tests that use them keep working. SQLite is unchanged:
  `open-target!` does not ping it, and `check!` keeps running its
  `select 1` without a ctx (it is a local file).
- `session!` gains an optional ctx. With one, it takes the connection
  through `(shim/ConnCtx handle ctx)`; without one, through `shim/Conn`, as
  today. Its swap and race handling stay as they are.

**Handlers** (`quel.api`, registered by var like the rest):
- `connect [env profile-id attempt-id]`: the body runs inside
  `(conn/attempt! attempts attempt-id #(conn/open-target! conns t %))`.
- `test-connection [env m attempt-id]`: the same, around `check!`.
- `cancel-connect [env attempt-id]` → `{:canceled bool}`.

`connect` and `test-connection` keep their two-argument arities, which
delegate with a nil attempt id. The existing tests (`api_test.lg`,
`pg_test.lg`) and any smoke call use those. With a nil id, the dial
simply can't be cancelled. The Keychain read stays outside the
attempt, as now: it does not take a context.

**A tab's first run** (`quel.exec/run!`). Pass the run's own `ctx` to
`session!`. That ctx is registered before the session is taken, so Stop
(`cancel!` on the query id) already reaches it. A cancelled dial then
fails, `fail!` finds no session, and the run throws "Query canceled.", as
any cancelled run does.

**Reconnect** (`quel.exec/reconnect!`):
- it takes `execs` and `query-id` too, and dials under a fresh ctx
  (`rctx`);
- before dialing, it swaps `rctx` into the query's exec entry, if that
  entry is still there and `:running`. `cancel!` then cancels the
  reconnect. The run's own ctx may already be cancelled (the user
  stopped the run), so it can't be reused;
- if `rctx` was cancelled, `{:error "canceled"}`, so the message reads
  "Could not reconnect (canceled): the next run tries again.";
- `rctx` is cancelled in a `finally`.

`fail!` passes `execs` through. A page read's entry has already been
taken before `fail!` (`fetch-page!`), so its reconnect can't be cancelled
and stays bounded by the timeout. That is accepted.

A run that the user already stopped leaves the tab in `stopping`, so a
second Stop press may not be possible from the UI. The case this covers
is a run that failed by itself (a write failed on a connection that died
in sleep), followed by a reconnect that hangs.

### Quel frontend

**Connect** (`state/runner.ts`):
- A module-level `Map<profileId, attemptId>` holds the attempt in flight.
- `connectProfile` makes an attempt id with `newId()`, records it, and
  calls `api.connect(id, attemptId)`.
- When the call settles, the attempt counts only if the map still holds
  that id for the profile:
  - **success, still current:** connected, as today;
  - **success, abandoned** (cancelled, or the workspace was dropped):
    `api.closeDb` the new connection, and leave the state alone;
  - **failure, still current:** disconnected with the error, as today;
  - **failure, abandoned:** nothing. The user cancelled; there is no error
    to show.
  - Delete the map entry only if it is still this attempt.
- New `cancelConnect(profileId)`:
  - returns at once unless the status is `"connecting"`;
  - removes the attempt from the map;
  - sets the status to `"disconnected"` with `error: null` **at once**,
    not after the backend replies, so the UI never waits on a phase that
    ignores the ctx;
  - calls `api.cancelConnect(attemptId)` and ignores its result and
    errors.
- A new connect after a cancel starts a new attempt. The old call
  unwinding in the background changes nothing, because it is no longer
  current.

**Delete while connecting** (`state/profiles.ts`). `deleteProfile` calls
`cancelConnect(id)` instead of refusing, then deletes as usual. The
existing "a connect still opening when the delete ends is closed when it
lands" path still applies. Deleting while disconnecting is still refused.
In `ProfileDialog.tsx`, Delete is disabled only while disconnecting.

**Where Cancel shows:**
- **Connections row** (`ConnectionsPanel.tsx`). While connecting, the plug
  button is enabled and shows lucide's `XIcon`. It is labelled `Cancel
  connecting <name>`, with the title `Cancel`, and calls `cancelConnect`.
  It keeps the pulse. While disconnecting it stays disabled. In the
  context menu, the first item reads `Cancel connecting` while connecting.
- **The not-connected banner** (`ResultTabs.tsx`, `NotConnected`). While
  connecting, the button reads `Cancel`, is enabled, and calls
  `cancelConnect`. Its aria-label is `Cancel connecting to <name>`.
- **The structure tree** (`StructureTree.tsx`). After "Connecting…", a
  small ghost `Cancel` button.
- **The palette** (`state/commands.ts`). A `cancel-connect` command
  ("Cancel Connecting", group Connection) while the selected workspace is
  connecting.

**Test** (`ProfileDialog.tsx`, `state/profiles.ts`):
- `testConnection(input, attemptId)` passes the id on.
- While testing, the Test button is enabled and reads `Cancel`. A click
  calls `api.cancelConnect(id)` and sets the state back to `idle`.
- Closing the dialog while a test runs cancels it too.
- A result that arrives after a cancel is dropped. The dialog's existing
  `revision` check already drops results from an older form; give the
  test its own token so a cancel drops it the same way.

### Messages

| Case | What the user sees |
|---|---|
| Connect cancelled | The row is back to not connected, with no error |
| Test cancelled | The Test result area is empty again |
| First run's dial stopped | The usual "canceled" message for the statement |
| Reconnect stopped | The red lost-connection error, "Could not reconnect (canceled): the next run tries again." |

The backend's "Connecting canceled." is what a smoke script or the logs
see. The frontend doesn't show it, because it knows it cancelled.

### Testing

- **letgo-packages `postgres`** (`test/postgres/core_test.lg`,
  `with-stalling-server`, no Postgres needed). `conn-ctx-stops-a-stalled-dial`:
  `(shim/ConnCtx db ctx)` against the stalling port with
  `connect_timeout=30`, with a future that cancels after 300 ms. It throws
  in under 3 s, and `(.Canceled ctx)` is true.
- **letgo-packages `sqlite`** (`test/sqlite/core_test.lg`).
  `conn-ctx-session-outlives-its-ctx`: take a session with `ConnCtx`,
  cancel the ctx, and the session still runs
  `select 1` and keeps a temp table across calls.
- **Quel `test/quel/conn_test.lg`**, against a silent port, with no
  Postgres. Make one with let-go's `net/listen` on `127.0.0.1` port 0,
  read the port back with `net/local-address`, and never accept: the
  kernel completes the handshake, and pgx waits for the server's reply.
  If that doesn't stall, copy `with-stalling-server`'s python3 approach
  from the postgres package. Use `connect_timeout='30'`, so only a cancel
  ends it quickly. The tests:
  - `open-target!` under a ctx cancelled after 300 ms throws "Connecting
    canceled." in under 3 s, with `{:canceled true}` in its ex-data, and
    leaves the registry empty;
  - `check!` behaves the same way;
  - `attempt!`/`cancel-attempt!`:
    - a cancel stops the attempt;
    - `cancel-attempt!` on an unknown id is false;
    - the id is deregistered afterwards;
    - a duplicate id that is still running throws;
  - `session!` with a ctx against a hand-built entry whose
    `:sessions-db` is `(pg/open <silent url>)`: a cancel after 300 ms
    throws fast, and no session is registered.
- **Quel `test/quel/exec_test.lg`**, the same hand-built entry. Start
  `run!` in a future, then `cancel!` its query id after 300 ms. The run
  throws "Query canceled." in under 3 s, and the exec registry is empty.
- **Quel `test/quel/api_test.lg`**:
  - `connect` with an attempt id against a Postgres profile on the silent
    port. A `cancel-connect` from a future ends it with "Connecting
    canceled.", and `cancel-connect` answers `{:canceled true}`;
  - the two-argument `connect` and `test-connection` still connect a
    SQLite profile;
  - add `"cancel-connect"` to the handler-name list the handler test
    checks (`api_test.lg`, around line 50).
- **Quel `test/quel/pg_test.lg`** (`lgx test-pg`): a reconnect that
  stalls can be stopped. Build an entry whose `:sessions-db` is the silent
  port, and put under its session-id a real session from the test
  Postgres. Terminate that session's backend (`pg_terminate_backend` from
  the test pool) and `run!` `select 1` in a future. Once the run is in its
  reconnect, `cancel!` it. Polling for the rctx swap is good enough; a
  fixed 1 s wait after the probe is acceptable if polling is awkward. The
  error's ex-data has `:lost {:reconnected false}`, and the message
  contains "Could not reconnect (canceled)".
- **Quel `frontend/src/state/runner.test.ts`** (mock `api.connect` with a
  pending promise):
  - `cancelConnect` sets disconnected at once, with no error, and calls
    `api.cancelConnect` with the attempt id given to `api.connect`;
  - a late success after a cancel calls `closeDb` and stays disconnected;
  - a late failure after a cancel shows no error;
  - a connect after a cancel uses a new attempt id, and its result counts
    while the first one's doesn't;
  - `cancelConnect` when not connecting does nothing.
- **Quel `frontend/src/state/profiles.test.ts`**: deleting while
  connecting cancels the attempt and deletes. This replaces any test of
  the old refusal.
- **Quel `frontend/src/state/commands.test.ts`**: `cancel-connect` shows
  only while connecting, and calls `cancelConnect`.
- **Quel Playwright** (`frontend/e2e/cancel-connect.spec.ts`, no Postgres).
  Node's `net.createServer()` accepts and never answers, on port 0.
  - Make a Postgres profile on `127.0.0.1:<port>` with database `x` and
    user `x`. Click Connect, and the row's `Cancel connecting <name>`
    button shows. Click it; within 2 s the banner says "Not connected"
    and the row shows no error.
  - In the profile dialog, Test shows Cancel. Click it, and the button
    reads Test again with no result shown.
  - Cancel a test, then start another one at once. Point the form at a
    SQLite file for the second, so it passes: only "Connected" shows,
    never a late result from the first.
  - Close the dialog while a test runs, then reopen it: no result shows,
    and the Test button is idle.
  - Connect, then cancel from the palette or the banner. One of the two
    is enough.

## File Structure

letgo-packages (`/home/agent/Projects/letgo-packages`):
- Modify `sql/shim/shim.go`: `ConnCtx`, and the package doc comment's
  context paragraph.
- Modify `sql/README.md`: a `(shim/ConnCtx db ctx)` row in the sessions
  table.
- Modify `postgres/test/postgres/core_test.lg`,
  `sqlite/test/sqlite/core_test.lg`: the tests above.
- Modify `sqlite/lgx.edn`, `postgres/lgx.edn`, `duckdb/lgx.edn`,
  `ragtime/lgx.edn`: the `letgo-sql` coord to `sql-v0.4.0`.
- Modify each package README that names its current tag in an install
  snippet (check with `grep -rn "sql-v0.3.0\|sqlite-v0.3.0\|postgres-v0.4.0\|duckdb-v0.3.0\|ragtime-v0.3.0" */README.md README.md`).

Quel:
- Modify `lgx.edn`: `sqlite-v0.4.0`, `postgres-v0.5.0`, `ragtime-v0.4.0`
  and their comments ("the first with ConnCtx").
- Modify `src/quel/conn.lg`: `attempt!`, `cancel-attempt!`, the
  `::attempts` component, ctx arities of `ping!`, `connect`,
  `open-target!`, `check!` and `session!`.
- Modify `src/quel/exec.lg`: `run!` passes its ctx; `reconnect!` and
  `fail!` as above.
- Modify `src/quel/api.lg`: `connect`, `test-connection` and
  `cancel-connect`.
- Modify `src/quel/system.lg`: `:quel.conn/attempts {}`, and `:attempts`
  in the handlers' env.
- Modify `test/quel/conn_test.lg`, `exec_test.lg`, `api_test.lg` and
  `pg_test.lg`.
- Modify `frontend/src/lib/api.ts`: `connect(profileId, attemptId)`,
  `testConnection(input, attemptId)`, `cancelConnect(attemptId)`.
- Modify `frontend/src/state/runner.ts` (+ `runner.test.ts`): the attempt
  map, `connectProfile`, `cancelConnect`.
- Modify `frontend/src/state/profiles.ts` (+ `profiles.test.ts`):
  `deleteProfile`, `testConnection`.
- Modify `frontend/src/state/commands.ts` (+ `commands.test.ts`).
- Modify `frontend/src/components/ConnectionsPanel.tsx`, `ResultTabs.tsx`,
  `StructureTree.tsx` and `ProfileDialog.tsx`.
- Create `frontend/e2e/cancel-connect.spec.ts`.
- Modify `docs/DESIGN.md`: one paragraph on cancelling a connect.

## Tasks

Put mise's tools on PATH first (`eval "$(mise env -s bash)"`), or `lgx`
will not find `go`. On Linux without GTK4/WebKitGTK headers, prefix
Quel's `lgx` test, smoke and e2e tasks with
`CGO_ENABLED=0 GOFLAGS=-tags=server`.

Quel work goes on the branch `cancel-connect`
(`git switch -c cancel-connect` from an up-to-date `master`).

### Task 1: `ConnCtx` in letgo-packages `sql`

**Files** (in `/home/agent/Projects/letgo-packages`):
- Modify: `sql/shim/shim.go`, `sql/README.md`
- Test: `postgres/test/postgres/core_test.lg`, `sqlite/test/sqlite/core_test.lg`

- [x] **Step 1: Branch.** The local clone may be behind (it lacked
  `wails-v0.8.0`/`v0.9.0` until a fetch).
  `git switch master && git pull --tags && git switch -c sql-conn-ctx`

- [x] **Step 2: Write the failing tests:**
  `conn-ctx-stops-a-stalled-dial` (postgres) and
  `conn-ctx-session-outlives-its-ctx` (sqlite), as in Design → Testing.

- [x] **Step 3: Run them to see them fail.**
  Run: `cd postgres && lgx test` and `cd sqlite && lgx test` (with the
  packages' server-mode or tag flags if their READMEs say so).
  Expected: both fail, because `shim/ConnCtx` does not exist.

- [x] **Step 4: Implement `ConnCtx`** as in the Design, and register it
  in the shim's `init()`: `ns.Def("ConnCtx", vm.MustBox(ConnCtx))`, next
  to `Conn`. The namespace is registered by hand, so a Go function alone
  doesn't reach let-go. Update the package comment's context bullet
  ("QueryCtx, ExecCtx and ConnCtx take it").

- [x] **Step 5: Run the tests.** Run the same two commands, and also
  `cd sql && lgx test`. Expected: PASS, the old tests included.

- [x] **Step 6: Document.** Add a row to `sql/README.md`'s table:
  `(shim/ConnCtx db ctx)`, "`Conn` under `ctx`: a cancel stops the wait
  and the dial. The session outlives `ctx`." Use /writing-clearly.

- [x] **Step 7: Commit, push, PR.**
  ```bash
  git add sql postgres sqlite
  git commit -m "sql: ConnCtx takes a session under a cancellable context"
  git push -u origin sql-conn-ctx
  gh pr create --title "sql: ConnCtx, a cancellable Conn" --body "<what and why: Quel cancels a stalled session dial>"
  ```
  Link the PR (`link_pull_request`) and watch it (`watch_pull_request`).

- [x] **Step 8: Merge and tag** once the checks pass:
  ```bash
  gh pr merge --merge --delete-branch
  git switch master && git pull
  git tag sql-v0.4.0 && git push origin sql-v0.4.0
  ```
  Unwatch the PR.

### Task 2: Release the dependents

**Files** (in `/home/agent/Projects/letgo-packages`):
- Modify: `sqlite/lgx.edn`, `postgres/lgx.edn`, `duckdb/lgx.edn`,
  `ragtime/lgx.edn`, and any READMEs found by the grep in File Structure

- [x] **Step 1: Branch and bump.** `git switch -c sql-v0.4.0-dependents`.
  Set each `letgo-sql` coord to `"sql-v0.4.0"`, byte for byte the same
  in all four, and update the install snippets that name the old tags.

- [x] **Step 2: Check.** Run `lgx test` in `sqlite`, `postgres` and
  `ragtime`. ragtime resolves `sql` through the tag, so this checks that
  the tag resolves. For duckdb, run its tests if a C toolchain is present;
  otherwise note that they were skipped. Expected: PASS.

- [x] **Step 3: Commit, push, PR, merge** as in Task 1, with the commit
  message `Point sqlite, postgres, duckdb and ragtime at sql-v0.4.0`.
  Link, watch and unwatch the PR.

- [x] **Step 4: Tag the merge commit** on master, one push per tag:
  ```bash
  git switch master && git pull
  for t in sqlite-v0.4.0 postgres-v0.5.0 duckdb-v0.4.0 ragtime-v0.4.0; do
    git tag "$t" && git push origin "$t"
  done
  ```

### Task 3: Quel picks up the release

**Files:**
- Modify: `lgx.edn`

- [x] **Step 1: Branch.** In Quel:
  `git switch master && git pull && git switch -c cancel-connect`

- [x] **Step 2: Bump** the sqlite, postgres and ragtime coords and their
  comments. Check `docs/` and `README.md` for pins of the old tags that
  describe the current version (not history), and update them.

- [x] **Step 3: Run the tests.**
  Run: `lgx test && lgx test-pg`. Expected: PASS, with nothing else
  changed.

- [x] **Step 4: Commit.**
  `git commit -am "Pin sql-v0.4.0's dependents (ConnCtx)"`

### Task 4: Connect attempts and dialing under a ctx (`quel.conn`)

**Files:**
- Modify: `src/quel/conn.lg`, `src/quel/system.lg`
- Test: `test/quel/conn_test.lg`

- [x] **Step 1: Write the failing tests** from Design → Testing for
  `open-target!`, `check!`, `attempt!`/`cancel-attempt!` and `session!`.
  Write a `with-silent-port` helper first and check that it stalls a
  plain `open-target!` with `connect_timeout='2'` for about 2 s. If it
  doesn't, use the python3 server.

- [x] **Step 2: Run them to see them fail.**
  Run: `lgx test`. Expected: the new tests fail (no ctx arities, no
  `attempt!`).

- [x] **Step 3: Implement** `ping!` with `ExecCtx`, the ctx arities,
  `attempt!`, `cancel-attempt!`, and the `::attempts` component with its
  `halt-key!`. Wire `:quel.conn/attempts {}` into `system.lg`'s config,
  and `:attempts (ig/ref :quel.conn/attempts)` into the handlers' env.
  Update the namespace comment: what `:attempts` is for, and that dials
  run under a ctx.

- [x] **Step 4: Run the tests.** Run: `lgx test`. Expected: PASS.

- [x] **Step 5: Commit.**
  `git commit -am "Dial under a cancellable context, and track connect attempts"`

> Deviation: the `quel.conn` code was written before its tests (while the upstream PRs waited on CI), so the tests never ran red first. A silent-port check confirms they test a real stall. The `quel.exec` tests were run against the old `exec.lg` and fail there.

### Task 5: A tab's first run and the reconnect (`quel.exec`)

**Files:**
- Modify: `src/quel/exec.lg`
- Test: `test/quel/exec_test.lg`, `test/quel/pg_test.lg`

- [x] **Step 1: Write the failing tests:** the `run!` cancel during the
  dial (`exec_test.lg`), and the stalled reconnect (`pg_test.lg`).

- [x] **Step 2: Run them to see them fail.**
  Run: `lgx test-pg`. Expected: both hang until their timeout (keep it at
  30 s or less, so the failure is quick), then fail.

- [x] **Step 3: Implement.**
  - `run!` passes `ctx` to `session!`.
  - `reconnect!` takes `execs` and `query-id`, swaps `rctx` into the
    entry when it is `:running`, maps a cancel to `{:error "canceled"}`,
    and cancels `rctx` in `finally`.
  - `fail!` takes `execs`; update both callers.
  - Update `reconnect!`'s docstring, and `docs/DESIGN.md`'s "Connecting
    is bounded by..." sentence: Stop now ends it too, except during a
    page read.

- [x] **Step 4: Run the tests.** Run: `lgx test-pg`. Expected: PASS.

- [x] **Step 5: Commit.**
  `git commit -am "Stop ends a tab's session dial and its reconnect"`

### Task 6: The handlers (`quel.api`)

**Files:**
- Modify: `src/quel/api.lg`
- Test: `test/quel/api_test.lg`

- [x] **Step 1: Write the failing tests** from Design → Testing.

- [x] **Step 2: Run them to see them fail.** Run: `lgx test`.

- [x] **Step 3: Implement** `connect`, `test-connection` with
  `attempt-id`, and `cancel-connect`, registered by var in `handlers`.

- [x] **Step 4: Run the tests and the smoke test.**
  Run: `lgx test && lgx smoke`. Expected: PASS. Smoke calls `connect`
  without an attempt id, if it calls it at all.

- [x] **Step 5: Commit.**
  `git commit -am "Add cancel-connect, and take an attempt id on connect and test"`

> Deviation (from the Task 7 review): `connect` and `test-connection` now register the attempt before the Keychain read, not just around the dial. A cancel during that read was lost and the dial still ran. Commit "Register a connect attempt before its Keychain read", with a test that a context cancelled before the dial never dials.

### Task 7: Cancel in the frontend state

**Files:**
- Modify: `frontend/src/lib/api.ts`, `frontend/src/state/runner.ts`,
  `frontend/src/state/profiles.ts`, `frontend/src/state/commands.ts`
- Test: `frontend/src/state/runner.test.ts`, `profiles.test.ts`,
  `commands.test.ts`

- [x] **Step 1: Write the failing tests** from Design → Testing.
  `runner.test.ts` mocks all of `@/lib/api`, so add `cancelConnect` to
  that mock, and to the mocks in `profiles.test.ts` and
  `commands.test.ts`.

- [x] **Step 2: Run them to see them fail.**
  Run: `npm --prefix frontend test`. Expected: the new tests fail.

- [x] **Step 3: Implement** the api functions, the attempt map,
  `connectProfile`, `cancelConnect`, `deleteProfile` and the palette
  command, as in the Design. Rewrite `connectProfile`'s comment and
  `deleteProfile`'s ("Refused while it connects..." becomes "A connect in
  flight is cancelled first").

- [x] **Step 4: Run the tests.**
  Run: `npm --prefix frontend test`. Expected: PASS.

- [x] **Step 5: Commit.**
  `git commit -am "Cancel a connect in flight from the frontend"`

> Deviation: the dialog's Test/Cancel moved into this task's commit, because `testConnection`'s new argument would otherwise leave the commit failing the typecheck. The button reads "Cancel test", not "Cancel", since the footer already has a Cancel that closes the dialog. An edit to the form cancels a running Test too.

### Task 8: Cancel in the UI

**Files:**
- Modify: `frontend/src/components/ConnectionsPanel.tsx`, `ResultTabs.tsx`,
  `StructureTree.tsx`, `ProfileDialog.tsx`

- [x] **Step 1: Implement:**
  - the row button and the context menu item;
  - the banner button;
  - the tree's Cancel;
  - the dialog's Test/Cancel, the cancel on close, and Delete enabled
    while connecting.

  Update the comments above `ConnectionsPanel` and in `ProfileDialog`
  that describe these. Keep the existing look: ghost `icon-xs` buttons,
  and muted ink for the icon. Use /frontend-design only if the × reads
  wrong next to the plug and stop icons.

- [x] **Step 2: Type check, lint and test.**
  Run: `npm --prefix frontend run build && npm --prefix frontend run lint && npm --prefix frontend test`
  (use the repo's script names if they differ). Expected: PASS.

- [x] **Step 3: Commit.**
  `git commit -am "Show Cancel while connecting or testing a connection"`

> Deviation: committed as "Show Cancel while connecting" (the Test part went with Task 7). The banner keeps "isn't connected." and shows "Connecting…" before its Cancel button.

### Task 9: End to end, and docs

**Files:**
- Create: `frontend/e2e/cancel-connect.spec.ts`
- Modify: `docs/DESIGN.md`

- [x] **Step 1: Write the spec** as in Design → Testing. Use
  `e2e/connect.ts` helpers where they fit; `lost-connection.spec.ts`
  shows how to fill a Postgres profile.

- [x] **Step 2: Run it.**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server bash scripts/e2e.sh cancel-connect.spec.ts`
  (without the prefix on a box with GTK). Expected: PASS. Then run
  `lgx e2e`; expected: the whole suite passes.

- [x] **Step 3: DESIGN.md.** Where connecting and profiles are described,
  add a paragraph covering:
  - every dial runs under a cancellable context;
  - Connect and Test show Cancel while they run, and a cancelled connect
    leaves no error;
  - Stop ends a tab's first-run dial and a reconnect, except during a
    page read;
  - a cancel the backend misses is still handled: the frontend closes a
    connection that lands late.

  Use /writing-clearly.

- [x] **Step 4: Commit.**
  `git commit -am "Test cancelling a connect end to end, and document it"`

> Deviation (from the Task 9 review): the spec points an existing silent profile at the current worker's port. Profiles outlive a Playwright worker, so a retry would otherwise dial a dead port (refused, not stalled).

## Completion summary

What shipped:
- **letgo-packages:**
  - `sql`: `shim/ConnCtx`, which takes a session under a cancellable context ([PR #20](https://github.com/abogoyavlensky/letgo-packages/pull/20)), tagged `sql-v0.4.0`.
  - Dependents ([PR #21](https://github.com/abogoyavlensky/letgo-packages/pull/21)): `sqlite-v0.4.0`, `postgres-v0.5.0`, `duckdb-v0.4.0` and `ragtime-v0.4.0` name it.
- **Quel backend:**
  - Every dial runs under a shim Ctx. The ping is now a cancellable `select 1`.
  - `:quel.conn/attempts` with `attempt!` and `cancel-attempt!`, and a new `cancel-connect` handler.
  - `connect` and `test-connection` take an optional attempt id.
  - A tab's first run dials under the run's ctx. A reconnect dials under a fresh ctx swapped into the run's entry, so Stop ends both.
- **Quel frontend:**
  - `cancelConnect` makes the row not connected at once; a late success is closed and a late failure is ignored.
  - Cancel shows on the row (an ×), in its context menu, the empty-tab banner, the structure tree and the palette.
  - The dialog's Test becomes Cancel test; closing the dialog or editing the form cancels it.
  - Deleting a profile while it connects cancels the connect.

Verified:
- `lgx test` (209) and `lgx test-pg` (209, 745 assertions);
- the frontend tests (574), typecheck and lint;
- `lgx smoke` and `lgx smoke-pg`;
- `lgx e2e` (54 passed, 1 skipped without Postgres), including the new `cancel-connect.spec.ts`, which drives a real stalled connect and Test in the app;
- the letgo-packages tests for sql, sqlite, postgres, ragtime and duckdb.

Deviations, together:
- Task 4's tests were written after the code (it was written while CI ran). They still check a real stall.
- The attempt is registered before the Keychain read (from codex's Task 7 review).
- The Test/Cancel UI went into Task 7's commit; the button reads "Cancel test".
- The e2e spec re-points the silent profile's port (from codex's Task 9 review).
- The session's task list wasn't available, so progress was tracked in this document only.

What the plan could have specified better: it put the attempt around the dial only and called the race before registration harmless. The Keychain read sits before the dial and can take seconds, so the attempt should have wrapped the whole handler from the start.
