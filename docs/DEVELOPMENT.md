# Developing Quel

Quel's backend is [let-go](https://github.com/nooga/let-go), managed by
[lgx](https://github.com/abogoyavlensky/lgx), on
[Wails v3](https://v3.wails.io). The frontend is Vite, React and TypeScript
in `frontend/`. The design is in [DESIGN.md](DESIGN.md), the implementation
plans in [plans/](plans/), and releases in [RELEASE.md](RELEASE.md).

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

## Run

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

### Scratch data

Two variables keep a run away from your real profiles and Keychain:

```sh
QUEL_DATA_DIR=/tmp/quel-scratch QUEL_SECRETS=memory lgx run
```

`QUEL_SECRETS=memory` keeps passwords in memory for the run. The smoke and
e2e tasks set both. On Linux the app database lives in `$XDG_DATA_HOME/quel`
or `~/.local/share/quel`.

## Test

```sh
lgx test                    # backend (the Postgres tests skip)
lgx test-pg                 # backend, with a throwaway Postgres in Docker
npm --prefix frontend test  # frontend
lgx smoke                   # the app in server mode, driven over HTTP
lgx smoke-pg                # the same, plus Postgres in Docker
lgx e2e                     # the UI, with Playwright, in server mode
lgx test-release            # the release scripts, with stand-ins for Apple's tools
```

The `-pg` tasks need Docker. `lgx e2e` needs Playwright's Chromium once:
`npx --prefix frontend playwright install chromium`. Without the webview
headers, prefix the test, smoke and e2e tasks with
`CGO_ENABLED=0 GOFLAGS=-tags=server`.

## Build

```sh
lgx build && ./bin/quel
```

The binary is compiled natively, embeds the frontend, and is built with
Wails' `production` tag (no devtools, no dev asset server).

On an Apple Silicon Mac, `lgx package-macos` wraps it into `dist/Quel.app`
(unsigned) and `lgx verify-macos` checks the bundle and launches an ad-hoc
signed copy with scratch data. Signing, notarization and publishing are in
[RELEASE.md](RELEASE.md).
