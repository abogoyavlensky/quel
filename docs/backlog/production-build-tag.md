# Built binaries keep Wails' devtools and dev asset server

**Status: open**

## Problem

`lgx build` should add the `production` Go build tag, which drops Wails'
devtools and dev asset server from the shipped binary (`docs/DESIGN.md`,
"Builds"). The lgx way to do that is
`:targets {:bin {:go/build-tags ["production"]}}` in `lgx.edn`, as
`examples/wails-tasks/lgx.edn` in the lgx repo does.

`:go/build-tags` landed in lgx after the 0.5.0 release (lgx commit
`d941501`, "Add :go/build-tags (#67)"), and Quel pins lgx 0.5.0 in
`.mise.toml`, so `lgx.edn` leaves the tag out (see the comment above
`:targets`). Today's `bin/quel` therefore ships the dev build of Wails. It
works; it is just larger and exposes devtools.

## Fix

Once an lgx release carries `:go/build-tags`:

1. Bump `lgx` in `.mise.toml` to that release.
2. Set `:targets {:bin {:out "bin/quel" :go/build-tags ["production"]}}` in
   `lgx.edn` and drop the comment that explains its absence.
3. `lgx build && ./bin/quel` on macOS: the window opens, and the devtools
   context menu is gone.

Notes for whoever picks this up:

- The tag must stay off `lgx run`: the dev loop needs Wails' dev asset server
  and devtools. `:targets :bin` scopes it to `lgx build`, which is the point.

Size: two lines plus a check on a Mac.

## Origin

Milestone 0 plan (`docs/plans/2026-10-19-2226-milestone-0-spike-and-setup.md`,
"Tooling decisions"), 2026-10-19.
