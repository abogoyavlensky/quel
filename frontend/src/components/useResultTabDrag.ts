import { useEffect, useRef, useState } from "react";
import { type Span, dragTarget } from "@/lib/reorder";
import { moveResult } from "@/state/runner";

// Dragging a kept result tab along the strip (components/ResultTabs.tsx).
// A press on a kept tab arms a drag; past a few pixels it becomes one, and
// each move puts the tab where the pointer is (lib/reorder.ts, the
// midpoint rule): the tabs reorder in place, nothing floats under the
// pointer. Before that nothing happens, so a click, a double-click
// (rename) and the right-click menu work as before. Escape or a cancelled
// pointer puts the tab back; the click after a drop is swallowed, so a
// drop never selects. The window listens from the press to the release:
// no pointer capture, since React moves a keyed tab's node when the order
// changes and a node that leaves the document loses its capture.

const THRESHOLD = 4; // px the pointer moves before a press is a drag
const EDGE = 24; // px from the strip's ends where a drag scrolls it
const STEP = 12; // px it scrolls per move

interface Drag {
  id: string; // the dragged result
  strip: HTMLElement;
  startX: number;
  startIndex: number;
  moved: boolean; // past the threshold: a drag, not a press
}

const resultTabs = (strip: HTMLElement) => [...strip.querySelectorAll<HTMLElement>("[data-result-id]")];
const span = (el: HTMLElement): Span => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right };
};

export function useResultTabDrag(tabId: string): {
  dragging: string | null;
  stripProps: { onPointerDown: React.PointerEventHandler; onClickCapture: React.MouseEventHandler };
} {
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const stop = useRef<(() => void) | null>(null); // ends the drag in place
  const swallow = useRef(false); // the click after a drop

  // Another editor tab (the component is reused for it) or unmount: the
  // drag ends where it is.
  useEffect(() => {
    return () => {
      stop.current?.();
    };
  }, [tabId]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.ctrlKey || drag.current) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input")) return;
    const strip = e.currentTarget as HTMLElement;
    const el = target.closest<HTMLElement>("[data-result-id][data-kept]");
    const id = el?.dataset.resultId;
    if (!el || !id || !strip.contains(el)) return;
    drag.current = {
      id,
      strip,
      startX: e.clientX,
      startIndex: resultTabs(strip).indexOf(el),
      moved: false,
    };

    const end = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      drag.current = null;
      stop.current = null;
      setDragging(null);
    };
    // Back to where it started (clamped: a run may have changed the
    // results meanwhile), then end.
    const putBack = () => {
      const d = drag.current;
      if (d?.moved) moveResult(tabId, d.id, d.startIndex);
      end();
    };
    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved) {
        if (Math.abs(ev.clientX - d.startX) <= THRESHOLD) return;
        d.moved = true;
        setDragging(d.id);
      }
      const tabs = resultTabs(d.strip);
      const from = tabs.findIndex((t) => t.dataset.resultId === d.id);
      if (from < 0) return end(); // closed or replaced meanwhile
      const to = dragTarget(tabs.map(span), from, ev.clientX);
      if (to !== from) moveResult(tabId, d.id, to);
      const r = d.strip.getBoundingClientRect();
      if (ev.clientX < r.left + EDGE) d.strip.scrollLeft -= STEP;
      else if (ev.clientX > r.right - EDGE) d.strip.scrollLeft += STEP;
    };
    const onUp = () => {
      if (drag.current?.moved) {
        swallow.current = true;
        // No click follows a release off the strip: a later one must not
        // be eaten.
        setTimeout(() => (swallow.current = false));
      }
      end();
    };
    const onCancel = () => putBack();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !drag.current?.moved) return;
      ev.preventDefault();
      ev.stopPropagation();
      putBack();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    stop.current = end;
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (!swallow.current) return;
    swallow.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  return { dragging, stripProps: { onPointerDown, onClickCapture } };
}
