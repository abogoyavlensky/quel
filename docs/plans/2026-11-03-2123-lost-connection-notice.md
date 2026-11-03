# Lost Connection Notice Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Quel reconnects a tab whose connection was lost, the user
sees a calm notice: what happened, that all is well again, and, when the
statement was not run, a **Run again** button. They don't see a red
paragraph that reads like a crash.

**Tech Stack:** letgo-packages `wails` (Go shim: the handler bridge);
let-go in Quel (`quel.exec`); React 19, zustand, sonner toasts (through
`lib/notify.ts`), Tailwind; Vitest; Playwright.

---

## Design

### Where this starts

`docs/plans/2026-11-03-2030-reconnect-lost-sessions.md` made Quel
reconnect a dead tab session at once and throw one long message, built by
`quel.exec/lost-message`. In the app it shows as a red error line in the
tab's Messages:

> The connection to the database was lost (FATAL: terminating connection
> due to idle-session timeout (SQLSTATE 57P05)), so the statement was not
> run. Reconnected: the next run uses a new connection. Any open
> transaction, SET values and temp tables in this tab are gone.

The user found it hard to read: it looks like Quel is broken, and "all is
well, just run it again" is buried.

The frontend cannot style it differently today, because it only receives
the error's text. The letgo-packages `wails` bridge turns a thrown
`ex-info` into `errors.New(message)` (`wails/shim/shim.go`,
`handlerError`), which drops the data. Wails v3 itself can carry
structured data: a failed call's `CallError` has a `cause` field, filled
by marshalling the returned error to JSON (`pkg/application/bindings.go`,
`defaultMarshalError`). `@wailsio/runtime` rejects the call with an
error whose `cause` is that value. Today it is the `"cause":{}` in every
error reply.

### Upstream: ex-data reaches the frontend (letgo-packages `wails`)

- `handlerError` returns a `*handlerErr` instead of `errors.New` when
  the thrown value is an `ExInfo`:
  - `Error()` is the message, as now;
  - `MarshalJSON()` is the JSON of `ToGo(ex-data)`, the same conversion
    handler results get (keyword keys lose their colon).

  Wails then sends it as the call error's `cause`.
- Data that fails to encode as JSON marshals as `null`, so the message
  still arrives. Nil ex-data marshals as `{}`, as today (a special case:
  `json.Marshal(nil)` is `null`). A Go value with no exported fields,
  such as a boxed atom, encodes as `{}` without failing; that is
  acceptable.
- A thrown non-`ExInfo` value, a Go error or a VM fault keeps today's
  behaviour.
- This is the whole ex-data, not an opt-in key. The frontend is the
  app's own, and Quel's existing `ex-info` data is ids only (`:conn-id`,
  `:query-id`, `:session-id`). The README says so: don't put secrets in
  ex-data a handler throws.
- The wails shim is in-tree (`{:go/local "shim"}` since wails-v0.2.0),
  so the release is the package tag `wails-v0.8.0` alone (letgo-packages
  README, "Releasing"). `wails-v0.7.0` is the newest commit under
  `wails/`, so nothing else rides along.

### Quel backend: say it in data

`fail!`'s dead branch (`src/quel/exec.lg`) adds `:lost` to the ex-data
it already throws:

```clojure
{:query-id query-id
 :lost {:not-run (not sent?)   ; true: the statement was not run
        :reconnected (:ok reconnect)
        :page (= :page kind)
        :canceled canceled?
        :error error}}         ; the driver's message
```

`:reconnected` is `true` or `false`, never nil, so the JSON is always a
boolean. The message text stays as it is: `lost-message` remains the
plain-text form for logs, smoke tests and any caller that ignores
`cause`.

### Quel frontend: a notice, not an error

**Reading it.** `lib/api.ts` gains `lostOf(e: unknown): Lost | null`. It
reads `(e as { cause?: { lost?: ... } }).cause?.lost` and returns
`{ notRun, reconnected, page, canceled, error }`, or `null` when it is
absent or malformed. That is the one place the JSON shape is known.

