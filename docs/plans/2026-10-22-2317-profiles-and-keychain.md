# Profiles and Keychain Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: implemented, 2026-10-23** (macOS checks pending, see Task 14).

**Goal:** Saved connection profiles in an app database, with each profile's password kept in the macOS Keychain. A new `keyring` package in letgo-packages provides the Keychain access. The database panel lists the profiles, connects one with a click, and lets you create, edit, test and delete them.

**Tech Stack:** let-go 1.13.0 / lgx 0.5.1; letgo-packages `sqlite-v0.3.0`, `postgres-v0.4.0`, `ragtime-v0.3.0`, `wails-v0.3.0`, and a new `keyring-v0.1.0` over `github.com/zalando/go-keyring` v0.2.8. Frontend: React 19, zustand, shadcn (dialog, alert-dialog, label, select), Vitest, Playwright.

---

## Design

### Scope

This slice delivers:

1. **Upstream: `letgo-packages/keyring`**, a small package over
   `zalando/go-keyring`: `set!`, `get`, `delete!` and `use-memory!`.
2. **The app database** (`quel.store`): SQLite in the per-user data dir,
   migrated with the ragtime package. Its first table is `profiles`.
3. **Profiles** (`quel.profiles`): validate, list, save and delete them, and
   turn a profile into something `quel.conn` can open.
4. **Secrets** (`quel.secrets`): profile passwords in the Keychain, keyed by
   profile id, never stored in the app database and never sent to the
   frontend.
5. **Handlers**: `list-profiles`, `save-profile`, `delete-profile`,
   `test-connection`, `connect` and `choose-file`. `open-db` and `close-db`
   stay as they are.
6. **Frontend**: the database panel lists profiles; a dialog creates and
   edits them; the profile's colour replaces the engine dot in the panel and
   the status bar. File gets a "New Connection…" menu item.

Not in this slice:

- **Read-only profiles and the confirm policy.** Milestone 2 brings them,
  together with `quel.classify`, and adds the columns in its own migration.
- **Prompting for a password that was not saved.** A profile without a
  saved password connects without one, which covers trust, `.pgpass` and
  `PGPASSWORD` setups. This gets a backlog entry (Task 13).
- **Importing a profile from a URL**, extra DSN parameters, SSH tunnels.
- **History and workspace restore**: the next slices.

### Upstream: the `keyring` package

`zalando/go-keyring` is pure Go on every platform Quel cares about. On
macOS it drives `/usr/bin/security` and sends the password on stdin, so it
never appears in `ps`. On Linux it talks to the Secret Service over D-Bus
(godbus). Adding it costs no cgo and no extra toolchain. It also ships an
in-memory provider (`MockInit`) for tests and headless runs.

The package follows the in-tree shim model, like `nrepl` (Shape B in lgx's
`lgx-go-wrappers.md`: a shim, nothing generated). A generated binding would
be named after the path's last segment (`go-keyring`), and it would expose
the "not found" case only as an error value. The shim hides both problems:

```go
// keyring/shim/shim.go: registered as the let-go namespace keyring.shim
func Set(service, user, password string) error
func Get(service, user string) (vm.Value, error) // vm.NIL when not found
func Delete(service, user string) error          // nil when not found
func UseMemory()                                 // keyring.MockInit()
```

Veneer (`keyring.core`):

```clojure
(set! service user password) ; => nil; throws on a keyring failure
(get service user)           ; => the string, or nil when there is none
(delete! service user)       ; => nil; a missing entry is not an error
(use-memory!)                ; process-wide in-memory store, for tests
```

`use-memory!` is process-global, because go-keyring's provider is a
package variable. The README says so. go-keyring's memory provider is a
plain map with no lock, and bridge calls run concurrently. So the shim
takes one package-level `sync.Mutex` around every call, `UseMemory`
included. That also serialises the real provider, which costs nothing at
this call rate. A test runs 50 concurrent set/get/delete calls from
futures and checks that they all complete and that the final state is
right.

Layout: `keyring/{lgx.edn, README.md, shim/{go.mod, shim.go},
src/keyring/core.lg, test/keyring/core_test.lg, example/{lgx.edn, main.lg}}`.
The tests run on the memory provider, since CI has no Secret Service. The
example asserts against the memory store too, and its README shows the
real call. Release: the `keyring-v0.1.0` package tag only (in-tree shim).

### The app database

`quel.store/data-dir` picks the directory:

1. `QUEL_DATA_DIR`, if not blank. Tests, smoke and e2e set it.
2. On macOS (`(os/os-name)` is `"darwin"`):
   `$HOME/Library/Application Support/Quel`.
3. Otherwise `$XDG_DATA_HOME/quel` if `XDG_DATA_HOME` is not blank, else
   `$HOME/.local/share/quel`.

The directory is created with `os/mkdir-p`. The database is
`<data-dir>/quel.db`. Check every env var with `str/blank?`.

Component `:quel.store/db` with config `{:dir <string or nil>}`. A nil
`:dir` means `(data-dir)`. On init it opens the SQLite file, then runs
`ragtime.letgo/migrate` with `quel.migrations/migrations`. Its value is the
`sqlite.core` connectable. Halt closes it.

The pool must stay usable from concurrent bridge calls. A PRAGMA run once
configures only the connection that ran it, so the settings go in the DSN,
which modernc applies to every connection it opens. `sqlite/open` passes
its argument to the driver as is:

```clojure
(str path "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(wal)")
```

`busy_timeout` makes a second writer wait instead of failing with
`SQLITE_BUSY`, and WAL lets reads proceed during a write. A test takes two
connections from the pool (`sql.shim/Conn`) and reads
`pragma foreign_keys` and `pragma busy_timeout` on both. Another runs 20
concurrent `save!` calls and checks that all of them land.

