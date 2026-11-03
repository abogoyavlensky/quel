# Reconnect Lost Sessions Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a tab's connection turns out to be dead (laptop sleep, a
server timeout, a restart, a dropped VPN), Quel reconnects the tab right
away and tells the user, in plain words, whether the statement ran, that
the session's state is gone, and that the next run will work. It never
re-runs the statement itself.

**Tech Stack:** let-go (`quel.exec`, `quel.conn` over `sql.core` /
`sql.shim`, pgx v5.10 through letgo-packages `postgres-v0.4.0`);
clojure.test via `lgx test` / `lgx test-pg`.

---

## Design

### Where this starts

A user on Redshift, reached over Tailscale, left Quel open while the
laptop slept. The next run failed with:

```
write failed: write tcp 100.88.215.20:52866->10.20.84.128:5439: write: broken pipe The session was reset.
```

The cause is not specific to Redshift or to sleep:

- Each editor tab runs on its own dedicated `*sql.Conn`, held from the
  tab's first run until it closes (`quel.conn/session!`). Nothing checks
  it while it sits idle. `database/sql` retries a dead connection only
  for pool operations, never on a held `Conn`. (The shared pool behind
  the structure tree checks idle connections itself: pgx's
  `ResetSession` pings one that has been idle for more than a second.)
- TCP keepalives are already on: pgx v5.10 dials with a zero
  `net.Dialer` (`pgconn/config.go:978`), and Go enables keepalives by
  default. A connection can still be closed or reset at the other end
  while the laptop sleeps, or by the server (`idle_session_timeout`, a
  Redshift session timeout, a restart, `pg_terminate_backend`).
- Quel already recovers, but slowly and unclearly. After any failed run
  `fail!` (`src/quel/exec.lg`) probes the session with `select 1`.
  `dead?` reports whether it is gone. If it is, the session is dropped,
  the next run takes a new one, and the driver's error gets
  " The session was reset." appended, without punctuation in between.

### What changes