**Only a reconnected loss becomes a notice.** If `reconnected` is false,
the run is an error as today (red, the backend's text): Quel could not
reconnect, so the user should see a problem. A canceled loss stays
`"canceled"`, as today, since the user stopped it.

**The message.** `Message.kind` gains `"lost"`, and `Message` gains
optional fields:
- `lost?: Lost`;
- `rerun?: Statement[]`: the failed statement and the ones after it in
  the script. It is set only when `notRun` is true and this is a run,
  not a page read.

Messages live in memory only (they are not in `state/persist.ts`), so
there is no migration.

**Copy** (frontend-owned UI copy; the backend's sentence is the
fallback):

| Case | Headline |
|---|---|
| not run | `Connection lost and restored. The statement was not run.` |
| may have run | `Connection lost and restored. The statement may have completed: check before running it again.` |
| page read | `Connection lost and restored while loading rows. The statement had already run: if it changes data, check before running it again.` |

Then a muted second line:
`Any open transaction, SET values and temp tables in this tab were reset.`
Then a native `<details>` element, summary `Details`, holding the
driver's message in mono.

**Look.** A warning tone, not `text-destructive`: an amber text color
that reads in light and dark themes (match how the app styles other
non-error states; see /frontend-design), with lucide's `PlugZap` icon (or
`RefreshCw` if that reads better) before the headline. The headline uses
the normal weight; the second line and Details use
`text-muted-foreground`.

**Run again.** A small button under the headline, shown when:
- the message has `rerun`;
- it is the tab's newest message;
- the tab is not running.

The label is `Run again` for one statement and `Run the remaining N` for
more. A click calls `runStatements(tabId, rerun)`. That is a normal run:
the profile's run policy judges it again (`sql/guard.ts`), and the
confirm dialog or the read-only refusal applies as for any run.

**Toast.** When a `"lost"` message is added, `notify.info` shows
`<tab title>: connection restored.` with id `lost-<tabId>`, so a second
loss in the tab replaces rather than stacks:
- with `rerun`, it carries `action: { label: "Run again", onClick }`,
  doing the same as the button;
- without, it has no action.

Starting any run in the tab dismisses it (`notify.dismiss("lost-<tabId>")`
at the top of `runStatements`).

**Where it hooks in** (`state/runner.ts`):
- `runStatements`' catch: if `lostOf(e)?.reconnected` and not
  `canceled`, add a `"lost"` message, with `rerun: statements.slice(i)`
  when `notRun`, and toast. Otherwise behave as today. The script stops
  either way (`failed = true`).
- `fetchMore`'s catch: the same for page reads (`page: true`, never
  `rerun`).

### Testing

- letgo-packages `wails/test/wails/bridge_test.lg`. A handler throwing
  `(ex-info "kaboom" {:x 1 :lost {:not-run true}})` answers with a body
  whose JSON has `message` containing `"kaboom"` and
  `cause` = `{"x" 1 "lost" {"not-run" true}}`. A throw whose data
  fails to encode (a `math.NaN` value: `(/ 0.0 0.0)`) still carries the
  message, with `cause` `nil`. `(ex-info "x" nil)` gives `cause` `{}`. The existing
  `a-throwing-handler-is-an-error` keeps passing.
- Quel `test/quel/pg_test.lg`: the lost-connection tests also check
  `(:lost (ex-data e))`, which needs a helper that returns the thrown
  exception rather than its message.
