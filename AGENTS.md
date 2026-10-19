# Quel - agent notes

Quel is a desktop database client. Backend: let-go (managed by lgx) on
Wails v3 through letgo-packages' `wails` package, wired with integrant.
Frontend: Vite + React + TypeScript + Tailwind + shadcn in `frontend/`,
built into `resources/public`.

- Design: `docs/DESIGN.md`. Plans: `docs/plans/`. Backlog: `docs/backlog/`.
- Reference app for the patterns used here: `examples/wails-tasks` in the
  lgx repo.

## Commands

| | |
|---|---|
| `lgx fe-install` / `lgx fe-build` / `lgx fe-watch` | frontend deps, build, rebuild on change |
| `lgx run` | the app with an nREPL inside (`.nrepl-port`) |
| `lgx test` | backend tests |
| `npm --prefix frontend test` | frontend tests |
| `lgx smoke` | server-mode smoke test over HTTP |
| `lgx build` | frontend + binary at `bin/quel` |

On Linux without GTK4/WebKitGTK headers, prefix `lgx run`, `lgx test` and
`lgx smoke` with `CGO_ENABLED=0 GOFLAGS=-tags=server`.

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
- `os/getenv` returns `""` for an unset variable, and `""` is truthy: check
  with `str/blank?`.