`quel.migrations/migrations` is a vector of `rt/sql-migration` maps with
the SQL inline: no resources, per AGENTS.md. Migration
`001-create-profiles`:

```sql
create table profiles (
  id           text primary key,
  name         text not null,
  engine       text not null,      -- sqlite | postgres | redshift
  host         text,
  port         integer,
  database     text,
  user_name    text,
  ssl_mode     text,
  path         text,               -- sqlite only
  color        text not null default 'none',
  has_password integer not null default 0
);
create unique index profiles_name on profiles (name collate nocase)
```

(Two statements in the `:up` vector.) Down: `drop table profiles`. The
index guards against two concurrent saves with the same name, which
`validate`'s check alone cannot. `save!` maps the constraint error
(message containing `UNIQUE constraint failed: profiles.name`) to the same
"A connection named X already exists." message.

### Profiles

A profile as the backend returns it (keyword keys, lowered to strings on
the bridge):

```clojure
{:id "6f1c…" :name "Warehouse" :engine "redshift"
 :host "wh.abc.eu-west-1.redshift.amazonaws.com" :port 5439
 :database "dev" :user "admin" :ssl-mode "require"
 :path nil :color "red" :has-password true}
```

`save-profile` receives a map with string keys from JavaScript.
`quel.profiles/normalize` turns it into the shape above. It trims strings,
turns blank strings into nil, and reads `port` from a number or a numeric
string. The password is exempt: it is passed through exactly as sent,
spaces and all, and `""` stays `""`. `normalize` returns it under
`:password` and `"forget-password"` under `:forget-password?`, and the
profile proper never includes them.

One fn decides the password for both save and test, so the two cannot
disagree. `(password-change m)` returns `[:set pw]`, `[:forget]` or
`[:keep]`:

1. `"forget-password"` true: `[:forget]`. This wins over a password sent
   alongside it.
2. `"password"` is `""`: `[:forget]`. pgx treats an empty password as
   none and looks in `.pgpass` (`pgconn/config.go`), so Quel cannot
   promise an explicitly empty one. Treating `""` as "no saved password"
   makes the behaviour match what pgx does. The dialog never sends `""`
   anyway (see Frontend).
3. `"password"` is any other string: `[:set pw]`, untrimmed.
4. Otherwise (key absent or `nil`): `[:keep]`.

`(effective-password secrets m)` turns the change into the password to
connect with: `:set` gives `pw`, `:forget` gives nil, and `:keep` gives the
saved password for `m`'s id (nil for a new profile).

`quel.profiles/validate` throws `ex-info` with a message the dialog shows:

- `name` is required and unique, case-insensitively, among the other
  profiles: "A connection named X already exists."
- `engine` is one of `sqlite`, `postgres` or `redshift`.
- sqlite: `path` is required. The host fields are cleared.
- postgres and redshift: `host` is required; `port` defaults to 5432 or
  5439 and must be 1-65535; `ssl-mode` is one of `disable`, `allow`,
  `prefer`, `require`, `verify-ca` or `verify-full`, defaulting to
  `prefer`, or `require` for redshift. `path` is cleared.
- `color` is one of `none`, `red`, `orange`, `yellow`, `green`, `blue` or
  `purple`, defaulting to `none`.

Functions over the store db:

