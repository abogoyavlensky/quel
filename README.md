# Quel

Quel is a desktop database client for writing SQL and browsing database
structure, in the spirit of TablePlus. It is written in
[let-go](https://github.com/nooga/let-go) on [Wails v3](https://v3.wails.io),
with a React frontend. macOS comes first. See [docs/DESIGN.md](docs/DESIGN.md)
for the design and [docs/plans/](docs/plans/) for the implementation plans.

Status: milestone 0, a spike that opens a SQLite file, runs a query, and
cancels a runaway one.

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
lgx fe-watch       # terminal 1: rebuild the frontend on every change
lgx run            # terminal 2: the app, with an nREPL inside it
```

Start `lgx run` once `fe-watch` has finished its first build: the app
refuses to start while `resources/public` is missing.

Saving a frontend file rebuilds it into `resources/public`, and the window
reloads. The nREPL port is in `.nrepl-port`; handlers are registered by
var, so redefining one from your editor changes what the next call runs.

### Without a desktop

On a machine without the webview headers, Wails' server mode runs the
same app as an HTTP server you open in a browser:

```sh
CGO_ENABLED=0 GOFLAGS=-tags=server lgx run    # http://localhost:8080
```

Menus and file dialogs do nothing there.

## Test

```sh
lgx test                    # backend (the Postgres tests skip)
lgx test-pg                 # backend, with a throwaway Postgres in Docker
npm --prefix frontend test  # frontend
lgx smoke                   # the app in server mode, driven over HTTP
lgx smoke-pg                # the same, plus Postgres in Docker
```

The `-pg` tasks need Docker. Without the webview headers, prefix the test
and smoke tasks with `CGO_ENABLED=0 GOFLAGS=-tags=server`.

## Build

```sh
lgx build && ./bin/quel
```

The binary embeds the frontend. Packaging into a `.app` is the `wails3`
CLI's job and is not wired up yet.
