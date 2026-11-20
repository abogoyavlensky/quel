import { type RefObject, useEffect, useState } from "react";

// How much of the editor's corner its scrollbars take: the vertical bar's
// width (right) and the horizontal bar's height (bottom), in px. The
// editor is a sibling of the element ref points to (AppShell puts the
// editor and the Run button in one relative wrapper). Scrollbars that show
// only while scrolling (macOS' default) take no room, so both stay 0.
// Re-measured when the pane resizes and when the document grows or
// shrinks, which is when scrollbars come and go.

export interface ScrollbarInset {
  right: number;
  bottom: number;
}

export function useScrollbarInset(ref: RefObject<HTMLElement | null>): ScrollbarInset {
  const [inset, setInset] = useState<ScrollbarInset>({ right: 0, bottom: 0 });

  useEffect(() => {
    const scroller = ref.current?.parentElement?.querySelector<HTMLElement>(".cm-scroller");
    if (!scroller) return;
    const measure = () => {
      const right = scroller.offsetWidth - scroller.clientWidth;
      const bottom = scroller.offsetHeight - scroller.clientHeight;
      setInset((p) => (p.right === right && p.bottom === bottom ? p : { right, bottom }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    const content = scroller.querySelector(".cm-content");
    if (content) observer.observe(content);
    measure();
    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return inset;
}
