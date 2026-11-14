# No editor font size setting

**Status: open**

## Problem

The editor's font size is fixed: `fontSize: "16px"` in the `chrome`
theme in `frontend/src/editor/setup.ts`. Zoom (View > Zoom In) scales the
whole window, so someone who wants a larger or smaller editor and the
rest as it is has no setting.

## Fix

A control in Settings: 12–24px, 16 by default, kept in the `settings`
table and applied by reconfiguring the editor's theme (a compartment, or
a theme built from the value). Every tab's saved `EditorState` needs it,
not only the open one. The size multiplies with zoom: 16px at 125% is
20px on screen.

The result grid keeps the interface's size: its rows are 34px
(`ROW_H` in `grid/ResultGrid.tsx`) for the virtualizer, so a grid that
followed the editor's font would need its row height derived from it.