Only the "the session is dead" branch of `fail!`. Everything else about
failures stays: the probe, keeping a session that answered (an aborted
transaction's 25P02), and the "Query canceled." prefix the frontend keys
on (`frontend/src/state/runner.ts`, `text.startsWith("Query canceled.")`).

1. **Reconnect at once.** When `dead?` is true: `conn/reset-session!`,
   then `conn/session!` for the same conn-id and session-id, in line.
   - The result is `{:ok true}`, or `{:error msg}` when `session!`
     throws. The message goes through `(conn/redact {} msg)`, which
     masks anything that looks like a password.
   - The wait is bounded: since postgres-v0.4.0, connecting gives up
     after 10 s unless the profile's DSN sets `connect_timeout`. In the
     worst case a failed run reports after the 5 s probe plus 10 s.
   - `session!` already copes with the tab or the database closing
     meanwhile: it closes the fresh connection and throws. The message
     then reports "Could not reconnect".

2. **Say whether the statement ran.** Nothing in the error tells Quel
   for certain, but some errors show that nothing reached the server.
   `not-sent?` matches the driver message, case-insensitively, against:
   - `write failed:`: pgx could not send the query (pgproto3's
     `writeError`).
     - Usually nothing went out: a write into a socket the peer already
       closed or reset (the user's broken pipe) sends zero bytes.
     - A partial write is possible in principle. pgx sends a
       row-returning statement as one buffered batch (Parse, Bind,
       Describe, Execute, Sync), so the bytes that got out could
       include `Execute` but not `Sync`.
     - Postgres commits an implicit transaction only at `Sync` and
       aborts it when the connection drops, so nothing the statement
       did is committed. Under autocommit, that means "not run" for
       anything transactional, which is what the user needs to know.
     - A simple-protocol statement (one `Query` message) that is cut
       short is never run at all.
     - Say this in `not-sent?`'s docstring.
   - `bad connection`: `driver.ErrBadConn`. pgx's stdlib returns it only
     for a connection already known closed, or for an error pgx marks
     safe to retry (nothing sent).
   - `connection is already closed`: `database/sql`'s `ErrConnDone`.
   - `SQLSTATE 57P05` (`idle_session_timeout`) and `SQLSTATE 25P03`
     (`idle_in_transaction_session_timeout`): the server ended the
     session because it was idle, before this statement.

   Anything else, and any cancel, counts as "may or may not have
   completed". `pg_terminate_backend` (57P01), for example, can hit a
   running statement. pgx's `SafeToRetry` flag is not used. Exposing it
   upstream would replace only the first marker, and it answers a
   different question ("zero bytes written").

3. **One message, built by a pure function.** `lost-message` takes
   `{:kind :run|:page :canceled? :error :sent? :reconnect}` and returns
   the text.
   - `:error` is the driver message.
   - `:sent?` is `(not (not-sent? error))`.
   - `:reconnect` is the result from step 1.

   The tests match these fragments, so keep the wording. `<e>` is the
   driver message and `<why>` the reconnect error.

   | Case | Opening |
   |---|---|
   | run, not sent | `The connection to the database was lost (<e>), so the statement was not run.` |
   | run, maybe sent | `The connection to the database was lost (<e>). The statement may or may not have completed: check before running it again.` |
   | run, canceled | `Query canceled. The connection to the database was lost, so the statement may or may not have completed: check before running it again.` |
   | page read | `The connection to the database was lost (<e>) while reading rows. Run the query again for the rest.` |
   | page read, canceled | `Query canceled. The connection to the database was lost while reading rows. Run the query again for the rest.` |

   A canceled case omits `<e>`: after a cancel the driver message is
   just `context canceled`.

   The opening is followed by the reconnect sentence:
   - `{:ok true}`: ` Reconnected: the next run uses a new connection.`
   - `{:error why}`: ` Could not reconnect (<why>): the next run tries again.`

   It always ends with:
   ` Any open transaction, SET values and temp tables in this tab are gone.`

   The user's case reads: "The connection to the database was lost
   (write failed: … broken pipe), so the statement was not run.
   Reconnected: the next run uses a new connection. Any open
   transaction, SET values and temp tables in this tab are gone."

`fail!` gains a `kind` argument (`:run` from `run!`, `:page` from
`fetch-page!`). Its dead branch throws
`(ex-info (lost-message ...) {:query-id query-id})`. A failure where the
probe says the session lives is unchanged.

### Scope

- Postgres and Redshift. SQLite sessions never fail the probe, so
  nothing changes for SQLite.
- Not covered:
  - Re-running the statement automatically. A re-run on a new
    connection loses `SET search_path`, so it can silently query
    another schema.
  - Saying precisely whether a transaction was open. That needs the
    driver's transaction status, which belongs with the open-transaction
    marker (`docs/backlog/open-transaction-indicator.md`). Its entry
    gets a note to refine this message then.
  - Checking every tab's session after a wake, so no tab has to fail
    first (backlog, Task 3).
  - A connection whose packets are silently dropped still shows as a
    hang until keepalives give up or the user cancels. The cancel then
    reaches this path.
- No frontend change: the message arrives as the run's error text, as
  today.

### Testing

- `test/quel/exec_test.lg` (`lgx test`): `not-sent?` and
  `lost-message`, both pure.
- `test/quel/pg_test.lg` (`lgx test-pg`, Postgres 17 in Docker):
  - a terminated session, an idle-timeout session, and one whose
    reconnect is refused;
  - a connection lost under an open cursor;
  - the new session is in place before the next run;
  - the aborted-transaction test stays.

## File Structure

- Modify `src/quel/exec.lg`:
  - add `not-sent?` and `lost-message`;
  - change `fail!` and its two callers, and the docstrings that mention
    "The session was reset";
  - drop `failure`'s reset branch.
- Modify `test/quel/exec_test.lg` and `test/quel/pg_test.lg`.
- Modify `docs/DESIGN.md`: the "After any failed run" paragraph under
  Query execution → Running.
- Create `docs/backlog/check-sessions-after-wake.md`.
- Modify `docs/backlog/open-transaction-indicator.md`.

## Tasks

Work on the branch `reconnect-lost-sessions`.

On Linux without GTK4/WebKitGTK headers, run the test tasks as
`CGO_ENABLED=0 GOFLAGS=-tags=server lgx test` (and the same for
`lgx test-pg`). `lgx test-pg` needs Docker.

### Task 1: The message and the not-sent check

**Files:**
- Modify: `src/quel/exec.lg`
- Test: `test/quel/exec_test.lg`

- [ ] **Step 1: Write the failing tests** in `exec_test.lg`:
  - `not-sent?` is true for:
    - the user's message,
      `"write failed: write tcp 100.88.215.20:52866->10.20.84.128:5439: write: broken pipe"`;
    - `"driver: bad connection"`;
    - `"sql: connection is already closed"`;
    - `"FATAL: terminating connection due to idle-session timeout (SQLSTATE 57P05)"`;
    - `"FATAL: terminating connection due to idle-in-transaction timeout (SQLSTATE 25P03)"`.

    It is false for:
    - `"FATAL: terminating connection due to administrator command (SQLSTATE 57P01)"`;
    - `"unexpected EOF"`;
    - `nil`.
  - `lost-message`, one assertion per row and variant in the Design:
    - run, not sent, reconnected: contains the driver message,
      `"so the statement was not run."`,
      `"Reconnected: the next run uses a new connection."` and ends with
      `"Any open transaction, SET values and temp tables in this tab are gone."`.
    - run, maybe sent: contains `"may or may not have completed"` and
      no `"was not run"`.
    - run, canceled: starts with `"Query canceled."` and does not
      contain `"context canceled"`.
    - page: contains `"while reading rows"`.
    - page, canceled: starts with `"Query canceled."` and contains
      `"while reading rows"`.
    - `{:error "dial tcp: no route to host"}`: contains
      `"Could not reconnect (dial tcp: no route to host): the next run tries again."`.

- [ ] **Step 2: Run them to see them fail.**
  Run: `lgx test`
  Expected: the new tests fail (`exec/not-sent?` and
  `exec/lost-message` unresolved).

- [ ] **Step 3: Implement `not-sent?` and `lost-message`** in
  `src/quel/exec.lg`, next to `failure`. Both are public, for the
  tests. The `not-sent?` docstring says why each marker means nothing
  reached the server, or nothing was committed (from the Design).

- [ ] **Step 4: Run the tests.**
  Run: `lgx test`
  Expected: PASS (the Postgres tests skip).

- [ ] **Step 5: Commit.**
  `git commit -am "Word a lost connection by whether the statement ran"`

### Task 2: Reconnect in fail!

**Files:**
- Modify: `src/quel/exec.lg`
- Test: `test/quel/pg_test.lg`

- [ ] **Step 1: Rework the Postgres tests** in `pg_test.lg`:
  - Rename `a-dead-session-is-reset` to
    `a-dead-session-reconnects-at-once`.
    - Take the pid and the session object
      (`conn/current-session conns id "s1"`), then terminate the
      backend through the pool.
    - Run `select 1`. The message contains
      `"The connection to the database was lost"`,
      `"may or may not have completed"` and `"Reconnected"`.
    - Before any further run, `conn/current-session` is non-nil and not
      `identical?` to the old session.
    - `select pg_backend_pid()` then works and returns a different pid.
  - New `an-idle-timeout-is-reported-as-not-run`:
    - run `set idle_session_timeout = '500ms'`, `(sleep 1500)`, then
      `select 1`;
    - the message contains `"so the statement was not run."` and
      `"Reconnected"`;
    - `show idle_session_timeout` on the next run answers `"0"`: the
      new session did not inherit the setting.
  - New `a-failed-reconnect-is-reported`, on a database of its own, so
    blocking connections to it touches nothing else:
    - `create database quel_lost` through the main pool, then open a
      registry entry on the same URL with the database name swapped;
    - run `select 1` to take the session, then through the main pool
      run `alter database quel_lost allow_connections false` (it
      applies to superusers too) and terminate the session's backend;
    - run `select 1`. The message contains `"Could not reconnect ("`
      and `"the next run tries again."`, and `conn/current-session` is
      `nil`;
    - `alter database quel_lost allow_connections true`, after which
      the next run works;
    - in a `finally`: allow connections again, close the entry, and
      `drop database quel_lost with (force)`.
  - New `a-page-read-on-a-lost-connection-is-reported`:
    - run `select g from generate_series(1, 1000000) g` through
      `exec/run!` with a known query-id and `:page-size 10`, so the
      cursor stays open;
    - terminate the backend;
    - call `exec/fetch-page!` until it throws, at most 100000 times
      (rows already in the client's buffer read fine first);
    - the message contains `"while reading rows"` and `"Reconnected"`.
  - In `an-aborted-transaction-keeps-the-session`, replace
    `(not (str/includes? msg "reset"))` with
    `(not (str/includes? msg "connection to the database was lost"))`.
    The old check no longer matches anything the new wording says. The
    test already asserts the same pid throughout.

- [ ] **Step 2: Run them to see them fail.**
  Run: `lgx test-pg`
  Expected: the reworked and new tests fail (old wording, no session
  until the next run).

- [ ] **Step 3: Rewire `fail!`.** New signature
  `[conns conn-id session-id kind canceled? query-id e]`.
  - When `dead?`: `conn/reset-session!`, then reconnect (Design, step
    1), then throw `(ex-info (lost-message {...}) {:query-id query-id})`.
  - Otherwise throw what `failure` throws today minus the reset branch.
    Inline it or rename it `plain-failure`, whichever reads better.
  - Pass `:run` from `run!` and `:page` from `fetch-page!`.
  - Update the docstrings of `fail!`, `run!` and `fetch-page!` that say
    "the error then says so" or "The session was reset".

- [ ] **Step 4: Run all backend tests.**
  Run: `lgx test && lgx test-pg`
  Expected: PASS.

- [ ] **Step 5: Commit.**
  `git commit -am "Reconnect a tab whose connection was lost, and say what it lost"`

### Task 3: Docs and backlog

**Files:**
- Modify: `docs/DESIGN.md`
- Create: `docs/backlog/check-sessions-after-wake.md`
- Modify: `docs/backlog/open-transaction-indicator.md`

- [ ] **Step 1: Rewrite DESIGN.md's paragraph** under Query execution →
  Running, starting "After any failed run". Keep the probe and the
  25P02 rule. Replace "the next run takes a fresh one, and the error
  ends 'The session was reset.'" with:
  - the immediate reconnect, and what bounds it;
  - the "was not run" / "may or may not have completed" split and the
    markers behind it;
  - that the statement is never re-run, and why (a lost
    `SET search_path`).

  Use /writing-clearly.

- [ ] **Step 2: Commit.**
  `git commit -am "Document reconnecting a lost session"`

- [ ] **Step 3: Backlog entries,** using /backlog:
  - New `docs/backlog/check-sessions-after-wake.md`:
    - `**Status: open**`.
    - **Problem:** after sleep, every tab with a session fails its
      first run once.
    - **Proposed fix:** the frontend notices a jump in time. The
      backend probes that profile's idle tab sessions, skipping ones
      with a running query or an open cursor, and replaces the dead
      ones. Each affected tab gets a notice, so a rolled-back
      transaction never disappears silently. The letgo-packages `wails`
      package exposes no wake event today.
  - `open-transaction-indicator.md`, still open: add that once the
    transaction status is reachable, the lost-connection message
    (`quel.exec/lost-message`) should say "Your open transaction was
    rolled back" only when one was open, instead of "Any open
    transaction, …". Read the status before each statement: after some
    failures `database/sql` has already closed the `Conn`.

- [ ] **Step 4: Commit them on their own,** as AGENTS.md asks:
  `git add docs/backlog && git commit -m "Backlog: check tab sessions after a wake; refine the lost-connection message"`
