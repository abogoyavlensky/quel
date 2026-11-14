# Commands can't be rebound

**Status: open**

## Problem

Settings lists every command and its shortcut (`state/keymap.ts`), but
read-only. Someone used to another client's keys, or whose keyboard
layout makes ⌘. or ⌘= awkward, cannot change them.

## Fix

Record a shortcut on a row of the Keyboard Shortcuts section: click it,
press the keys; Escape cancels, Backspace unbinds. Reset per row and
Reset all. Store only the overrides, as a JSON `keybindings` row in the
`settings` table, holding the current platform's bindings as the
registry writes them (`Cmd-…` on macOS, `Ctrl-…` elsewhere).

- A key already taken by another command: offer to reassign it, which
  leaves the other command unbound.
- Refuse ⌘Q, ⌘H, ⌘M and the Edit menu's keys (copy, paste, undo).
- Warn about keys CodeMirror binds: the page's capture-phase listener
  would take them from the editor.
- Require a modifier, except for F-keys: a bare letter would stop typing.

Who catches a rebound key has to be settled first. Today some keys reach
the page twice, from the native menu's accelerator and from the page's
own listener, which is only safe for actions that can run twice (see
`docs/DESIGN.md`, Palettes and keys).

- **A (preferred):** the page owns every rebindable key, and the native
  menu items drop their accelerators. No key is caught twice, server
  mode behaves like the app, and the `menu.lg` drift test in
  `state/keymap.test.ts` goes. The menus stop showing shortcuts. Check
  first that WKWebView hands the page keys no menu item claims, ⌘. in
  particular (Cocoa's cancel).
- **B:** rebuild the native menu with the user's accelerators
  (`quel.menu/install!` already rebuilds in place) and have the page skip
  what the menu delivers. The menus keep their shortcuts, but the page
  must know which keys the menu covers, only in app mode, and every key
  must convert to Wails' accelerator format.
