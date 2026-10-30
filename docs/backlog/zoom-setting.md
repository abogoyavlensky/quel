# No way to zoom the interface

**Status: open**

## Problem

Quel has no zoom. The redesign (`docs/plans/2026-10-30-2129-redesign.md`)
makes the defaults bigger: 13px small text, a 14.5px editor and 30px grid
rows. But someone who wants everything larger or smaller, at 125% say, has
no setting and no ⌘+ / ⌘−.

The grid and the structure tree size their rows in pixels for the
virtualizers (`ROW_H` in `grid/ResultGrid.tsx` and
`components/StructureTree.tsx`), and the editor sets its font size in
pixels. So scaling the root font size alone would leave them behind.

## Fix

Use the webview's own zoom, which scales everything, pixel values included.
Wails v3 has `WebviewWindow.SetZoom`, `ZoomIn`, `ZoomOut` and `ZoomReset`.
letgo-packages' `wails` does not expose them yet, so that comes first
upstream. Then Quel gets View > Zoom In / Zoom Out / Actual Size (⌘+, ⌘−,
⌘0) and keeps the level in the app database across restarts.

Avoid CSS `zoom` on the root: it tends to break the virtualizers' scroll
math and the mouse coordinates for column resizing.
