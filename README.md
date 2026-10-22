# Quel

Quel is a desktop database client for writing SQL and browsing database
structure, in the spirit of TablePlus. It is written in
[let-go](https://github.com/nooga/let-go) on [Wails v3](https://v3.wails.io),
with a React frontend. macOS comes first. See [docs/DESIGN.md](docs/DESIGN.md)
for the design and [docs/plans/](docs/plans/) for the implementation plans.

Status: milestone 1 in progress. Quel opens a SQLite file or a Postgres
or Redshift URL; it has editor tabs, each with its own session; and it
runs the statement under the cursor, the selection or the whole script
into result tabs. The results load page by page as you scroll, and a
result can be pinned. A runaway query can be cancelled.

## Prerequisites

- [mise](https://mise.jdx.dev): `mise install` brings lg, lgx, Go and Node
  at the versions in `.mise.toml`.
- Wails is cgo on the Unix desktops:

  | Platform | Needs |
  |---|---|
  | macOS | Xcode command line tools |
  | Linux | `libgtk-4-dev libwebkitgtk-6.0-dev` and a C compiler |

The first `lgx run` or `lgx test` builds a custom `lg` runtime with Wails
and SQLite linked in. It takes a few minutes and is cached afterwards.

## Develop

```sh
lgx fe-install     # once
lgx dev            # the app, its frontend from Vite's dev server (HMR)
```

`lgx dev` starts Vite on port 5173 and the app with
`FRONTEND_DEVSERVER_URL` pointing at it: saving a frontend file updates
the window in place, keeping its state. The nREPL port is in
`.nrepl-port`; handlers are registered by var, so redefining one from
your editor changes what the next call runs.

Without the dev server, `lgx fe-watch` in one terminal rebuilds the
frontend into `resources/public` on every change, and `lgx run` in
another reloads the window when it does (start `lgx run` once the first
build is done).

### Without a desktop

On a machine without the webview headers, Wails' server mode runs the
same app as an HTTP server you open in a browser:

```sh
CGO_ENABLED=0 GOFLAGS=-tags=server lgx dev    # http://localhost:8080
```

Menus and file dialogs do nothing there.

## Test

```sh
lgx test                    # backend (the Postgres tests skip)
lgx test-pg                 # backend, with a throwaway Postgres in Docker
npm --prefix frontend test  # frontend
lgx smoke                   # the app in server mode, driven over HTTP
lgx smoke-pg                # the same, plus Postgres in Docker
lgx e2e                     # the UI, with Playwright, in server mode
```

The `-pg` tasks need Docker. `lgx e2e` needs Playwright's Chromium once:
`npx --prefix frontend playwright install chromium`. Without the webview headers, prefix the test,
smoke and e2e tasks with `CGO_ENABLED=0 GOFLAGS=-tags=server`.

## Build

```sh
lgx build && ./bin/quel
```

The binary embeds the frontend and is built with Wails' `production`
tag (no devtools, no dev asset server). Packaging into a `.app` is the `wails3`
CLI's job and is not wired up yet.
