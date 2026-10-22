# The window cannot load from the Vite dev server, so the frontend has no HMR

**Status: done**

Landed in letgo-packages `wails-v0.3.0` (#12, the asset handler proxies `FRONTEND_DEVSERVER_URL` in dev builds) and Quel's `lgx dev`, by `docs/plans/2026-10-22-0833-query-loop.md`, 2026-10-22.

## Problem

The dev loop rebuilds the frontend with `vite build --watch` (`lgx fe-watch`)
and reloads the whole window when `resources/public` changes
(`src/quel/dev.lg`, `w/watch-assets!`). That costs about a second per edit and
loses React state on every save. Real HMR needs the window to load the page
from Vite's dev server.

Two things stop it:

- The wails package (`letgo-packages/wails/shim/app.go`, `New`) sets
  `application.AssetOptions{Handler: newResourceAssets(prefix)}` for `:assets`.
  Wails' own dev-server proxy lives in `application.AssetFileServerFS` /
  `assetserver.NewAssetFileServer`, which return a reverse proxy when
  `FRONTEND_DEVSERVER_URL` is set. The custom resource handler never consults
  that variable, so setting it changes nothing but the start URL's port.
- Pointing the window at `http://localhost:5173` with `:url` instead does not
  work either: the page then has Vite's origin, and `@wailsio/runtime` sends
  its bridge calls (`/wails/runtime`) to that origin, where nothing answers.

Everything else about the dev loop works: handlers redefine over the nREPL,
and the rebuild-and-reload path is reliable.

## Proposed fix

In the wails package, when `FRONTEND_DEVSERVER_URL` is set and the build is
not `production`, wrap or replace the `:assets` handler with
`application.AssetFileServerFS(nil)` (which returns Wails' tuned reverse proxy
in that case), so the page is still served from Wails' origin while its
content comes from Vite. Keep `/wails/*` going to Wails.

Notes for whoever picks this up:

- Vite's HMR client opens a websocket to the page's host; on macOS the page is
  `wails://localhost`, so set `server.hmr` (host/clientPort) in
  `frontend/vite.config.ts` to reach Vite directly.
- Quel then gets a `dev` script (`vite`) and `lgx run` with
  `FRONTEND_DEVSERVER_URL=http://localhost:5173`; keep `fe-watch` for server
  mode and CI.
- Verify on macOS and in server mode; a test in the wails package's server-mode
  suite can assert that a request is proxied when the variable is set.

Size: a few lines in `wails/shim/app.go` plus a test and a README section, then
a small Quel change.

## Origin

Found while planning milestone 0
(`docs/plans/2026-10-19-2226-milestone-0-spike-and-setup.md`, "Dev loop
decision"), 2026-10-19. `docs/DESIGN.md` assumed the window could point at the
Vite dev server.
