# No Settings item in the macOS app menu

**Status: open**

## Problem

Settings opens with ⌘, and from the Command Palette, but macOS users look
for Quel > Settings… in the app menu. The wails shim builds the app menu
from its role (`{:role :app-menu}`), Wails' fixed `NewAppMenu`: About,
Services, Hide, Hide Others, Show All, Quit. It takes no items of ours,
which is also why Check for Updates sits in Help (`src/quel/menu.lg`).

## Fix

Upstream, in letgo-packages' `wails` shim (`shim/menu.go`): map Wails'
`ServicesMenu`, `Hide`, `HideOthers` and `UnHide` roles in `menuRoles`,
so an app can build its own app menu, or let `{:role :app-menu}` take
extra items. Then Quel's app menu gets "Settings…" with `CmdOrCtrl+,`,
emitting an event the frontend answers with `openSettings`. Double
delivery (menu and page both see ⌘,) is harmless: opening sets state,
it does not toggle. Update the registry entry's catchers and the
`menu.lg` drift test in `state/keymap.test.ts` with it.