- Quel `frontend/src/state/runner.test.ts`:
  - `api.run` rejects with an `Error` carrying
    `cause: { lost: { "not-run": true, reconnected: true, ... } }`, and
    the message is `"lost"` with `rerun` = the remaining statements;
  - the toast has a Run again action;
  - a click (the action's `onClick`) runs those statements;
  - `reconnected: false` gives an `"error"` message;
  - a page-read loss gives `"lost"` without `rerun`;
  - a "may have completed" loss (`not-run: false`) gives `"lost"`
    without `rerun` and a toast without an action;
  - a canceled loss gives `"canceled"`;
  - a later run dismisses the toast.
- Quel `frontend/src/lib/api.test.ts`: `lostOf` on a good cause, no
  cause, and a malformed one.
- Quel Playwright: a new `frontend/e2e/lost-connection.spec.ts` that
  skips unless `QUEL_PG_URL` is set:
  - make a Postgres profile from `QUEL_PG_URL`'s parts and connect;
  - run `set idle_session_timeout = '1s'`, wait 2 s, then run
    `select 1`;
  - the Messages show "Connection lost and restored. The statement was
    not run." and a Run again button, and the toast shows;
  - clicking Run again produces a result with one row.

  Run with `bash scripts/with-postgres.sh bash scripts/e2e.sh lost-connection.spec.ts`.

## File Structure

letgo-packages (`/home/agent/Projects/letgo-packages`):
- Modify `wails/shim/shim.go`: `handlerErr` and `handlerError`.
- Modify `wails/test/wails/bridge_test.lg`.
- Modify `wails/README.md`: errors carry ex-data as `cause`.

Quel:
- Modify `lgx.edn`: the wails coord to `wails-v0.8.0`.
- Modify `src/quel/exec.lg`: `:lost` in `fail!`'s ex-data.
- Modify `test/quel/pg_test.lg`.
- Modify `frontend/src/lib/api.ts` (+ `api.test.ts`): `Lost`,
  `lostOf`.
- Modify `frontend/src/state/store.ts`: `Message` kind and fields.
- Modify `frontend/src/state/runner.ts` (+ `runner.test.ts`): the
  catches, the toast, the dismissal.
- Modify `frontend/src/components/MessagesView.tsx`: the `"lost"`
  rendering and the Run again button.
- Create `frontend/e2e/lost-connection.spec.ts`.
- Modify `docs/DESIGN.md`: one paragraph on the notice, after "After
  any failed run".

## Tasks

On Linux without GTK4/WebKitGTK headers, prefix Quel's `lgx` test tasks
with `CGO_ENABLED=0 GOFLAGS=-tags=server`. Put mise's tools on PATH first
(`eval "$(mise env -s bash)"`), or `lgx` will not find `go`.

The user authorized pushing, opening, merging and tagging on the
letgo-packages side during this plan, and releasing it. Push one tag by
name, never `--tags`, and never move a pushed tag.

Quel work continues on the branch `reconnect-lost-sessions`.

### Task 1: ex-data through the bridge (letgo-packages wails)

**Files** (in `/home/agent/Projects/letgo-packages`):
- Modify: `wails/shim/shim.go`
- Modify: `wails/README.md`
- Test: `wails/test/wails/bridge_test.lg`

- [ ] **Step 1: Branch.** `git switch master && git pull && git switch -c wails-error-data`

- [ ] **Step 2: Write the failing tests** in `bridge_test.lg`.
  `t/call` returns `:status`, `:body` and `:json`; check `:json` holds
  the error reply, or parse `:body`.
  - `a-thrown-ex-info-carries-its-data`: the handler throws
    `(ex-info "kaboom" {:x 1 :lost {:not-run true}})`. The reply's
    `message` contains `"kaboom"` and its `cause` equals
    `{"x" 1 "lost" {"not-run" true}}`.
  - `unencodable-data-still-carries-the-message`: the data holds NaN
    (`{:x (/ 0.0 0.0)}`; JSON has no NaN, so encoding fails). The
    message arrives and `cause` is `nil`. If let-go's division throws
    instead, use another value that `encoding/json` rejects, such as
    `math.Inf`.
  - `nil-data-is-an-empty-cause`: `(ex-info "x" nil)` (or `{}`) gives
    `cause` `{}`.

- [ ] **Step 3: Run them to see them fail.**
  Run: `cd wails && lgx test` (on Linux without GTK, with the
  package's server-mode tag if its tests need one: see the package
  README).
  Expected: the new tests fail (`cause` is `{}`).

- [ ] **Step 4: Implement.** In `shim.go`:
  - `type handlerErr struct { msg string; data vm.Value }`;
  - `Error()` returns `msg`;
  - `MarshalJSON()` returns `{}` for nil data, else marshals
    `ToGo(data)`, returning `[]byte("null")` with a nil error when that
    fails.

  `handlerError` returns `&handlerErr{ei.Message(), <ex-data>}` for an
  `*vm.ExInfo` (find its data accessor in let-go's `vm` package). Update
  the doc comment.

- [ ] **Step 5: Run the tests.** Expected: PASS, the old ones included.

- [ ] **Step 6: Document.** In `wails/README.md`, where handlers and
  errors are described, add a short section:
  - a thrown `ex-info`'s message is the rejected promise's message, and
    its data is the error's `cause`, converted as results are;
  - data that does not convert arrives as `null`;
  - don't put secrets in it.

  Use /writing-clearly.

- [ ] **Step 7: Commit, push, PR.**
  ```bash
  git add wails && git commit -m "wails: a thrown ex-info's data reaches the frontend as the error's cause"
  git push -u origin wails-error-data
  gh pr create --title "wails: ex-data reaches the frontend as the error's cause" --body "<what and why>"
  ```
  Link the PR (`link_pull_request`) and watch it (`watch_pull_request`).

- [ ] **Step 8: Merge and tag** once the checks pass:
  ```bash
  gh pr merge --merge --delete-branch
  git switch master && git pull
  git tag wails-v0.8.0 && git push origin wails-v0.8.0
  ```
  Unwatch the PR.

### Task 2: `:lost` in the ex-data (Quel backend)

**Files:**
- Modify: `lgx.edn`
- Modify: `src/quel/exec.lg`
- Test: `test/quel/pg_test.lg`

- [ ] **Step 1: Bump** the wails dep in `lgx.edn` to `wails-v0.8.0`.
  Check `docs/` and `README.md` for a pinned `wails-v0.7.0` that
  describes the current version (not history) and update those.

- [ ] **Step 2: Extend the Postgres tests.** Add a `thrown-of-run`
  helper returning the exception. Then:
  - `a-dead-session-reconnects-at-once`: `(:lost (ex-data e))` is
    `{:not-run false :reconnected true :page false :canceled false :error <string>}`;
  - `an-idle-timeout-is-reported-as-not-run`: `:not-run true`;
  - `a-failed-reconnect-is-reported`: `:reconnected false`;
  - `a-page-read-on-a-lost-connection-is-reported`: `:page true`.

- [ ] **Step 3: Run them to see them fail.**
  Run: `lgx test-pg`. Expected: those assertions fail.

- [ ] **Step 4: Implement** the `:lost` map in `fail!`, as in the
  Design. Coerce `:reconnected` to a boolean.

- [ ] **Step 5: Run all backend tests.**
  Run: `lgx test-pg`. Expected: PASS.

- [ ] **Step 6: Check the reply in server mode.** Run the e2e check from
  the previous plan (`.tmp/e2e/lost.sh` under
  `scripts/with-postgres.sh`, or write it again): the error reply's
  `cause` holds `lost`.

- [ ] **Step 7: Commit.**
  `git commit -am "Pin wails-v0.8.0 and describe a lost connection in the error's data"`

### Task 3: The notice (Quel frontend)

**Files:**
- Modify: `frontend/src/lib/api.ts`, `frontend/src/lib/api.test.ts`
- Modify: `frontend/src/state/store.ts`
- Modify: `frontend/src/state/runner.ts`, `frontend/src/state/runner.test.ts`
- Modify: `frontend/src/components/MessagesView.tsx`

- [ ] **Step 1: Write the failing tests:** `lostOf` in `api.test.ts`,
  and the runner cases in `runner.test.ts` (Design → Testing). Mock
  `api.run` with `Object.assign(new Error(text), { cause: { lost: {...} } })`.

- [ ] **Step 2: Run them to see them fail.**
  Run: `npm --prefix frontend test`. Expected: the new tests fail.

- [ ] **Step 3: Implement** `Lost` and `lostOf`, the `Message` fields,
  the two catches, the toast and its dismissal, as in the Design.

- [ ] **Step 4: Render it** in `MessagesView.tsx`: the icon, headline,
  muted line, `<details>`, and the Run again button with its
  visibility rule. The button and the toast's action both call one
  runner function, `rerunLost(tabId, messageId)`, not `runStatements`
  directly. It reruns only if that message is still the tab's newest,
  has `rerun`, and the tab is not running, so a stale toast click after
  another run does nothing. Use /frontend-design for the tone.

- [ ] **Step 5: Run the tests and the type check.**
  Run: `npm --prefix frontend test && npm --prefix frontend run build`
  (or the repo's typecheck script). Expected: PASS.

- [ ] **Step 6: Commit.**
  `git commit -am "Show a lost connection as a notice with Run again"`

### Task 4: End to end, and docs

**Files:**
- Create: `frontend/e2e/lost-connection.spec.ts`
- Modify: `docs/DESIGN.md`

- [ ] **Step 1: Write the spec** as in the Design → Testing. Use
  `e2e/connect.ts` helpers where they fit, and add a Postgres-profile
  helper there if the dialog needs more than the SQLite one. Skip with
  `test.skip(!process.env.QUEL_PG_URL, ...)`.

- [ ] **Step 2: Run it.**
  Run: `CGO_ENABLED=0 GOFLAGS=-tags=server bash scripts/with-postgres.sh bash scripts/e2e.sh lost-connection.spec.ts`
  Expected: PASS. Then `lgx e2e` (without Postgres) still passes, with
  this spec skipped.

- [ ] **Step 3: DESIGN.md.** After the "After any failed run" text, add
  a paragraph:
  - the error's data carries `:lost`;
  - the frontend shows a notice and a toast, with Run again only for a
    statement that was not run;
  - Run again goes through the run policy;
  - a failed reconnect stays an error.

- [ ] **Step 4: Commit.**
  `git commit -am "Test the lost-connection notice end to end, and document it"`
