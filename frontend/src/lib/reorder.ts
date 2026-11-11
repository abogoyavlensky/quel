// Pure helpers for reordering a list by dragging one of its items
// (components/useResultTabDrag.ts).

// A copy of list with the item at `from` moved to `to`, clamped to the
// list's ends.
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item);
  return out;
}

// An item's horizontal extent on screen.
export interface Span {
  left: number;
  right: number;
}

const centre = (s: Span) => (s.left + s.right) / 2;

// The index the item at `from` should have with the pointer at x. The
// midpoint rule: it moves right past every following item whose centre is
// left of the pointer, else left past every preceding item whose centre is
// right of it. That does not flicker with items of different widths: after
// a swap the neighbour sits on the other side of the dragged item, its
// centre further from the pointer than before, so the next move does not
// undo the swap.
export function dragTarget(spans: readonly Span[], from: number, x: number): number {
  let i = from;
  while (i + 1 < spans.length && centre(spans[i + 1]) < x) i++;
  if (i !== from) return i;
  while (i > 0 && centre(spans[i - 1]) > x) i--;
  return i;
}
