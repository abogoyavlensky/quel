# Quel - agent notes

Quel is a desktop database client. Backend: let-go (managed by lgx) on
Wails v3 through letgo-packages' `wails` package, wired with integrant.
Frontend: Vite + React + TypeScript + Tailwind + shadcn in `frontend/`,
built into `resources/public`.

- Design: `docs/DESIGN.md`. Plans: `docs/plans/`. Backlog: `docs/backlog/`.
  Developer setup: `docs/DEVELOPMENT.md`.
  Releases: `docs/RELEASE.md`.
- Reference app for the patterns used here: `examples/wails-tasks` in the
  lgx repo.

## Commands

| | |
|---|---|
| `lgx fe-install` / `lgx fe-build` / `lgx fe-watch` | frontend deps, build, rebuild on change |
| `lgx dev` | the app with its frontend from Vite's dev server (HMR) and an nREPL inside (`.nrepl-port`) |
| `lgx run` | the app with an nREPL inside, the frontend from `resources/public` |
| `lgx test` | backend tests (Postgres tests skip) |
| `lgx test-pg` | backend tests with a throwaway Postgres in Docker |
| `npm --prefix frontend test` | frontend tests |
| `lgx smoke` / `lgx smoke-pg` | server-mode smoke test over HTTP; `-pg` adds Postgres in Docker |
| `lgx e2e` | Playwright UI tests against the app in server mode |
| `lgx build` | frontend + binary at `bin/quel` |
| `lgx package-macos` / `lgx verify-macos` | `dist/Quel.app` (unsigned) on an Apple Silicon Mac; check it and launch an ad-hoc signed copy |
| `lgx sign-macos` / `lgx verify-macos --distribution` | Developer ID signing, notarization and the release zip in `dist/`; check the zip as a user gets it. Needs `APPLE_SIGNING_IDENTITY` and `APPLE_NOTARY_PROFILE` |
| `lgx test-release` | release script tests (signing, cask, GitHub Release, tap), with stand-ins for Apple's tools and GitHub (runs on Linux) |

On Linux without GTK4/WebKitGTK headers, prefix `lgx dev`, `lgx run` and
the test, smoke and e2e tasks with `CGO_ENABLED=0 GOFLAGS=-tags=server`. The `-pg`
tasks need Docker.

## Rules that bite

- All application code is let-go. What let-go cannot reach goes upstream
  into letgo-packages as a reusable feature, not app-local Go.
- Register handlers and menu clicks by var (`#'f`, `(partial #'f env)`), so
  redefining them from the nREPL takes effect without a restart.
- `quel.app` is the entry script and ends in `(when-not *compiling-aot*
  (-main))`: nothing may require it. Components live in other namespaces.
- No `with-redefs` / `alter-var-root` in application code, and no SQL or
  other runtime data loaded from resources (keeps `:target :native`
  possible).
- React effects get braces: `useEffect(() => { el.scrollIntoView() }, ...)`.
  Current Chromium returns a Promise from `scrollIntoView`, and an arrow
  that returns it hands React a "cleanup" it crashes on.
- `os/getenv` returns `""` for an unset variable, and `""` is truthy: check
  with `str/blank?`.
- Never point a test or a server-mode run at the real profiles or Keychain:
  `scripts/server-mode.sh` sets `QUEL_SECRETS=memory` and a temporary
  `QUEL_DATA_DIR`; backend tests use `{:backend :memory}` and a temp
  `:dir`. Linux boxes usually have no Secret Service at all.
- A pushed `v*` tag publishes a release (signed app, GitHub Release, tap
  update). Push one tag by name, never `git push --tags`, and only when
  asked to release.
- Every SQLite file opens through `quel.conn/sqlite-uri` (a `file:` URI):
  a raw path with `?` or `#` opens a different file.

## Backlog

`docs/backlog/` holds known issues and ideas that are not being worked on yet.

- One file per issue, named after it (`format-selection-column-offset.md`).
- Each file starts with `**Status: open**`. When a plan is written for it,
  change the status to `**Status: planned**` with a `Plan: docs/plans/...`
  line under it; when the work ships, change it to `**Status: done**` with a
  line saying where it landed. Never delete an entry.
- "What's in the backlog?" means the open files — list every file whose status
  is not done, with its title.
- Adding an entry is its own commit (`Backlog: <what>`), never mixed with code.
