# Dragging a result tab stops scrolling when the pointer holds still

**Status: open**

## Problem

While a kept result tab is dragged (`components/useResultTabDrag.ts`), a
pointer within 24 px of the strip's left or right edge scrolls it 12 px
per `pointermove`. Holding the pointer still at the edge stops the
scroll, so a place off screen in a long strip is reached only by
wiggling the pointer. Found by the codex review of the kept-tab reorder
(`docs/plans/2026-11-11-1946-result-keys-and-kept-tab-reorder.md`).

## Idea

Run the edge scroll on a `requestAnimationFrame` loop while the pointer
sits in an edge zone. Each frame scrolls and recomputes the drop place
from the last pointer x, and the loop stops when the pointer leaves the
zone or the drag ends.
