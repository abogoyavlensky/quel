# Zooming out below 100%

**Status: open**

## Problem

Quel's zoom ladder runs from 100% to 150%, so ⌘- stops at the default size.
Wails clamps `SetZoom` to at least 1.0 on macOS and on Linux, and `ZoomOut`
stops at 1.0, so the `wails` package cannot go lower. The default sizes are
already large (15.5px body text, a 16px editor), and someone on a laptop may
want more on screen.

## Fix

Add a darwin-only cgo file to the wails shim that sets `pageZoom` on the
window's `webView`, reached through `WebviewWindow.NativeWindow()`, and use it
in `set-zoom!`. Then add lower steps to `zoom-levels` in `quel.window`.

Below 100% the title strip needs a second look: it would still divide by
`--zoom`, and the left padding, which clears the traffic lights, would shrink
in points.