- `(list-all db)` returns every profile, ordered by `name collate nocase`.
- `(fetch db id)` returns one profile, or nil.
- `(save! db secrets m)` normalizes and validates, picks a new id
  (`quel.conn`'s UUID helper, made public as `new-id`) when `:id` is nil,
  applies `password-change` to the Keychain first, then upserts the row
  with `has_password` set to match (unchanged for `:keep`). Before a
  `:set` or `:forget`, it reads the old password. If the row write fails,
  it puts the old password back (or deletes the new one when there was
  none), then rethrows. It returns the saved profile.
- `(delete! db secrets id)` deletes the row, then the password (best
  effort: a Keychain failure is logged to stderr, not thrown). Returns nil.

`(target profile password)` builds what `quel.conn` opens:

- sqlite: `{:engine :sqlite :path p :label name}`. It throws
  "No such file: p" when `(os/stat p)` is not a file. A profile must not
  quietly create an empty database because of a typo. The ad-hoc `open-db`
  path keeps its behaviour.
- postgres and redshift: `{:engine :postgres|:redshift :dsn d :label name
  :secret password}`, where `d` is a key/value DSN with every value
  single-quoted and `\` and `'` backslash-escaped (`dsn-quote`). A nil
  field is left out, the password included: with none saved, pgx's own
  `PGPASSWORD` and `.pgpass` fallbacks apply, as in `psql`:

  ```
  host='h' port='5439' dbname='dev' user='admin' password='p\'w' sslmode='require'
  ```

  A key/value DSN avoids percent-encoding, which let-go has no helper for.
  pgx and the postgres package (connect timeout handling) accept it.

### `quel.conn` changes

`open!` splits in two. `(open! registry s)` keeps parsing a path or URL
with `target` and `label`, then calls `(open-target! registry t)`, which
takes a target map `{:engine (:path | :url | :dsn) :label [:secret]}` and
returns `{:conn-id :engine :label}` as `open!` does now. `open-pool` passes
`(or url dsn)` to `pg/open`.

`redact` also masks the target's `:secret` when it is not blank, before
the existing patterns run. Driver errors can quote the DSN, where the
password appears escaped, so `redact` replaces both the raw secret and its
escaped form (`dsn-quote` without the outer quotes; move `dsn-quote` to
`quel.conn` so both namespaces share it). As a third line of defence, the
`password=` pattern gains an escape-aware alternative for quoted values:
`password\s*=\s*'(?:[^'\\]|\\.)*'`.

pgx's own parse errors are the hard case. `ParseConfigError` formats as
``cannot parse `<conn string>`: <reason>``, and pgx redacts the password
inside it with a quote-unaware regex (`pgconn/errors.go`). For
`p'w \tail x` that leaves a fragment like `\tail x'` that matches neither
the secret nor any pattern. So for a `:dsn` target, `redact` first replaces
everything from ``cannot parse ` `` through the last `` `: `` with
`cannot parse the connection settings: `, keeping pgx's reason, and runs
the masking above after that. Quel builds the DSN itself, so a parse error
means a bad field value, such as an SSL mode that slipped past validation.
The tests cover two cases: a synthetic error string quoting the full
generated DSN for the password `p'w \tail x`, and a real failure, where
`pg/open` on a generated DSN with that password and `sslmode='bogus'`
(built by hand, bypassing `validate`) throws. Neither redacted message may
contain any part of the password beyond what `***` replaced.

`(check! t)` opens the target's pool, pings it, and closes it, throwing the
redacted error. For SQLite it also runs `select 1`. It backs
`test-connection` and opens no session pool. It reuses `open-pool`,
`close-pool!` and the ping logic of `connect`; factor out a `ping!` helper
that both use.

### Secrets

Component `:quel.secrets/store` with config `{:backend :system | :memory}`.
On init, `:memory` calls `keyring/use-memory!`. The value is
`{:service "Quel" :backend b}`. `quel.secrets` has `(password s id)`,
`(set-password! s id pw)` and `(delete-password! s id)`, with the Keychain
item's service `"Quel"` and its account the profile id.

`quel.system/config` picks the backend with
`(if (= "memory" (os/getenv "QUEL_SECRETS")) :memory :system)`.
`scripts/server-mode.sh` sets `QUEL_SECRETS=memory` and a temporary
`QUEL_DATA_DIR`. The Linux CI box has no Secret Service, and smoke and e2e
must never touch a developer's real Keychain or profiles.

### Handlers

`:quel.api/handlers` gets `:store`, `:secrets` and `:app` refs. The env is
now `{:conns :execs :store :secrets :app}`.

| Handler | Args | Returns |
|---|---|---|
| `list-profiles` | | `[profile ...]` |
| `save-profile` | `m` (string keys, optional `"password"` / `"forget-password"`) | the saved profile |
| `delete-profile` | `id` | nil |
| `test-connection` | `m`, as for save | `{:ok true :label l}`; throws with the redacted driver error |
| `connect` | `profile-id` | `{:conn-id :engine :label :profile-id}` |
| `choose-file` | | the chosen path, or nil when cancelled |

`test-connection` normalizes and validates `m` without the uniqueness
check, so an unsaved or renamed form can be tested. It connects with
`(effective-password secrets m)`, so "Forget saved password" is honoured
there too. It never writes anything. `connect` reads the saved profile and its password, calls
`profiles/target` and then `conn/open-target!`. The label is the profile's
name. `choose-file` calls `w/open-file` on the app with the SQLite filters
from `quel.menu`. Move `db-filters` to a public `quel.menu/db-filters` so
both use it.

The frontend keeps a single open database. Connecting a profile goes
through the same switch as `open-db`: close the current one, then open.

### Frontend

- **Types and API** (`lib/types.ts`, `lib/api.ts`): `Profile`,
  `ProfileInput` (a `Profile` without `id`/`has-password`, plus an optional
  `id`, `password` and `forget-password`), `Color`, `SslMode`, and one
  function per new handler. `OpenResult` gets an optional `"profile-id"`.
- **Store** (`state/store.ts`): `profiles: Profile[]`,
  `profilesError: string | null`. `Conn` gets `profileId: string | null`
  and `color: Color`, with `"none"` for an ad-hoc open.
- **Actions** (`state/profiles.ts`): `loadProfiles()`,
  `saveProfile(input)` (save, then reload the list, return the profile),
  `deleteProfile(id)` (disconnect first if it is the open one, then delete
  and reload), `testConnection(input)`.
- **Runner** (`state/runner.ts`): factor `openDb`'s switching into
  `switchTo(open: () => Promise<OpenResult>, color)` and add
  `connectProfile(id)` on top of it. `openDb`'s behaviour is unchanged.
- **Form logic** (`state/profileForm.ts`, pure and unit-tested): the empty
  form per engine, default ports and SSL modes, switching engine without
  losing the name and colour, `toInput(form, original)` (for an edit, a
  blank password field means "keep"), and client-side required-field
  checks that mirror the backend's.
- **Components**:
  - `ConnectionsPanel.tsx` replaces `DatabasePanel.tsx`. At the top,
    "Connections" with a `+` button. Below it, the profile list: colour
    dot, name, engine, and a mark on the connected one. Clicking a profile
    connects it. Each row has an edit button that opens the dialog. Under
    the list, the "Quick open" form, which is today's path/URL form with
    its label unchanged (`File path or postgres:// URL`), so the existing
    e2e keeps working. The error area is unchanged.
  - `ProfileDialog.tsx` (shadcn `Dialog`): name; engine (`Select`); for
    sqlite, path plus a "Browse…" button (`choose-file`); for
    postgres/redshift, one labelled input per field, never a URL: Host and
    Port on one row (port narrow, numeric, placeholder = the engine's
    default), then Database, User, Password (`type="password"`, placeholder
    "Saved in Keychain" when `has-password`, with a "Forget saved password"
    checkbox), and SSL mode (`Select`); colour swatches (a radio group).
    Buttons: Test, Delete (edit only, with an `AlertDialog` confirm),
    Cancel, Save.
  - **Test** is there for a new profile as well as an edited one, and is
    enabled as soon as the required fields are filled in. It sends the form
    as it stands, password included, to `test-connection`, which saves
    nothing. So a connection can be checked before the profile exists.
    While it runs, the button shows "Testing…". It then shows "Connected"
    or the redacted error inline under the buttons. Any edit to the form
    clears that result. Save closes the dialog on success and shows the
    error inline otherwise. The dialog does not connect.
  - `EngineMark.tsx` becomes `ConnMark`: the profile colour when it is not
    `none`, else today's engine colour. Add the colour tokens to
    `index.css` next to the engine ones.
  - `StatusBar.tsx`: `ConnMark` and the label (the profile name).
- **Menu event**: `menu:new-connection` opens the dialog for a new profile
  (store field `profileDialog: { mode: "new" } | { mode: "edit", id } |
  null`).
- `App.tsx`/`main.tsx`: call `loadProfiles()` on start and subscribe to
  the new event where the other menu events are subscribed.

### Errors and safety

- Passwords travel frontend→backend only, in `save-profile` and
  `test-connection`. No handler returns one.
- Every error that may quote a DSN goes through `conn/redact` with the
  target, `:secret` included.
- A failed Keychain write fails the save with "Could not save the password
  in the Keychain: …", and the row is left as it was before.

### Testing

- **keyring** (letgo-packages): set/get/delete round trip, get of a missing
  entry is nil, delete of a missing entry is nil, overwrite, an empty
  password and one with surrounding spaces round-trip, and the concurrency
  test, all on `use-memory!`.
- **Backend** (`lgx test`, memory secrets, temp data dirs):
  `store_test` (data-dir rules, migrate on init, re-init is idempotent,
  halt closes); `profiles_test` (normalize, validate, defaults, uniqueness,
  save new/edit, `password-change` precedence, `effective-password`, an
  untrimmed password, `""` treated as forget, `has-password`, delete removes the secret, the
  secret restored when a new or an edited profile's row write fails, the
  unique index under concurrent saves, `target` for each engine, DSN
  quoting, a nil password left out of the DSN); `conn_test` (`open-target!`,
  `redact` with `:secret`, `check!` on SQLite and on a missing file);
  `api_test` (the new handlers, the handler set, `connect` end to end on
  SQLite); `system_test` (the new keys and refs); `pg_test` (a postgres
  profile with a password saves, tests, connects and runs `select 1`; a
  wrong password fails redacted, without the password in the message;
  `test-connection` with "Forget saved password" set fails on that saved
  profile, even though its saved password works).
- **Smoke**: save a SQLite profile, list it, connect it, run. `smoke-pg`
  does the same with a Postgres profile whose password comes from the
  memory store.
- **Frontend unit**: `profileForm.test.ts`; `profiles.test.ts` (actions
  against the mocked bridge: save reloads, delete of the connected profile
  disconnects first); `runner.test.ts` (`connectProfile` sets `Conn` with
  `profileId` and `color`; a failure sets `dbError`).
- **e2e** (`profiles.spec.ts`): open the dialog for a new SQLite profile,
  type a missing path and Test shows the error without saving anything (the
  list stays empty); fix the path, Test shows Connected, Save, it is listed, click connects
  and the status bar shows its name, run a query, edit the name, delete it
  through the confirm.
- **macOS, by the user**: a saved password lands in Keychain Access under
  "Quel"; connecting reads it with no prompt; Forget removes it; deleting
  the profile removes it; the app database is in
  `~/Library/Application Support/Quel/quel.db`; a built `bin/quel` keeps
  the profiles.

## File Structure

letgo-packages (branch `keyring`):

| File | Change |
|---|---|
| `keyring/lgx.edn` | new: `:lg-runtime :built`, the shim as `{:go/local "shim"}`, test context |
| `keyring/shim/go.mod`, `keyring/shim/shim.go` | new: `Set`, `Get`, `Delete`, `UseMemory`, registered as `keyring.shim` |
| `keyring/src/keyring/core.lg` | new: the veneer |
| `keyring/test/keyring/core_test.lg` | new |
| `keyring/example/lgx.edn`, `keyring/example/main.lg` | new: an asserting walkthrough on the memory store |
| `keyring/README.md` | new |
| `README.md` | package table row; in-tree shim list |
| `.github/workflows/test.yml` | only if the changed-package selection or the in-tree shim list needs it |

Quel (branch `profiles`):

| File | Change |
|---|---|
| `lgx.edn` | deps `keyring-v0.1.0`, `ragtime-v0.3.0` |
| `src/quel/store.lg` | new: data dir, `:quel.store/db` |
| `src/quel/migrations.lg` | new: the migration vector |
| `src/quel/secrets.lg` | new: `:quel.secrets/store` |
| `src/quel/profiles.lg` | new: normalize, validate, CRUD, target |
| `src/quel/conn.lg` | `open-target!`, `check!`, `:dsn`, `:secret` in `redact`, public `new-id`, `ping!` |
| `src/quel/api.lg` | six handlers; env keys |
| `src/quel/menu.lg` | public `db-filters`; "New Connection…" item |
| `src/quel/system.lg` | new components and refs |
| `test/quel/{store,profiles}_test.lg` | new |
| `test/quel/{conn,api,system,menu,pg}_test.lg` | extended |
| `scripts/server-mode.sh` | `QUEL_SECRETS=memory`, a temp `QUEL_DATA_DIR` |
| `scripts/smoke.sh` | profile steps (SQLite, and Postgres when set) |
| `frontend/src/lib/{types,api}.ts` | profile types and calls |
| `frontend/src/state/{store,runner}.ts` | profiles, `Conn` colour, `connectProfile` |
| `frontend/src/state/profiles.ts`, `profileForm.ts` (+ tests) | new |
| `frontend/src/components/ConnectionsPanel.tsx`, `ProfileDialog.tsx` | new (replace `DatabasePanel.tsx`) |
| `frontend/src/components/{EngineMark→ConnMark,StatusBar,AppShell}.tsx` | colour, wiring |
| `frontend/src/components/ui/{dialog,alert-dialog,label,select}.tsx` | shadcn add |
| `frontend/src/index.css` | colour tokens |
| `frontend/e2e/profiles.spec.ts` | new |
| `docs/DESIGN.md`, `README.md`, `AGENTS.md` | data dir, env vars, handler table, upstream row, milestone line |
| `docs/backlog/ask-for-unsaved-password.md` | new (its own commit) |

## Tasks

### Task 1: The keyring package

**Files:** everything under `letgo-packages/keyring/`, plus the root `README.md`.

- [x] **Step 1:** In `../letgo-packages`, `git switch -c keyring` from an up-to-date master. Scaffold from `nrepl/`: `lgx.edn` (copy nrepl's, with the coord `github.com/abogoyavlensky/letgo-packages/keyring/shim {:go/local "shim"}` and `:contexts {:test {:extra-paths ["test"]}}`, the same as the other packages' test context). `shim/go.mod`: module `github.com/abogoyavlensky/letgo-packages/keyring/shim`, `go 1.26`, `require github.com/nooga/let-go v0.0.0` and `github.com/zalando/go-keyring v0.2.8`, then `go mod tidy` the way the README's "v0.0.0 let-go require" note describes (a temporary `go.work` or `replace`, not committed).
- [x] **Step 2:** `shim/shim.go`: the four functions from the Design, a package doc comment in the house style (why a shim, the "not found" mapping, the global memory provider), and `init()` registering `keyring.shim` with `vm.NewNamespace` / `vm.MustBox` / `rt.RegisterNS`, as `nrepl/shim/shim.go` does. `Get` returns `vm.String(p)` or `vm.NIL`; `Delete` and `Get` map `keyring.ErrNotFound` with `errors.Is`. Each of the four holds the package mutex for the whole call.
- [x] **Step 3: Write the tests** in `test/keyring/core_test.lg` (the Testing list above), calling `(kr/use-memory!)` at the top of the namespace.
- [x] **Step 4:** `src/keyring/core.lg`: the veneer, with docstrings. Exclude `get` from `clojure.core` (`:refer-clojure :exclude [get set!]`) if let-go needs it for these names; if let-go rejects shadowing `set!` (a special form), name it `put!` and use that name throughout this plan.
- [x] **Step 5: Run** `cd keyring && lgx test`. Expected: PASS.
- [x] **Step 6:** `example/`: `lgx.edn` with `{:local/root ".."}` and `main.lg`, which uses `use-memory!`, sets, gets, deletes and asserts (throws on a mismatch), with a comment showing the real-Keychain usage. **Run** `cd keyring/example && lgx run`. Expected: it prints its steps and exits 0.
- [x] **Step 7:** `keyring/README.md`: what it is, the deps coord with `keyring-v0.1.0`, the API, platforms (macOS through `/usr/bin/security`, password on stdin; Linux Secret Service over D-Bus, which needs a running secret service; Windows Credential Manager, untested), `use-memory!` being process-wide, layout, development. Add a row to the root README's package table and `keyring` to the in-tree shim list under "Releasing".
- [x] **Step 8:** Check `.github/scripts/changed-packages.sh` picks up a new top-level package dir with an `lgx.edn` (read it). Change it only if it does not.
- [x] **Step 9: Commit** `keyring: Keychain and Secret Service access over go-keyring`.

> Deviation: the veneer's setter is `put!`, the fallback the plan named: `set!` is a let-go special form. CI's changed-package selection picks up `keyring/` with no change (Step 8). No `:contexts` in `lgx.edn`: `nrepl`'s has none, and `lgx test` finds `test/` on its own.

### Task 2: keyring review, PR, release

- [x] **Step 1:** A codex review of the branch against master in the background (the `review-with-codex` mechanism). Fold real findings, then re-run `lgx test` and the example.
- [x] **Step 2:** Push, open the PR against letgo-packages master, link it with `link_pull_request`, wait for CI (`gh pr checks --watch`), merge.
- [x] **Step 3:** Tag `keyring-v0.1.0` on the merge commit and push the tag.

> Codex found nothing actionable. PR: letgo-packages #13, merged; tagged `keyring-v0.1.0`.

### Task 3: Quel deps and the app database

**Files:** `lgx.edn`, `src/quel/store.lg`, `src/quel/migrations.lg`, `test/quel/store_test.lg`.

- [x] **Step 1:** In Quel, `git switch -c profiles` from master. Add the `abogoyavlensky/letgo-keyring` (`keyring-v0.1.0`, `:deps/root "keyring"`) and `abogoyavlensky/letgo-ragtime` (`ragtime-v0.3.0`, `:deps/root "ragtime"`) coords to `lgx.edn`, each with a comment in the file's style. Run `lgx test` once to build the runtime. Expected: the existing suite passes, with no `already resolved` warning for `letgo-sql`.
- [x] **Step 2: Write the tests** in `store_test.lg`: `data-dir` with `QUEL_DATA_DIR` set returns it (test the rule fn: factor the choice into `(data-dir-for env-fn os-name)`, so tests pass a map lookup instead of changing the process env); darwin gives the Application Support path; linux with and without `XDG_DATA_HOME`; init on a temp dir creates `quel.db` with a `profiles` table, its unique name index and a `ragtime_migrations` row; two pooled connections both report `foreign_keys` 1 and `busy_timeout` 5000; a second init on the same dir succeeds; halt closes.
- [x] **Step 3: Run** `lgx test`. Expected: the new tests FAIL.
- [x] **Step 4:** Implement `quel.migrations` and `quel.store` per the Design (the DSN pragmas, migrate, halt).
- [x] **Step 5: Run** `lgx test`. Expected: PASS.
- [x] **Step 6: Commit** `Add the app database with its first migration`.

> Deviation: the dir is made with let-go's `mkdir` (it creates parents; there is no `os/mkdir-p`). A codex review found that a `?` in the data dir truncated the file name, so the store opens a `file:` URI with `%`, `?` and `#` escaped (a13e8e1, with a test). `lgx` runs through `mise exec` and with `CGO_ENABLED=0 GOFLAGS=-tags=server`: the `lgx` on PATH is 0.4.2.

### Task 4: Secrets

**Files:** `src/quel/secrets.lg`, `test/quel/secrets_test.lg`.

- [x] **Step 1: Write the tests** on the `:memory` backend: set, read, overwrite, delete, a missing one reads nil, and two ids stay apart.
- [x] **Step 2:** Implement the component and the three fns per the Design.
- [x] **Step 3: Run** `lgx test`. Expected: PASS.
- [x] **Step 4: Commit** `Keep profile passwords in the Keychain`.

> Codex found nothing actionable.

### Task 5: Profiles

**Files:** `src/quel/profiles.lg`, `src/quel/conn.lg` (public `new-id`, and the new `dsn-quote`), `test/quel/profiles_test.lg`.

- [x] **Step 1: Write the tests** listed under Testing for `profiles_test`, over a temp store and memory secrets. For the rollback cases, make the row write fail while reads keep working, so validation passes and the Keychain change happens first: in that test's own store, create `before insert` and `before update` triggers on `profiles` that `select raise(abort, 'write refused')`. A new profile leaves no password behind: `save!` puts the id in the error's `ex-data`, and the memory store has no entry for it. An edit that sets a new password leaves the old one in place. Save the edited profile before creating the triggers. The concurrency case: 20 futures save distinct names and all land; two futures save the same name and exactly one succeeds, the other throws the "already exists" message.
- [x] **Step 2: Run** `lgx test`. Expected: FAIL.
- [x] **Step 3:** Implement `normalize`, `password-change`, `effective-password`, `validate`, `list-all`, `fetch`, `save!`, `delete!` and `target` per the Design. Rows map to profiles in one `row->profile` fn (`user_name` → `:user`, `ssl_mode` → `:ssl-mode`, `has_password` 0/1 → boolean). SQL uses `?` params through `sql.core`.
- [x] **Step 4: Run** `lgx test`. Expected: PASS.
- [x] **Step 5: Commit** `Save, validate and delete connection profiles`.

> Deviation: `dsn-quote` landed in `quel.conn` with this task, since `target` needs it. A SQLite path that is a directory also counts as missing: `os/stat` has `:dir?` but no `:file?`.

### Task 6: Opening a target

**Files:** `src/quel/conn.lg`, `test/quel/conn_test.lg`, `test/quel/pg_test.lg`.

- [x] **Step 1: Write the tests** (the parse-error one needs no server): `open-target!` on a SQLite target returns `{:conn-id :engine :label}` with the given label; `redact` masks the raw and the DSN-escaped form of a `:secret` that holds `'`, `\` and spaces, inside an error that quotes the full generated DSN, and after a real `pg/open` parse failure (`sslmode='bogus'`); `check!` passes on an existing SQLite file and throws on a dead Postgres DSN (`host='127.0.0.1' port='1'`) without its secret in the message; in `pg_test`, a DSN target built from `QUEL_PG_URL`'s parts opens and runs `select 1` (parse the URL in the test with a regex).
- [x] **Step 2: Run** `lgx test-pg`. Expected: FAIL.
- [x] **Step 3:** Implement `open-target!`, `:dsn` in `open-pool`, `ping!`, `check!`, and the `:secret` and escape-aware masking in `redact`. Keep `open!`'s contract.
- [x] **Step 4: Run** `lgx test-pg`. Expected: PASS, the existing tests included.
- [x] **Step 5: Commit** `Open databases from a target map, and check one without keeping it`.

> Codex (reviewing Tasks 5-6) found two real bugs, both fixed in d7965c4. First, concurrent saves of one profile could leave its password and `has_password` disagreeing, so `save!` and `delete!` now take one lock, a size-1 `async` channel, since let-go has no `locking`. Second, a digit-only port past the long range parsed to nil and quietly became the default. A later review found that a `?` in a SQLite profile's file name opened another file. So every SQLite open, ad-hoc ones included, now goes through `conn/sqlite-uri` (7da0fb8), which the store shares.

### Task 7: Handlers, wiring and the menu item

**Files:** `src/quel/api.lg`, `src/quel/system.lg`, `src/quel/menu.lg`, their tests, `test/quel/pg_test.lg`.

- [x] **Step 1: Write the tests**: `api_test` (the handler set adds the six names; `save-profile` → `list-profiles` → `connect` → `run` → `close-db` on SQLite; `test-connection` of an unsaved form; `delete-profile`; a save with a duplicate name throws the message). Extend `with-env` with a temp store and memory secrets; `:app` stays nil, and `choose-file` is not called in tests. `system_test`: the new keys, the handlers' refs, `QUEL_SECRETS` deciding the backend. `menu_test`: the File menu has "New Connection…" emitting `menu:new-connection`. `pg_test`: the Postgres profile cases from the Testing list.
- [x] **Step 2: Run** `lgx test-pg`. Expected: FAIL.
- [x] **Step 3:** Implement the handlers and wiring per the Design. In `system/config`: `:quel.store/db {:dir nil}`, `:quel.secrets/store {:backend …}`, and `:store`, `:secrets` and `:app` refs on `:quel.api/handlers`. Halt order: the store closes after the handlers (the refs take care of it). The menu item is `{:label "New Connection…" :on-click (partial #'new-connection! env)}`, placed before "Open Database…", with no accelerator.
- [x] **Step 4: Run** `lgx test-pg`. Expected: PASS.
- [x] **Step 5: Commit** `Add the profile handlers and the New Connection menu item`.

> Deviation: the Postgres profile tests live in `pg_test` with their own env helper (`with-api-env`), as `api_test`'s `with-env` is SQLite-only.

### Task 8: Server mode and smoke

**Files:** `scripts/server-mode.sh`, `scripts/smoke.sh`.

- [x] **Step 1:** In `start_app`, make a temp data dir, export `QUEL_SECRETS=memory` and `QUEL_DATA_DIR=<it>` for the app, and remove the dir in `stop_app`.
- [x] **Step 2:** In `smoke.sh`, after the existing SQLite steps: `save-profile` with a SQLite map pointing at `$db`, `list-profiles` contains it, `connect` with its id returns a conn-id whose `run` of `select 1` answers. With `QUEL_PG_URL` set: build a profile map from the URL's parts with `python3` (`urllib.parse`), including the password, save it, check the reply has `"has-password":true` and no password, connect, and run `select 1`.
- [x] **Step 3: Run** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx smoke-pg`. Expected: PASS.
- [x] **Step 4: Commit** `Smoke-test profiles over the bridge`.

### Task 9: Frontend state

**Files:** `frontend/src/lib/{types,api}.ts`, `frontend/src/state/{store,runner,profiles,profileForm}.ts` and tests.

- [x] **Step 1: Write the tests**: `profileForm.test.ts`, `profiles.test.ts`, and the `connectProfile` cases in `runner.test.ts` (the Testing list).
- [x] **Step 2: Run** `npm --prefix frontend test`. Expected: FAIL.
- [x] **Step 3:** Implement the types, API calls, store fields, `switchTo` / `connectProfile`, `state/profiles.ts` and `state/profileForm.ts` per the Design. Existing `openDb` tests must pass unchanged, apart from the `Conn` shape (`profileId: null`, `color: "none"`).
- [x] **Step 4: Run** `npm --prefix frontend test && npm --prefix frontend run lint`. Expected: PASS.
- [x] **Step 5: Commit** `Keep profiles in the frontend store and connect them`.

> Deviation: `effective-password` takes the store too (`[db secrets p]`) and asks the Keychain only when the saved profile says `has-password`, after a review found that a passwordless profile still read the Keychain, which fails where there is no Secret Service (288a69d). A later review found the same for a server profile turned SQLite, so a SQLite profile now always counts as "forget": a leftover password is deleted and never read (72920d2).

### Task 10: Frontend UI

**Files:** the components listed in File Structure, `frontend/src/index.css`, `App.tsx`/`main.tsx` (wherever menu events are subscribed today).

- [x] **Step 1:** `npx shadcn@latest add dialog alert-dialog label select` in `frontend/` (follow /shadcn). Check that nothing generated conflicts with the existing `button`/`input`.
- [x] **Step 2:** Build `ConnMark`, `ConnectionsPanel`, `ProfileDialog` and the status bar change per the Design. Every input has a `<Label htmlFor>`. The dialog's buttons are named "Test", "Save", "Delete" and "Cancel", and the e2e relies on these names. Follow /frontend-design for spacing, keeping the panel's current density.
- [x] **Step 3:** Subscribe `menu:new-connection` and call `loadProfiles()` on start.
- [x] **Step 4: Verify by hand** in server mode (`CGO_ENABLED=0 GOFLAGS=-tags=server QUEL_SECRETS=memory QUEL_DATA_DIR=$(mktemp -d) lgx dev`, headless Chromium through Playwright or the preview tools): create, test, save, connect, edit, forget password, delete; check light and dark. Fix what looks wrong.
- [x] **Step 5: Run** `npm --prefix frontend test && npm --prefix frontend run lint && npm --prefix frontend run build`. Expected: PASS.
- [x] **Step 6: Commit** `List, edit and connect profiles in the database panel`.

> Deviation: shadcn generated its components importing `cn` from the `cn` npm package; they import `@/lib/utils` like the app code. The dialog's form state lives in an inner `ProfileEditor` that mounts with the dialog content, so each opening starts fresh without a state-resetting effect. The colour classes moved to `components/colors.ts` (lint: a component file exporting a constant). Hand-checked in server mode, in light and dark: create, Test with a missing file and then a good one, Save, connect, run, the Postgres error, edit with "Saved in Keychain" and Forget, delete through the confirm. The final review fixed two more things: save and delete touch the Keychain only for a saved password (621b8e8), and a Test result for settings since edited is dropped (e1035d4).

### Task 11: End to end

**Files:** `frontend/e2e/profiles.spec.ts`.

- [x] **Step 1:** Write the spec from the Testing list against `QUEL_E2E_DB`. Locate fields by label and buttons by role and name.
- [x] **Step 2: Run** `CGO_ENABLED=0 GOFLAGS=-tags=server lgx e2e`. Expected: all specs pass, the query-loop ones included.
- [x] **Step 3: Commit** `Test profiles end to end`.

> Deviation: a second spec covers a duplicate name. `scripts/e2e.sh` needs `CGO_ENABLED=0 GOFLAGS=-tags=server` for the whole script here, since its `lgx fe-build` builds the runtime too.

### Task 12: Docs

**Files:** `docs/DESIGN.md`, `README.md`, `AGENTS.md`.

- [x] **Step 1:** DESIGN: in "Connections and sessions", the profile fields this slice stores (read-only and confirm come with milestone 2) and the Keychain service/account; a short "App database" paragraph (data dir rules, `QUEL_DATA_DIR`, migrations inline); the Handler API row for Profiles and Connections (`connect` takes a profile id; `choose-file`; `open-db`/`close-db` for ad-hoc opens); the Upstream row for `keyring`, marked done in `keyring-v0.1.0`; milestone 1's line ("profiles and Keychain" done, with the date).
- [x] **Step 2:** README: where profiles live; `QUEL_DATA_DIR` and `QUEL_SECRETS=memory`. AGENTS.md: one line under "Rules that bite" saying that server-mode runs use `QUEL_SECRETS=memory` and a temp `QUEL_DATA_DIR`, so they never touch the real Keychain or profiles.
- [x] **Step 3: Commit** `Document profiles and the app database`.

> AGENTS.md also gets the `sqlite-uri` rule.

### Task 13: Backlog

- [x] **Step 1:** Add `docs/backlog/ask-for-unsaved-password.md` (`**Status: open**`): a profile without a saved password connects without one; a prompt on connect (kept for the session only) would cover people who do not want passwords stored. Follow AGENTS.md's backlog rules.
- [x] **Step 2: Commit** `Backlog: ask for a password that is not saved`.

### Task 14: Review, PR, macOS checks

- [x] **Step 1:** A codex review of the branch against master in the background. Fold real findings; re-run `lgx test-pg`, the frontend tests, `lgx smoke-pg` and `lgx e2e`.
- [x] **Step 2:** Push, open a PR against `master`, link it, wait for CI to go green. Do not merge without the user.
- [x] **Step 3:** Hand the user the macOS checklist from the Testing section.

> The final review found two more: a profile could be deleted while its own connection was still opening and land connected afterwards, and the dialog overflowed a 720×480 window. Both fixed in 1265bde. Re-run after them: `lgx test-pg` (125 tests), frontend (111), `lgx smoke-pg`, `lgx e2e` (7).

> After the plan, at the user's request: the Quick open form is gone, so the UI connects only through profiles. File > Open Database… (`⌘O`) opens the New Connection dialog filled in with the chosen SQLite file, named after it. The connected row has a Disconnect button, and the empty list offers "New connection…". The runner's `openDb` is gone. The `open-db` handler stays for the smoke test. The query-loop e2e connects through a profile (`e2e/connect.ts`).

## Completion summary

Implemented, Tasks 1-14, 2026-10-23, on branch `profiles`: PR #4, CI green.

- **Upstream:** letgo-packages #13 (merged), `keyring-v0.1.0`: `put!`,
  `get`, `delete!` and `use-memory!` over go-keyring v0.2.8, an in-tree
  shim with one lock around every call.
- **Backend:** `quel.store`, the app database in the per-user data dir,
  migrated with ragtime, its pragmas in the DSN. `quel.secrets` keeps
  passwords in the Keychain, or in memory with `QUEL_SECRETS=memory`.
  `quel.profiles` normalizes, validates, saves and deletes profiles under
  one lock, decides the password through one rule for save and test, and
  builds the target. `quel.conn` gains `open-target!`, `check!`, DSN
  targets, escape-aware redaction, and `file:` URIs for every SQLite open.
  Handlers: `list-profiles`, `save-profile`, `delete-profile`,
  `test-connection`, `connect`, `choose-file`. File gets "New Connection…".
- **Frontend:** the Connections panel (saved profiles, plus Quick open),
  the profile dialog (one input per field, Test before saving, Forget
  saved password, delete with a confirm), colour tags on the connection
  dot, `connectProfile`.
- **Verified:** `lgx test-pg`, frontend unit tests, lint and build,
  `lgx smoke-pg`, `lgx e2e`, and the UI by hand in server mode, light and
  dark. Not run: the macOS Keychain itself (no Mac here; the list is in
  the Testing section).

Deviations, in one place:

- `put!` instead of `set!` (a let-go special form); let-go's `mkdir` (no
  `os/mkdir-p`), and no `:file?` in `os/stat`.
- `effective-password` takes the store and reads the Keychain only when a
  password is saved; a SQLite profile always forgets its password.
- `dsn-quote` landed in Task 5; the Postgres profile tests have their own
  env in `pg_test`.
- shadcn's `cn` import fixed; the dialog's state lives in an inner
  component; the colour classes moved to `colors.ts`.
- Real bugs that codex found along the way, all fixed with tests:
  - a `?` in a SQLite path opened another file, in the store and in profiles;
  - concurrent saves of one profile could break `has_password`;
  - a port past the long range quietly became the default;
  - save, delete, test and connect asked the Keychain with no password saved;
  - a stale Test result replaced the current one;
  - a delete could race a connect;
  - the dialog overflowed a small window.

**What the plan could have specified better:** that the Keychain may be
absent, as on any Linux box with no Secret Service. The plan treated it as
always reachable, so four review rounds each found one more path that
touched it without need. A plan that adds an external dependency should
say which operations must work without it.
