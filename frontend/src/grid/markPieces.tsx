import type { ReactNode } from "react";

// Highlighted matches inside a value (grid/marks.ts finds them): the row
// details panel's filter. A quiet tint that reads in light and dark.

export const MARK_CLASS = "rounded-[2px] bg-yellow-300/45 text-inherit dark:bg-yellow-400/30";

// The pieces of text, which starts at offset start of the whole value,
// with the parts inside ranges wrapped in <mark>. ranges are sorted and do
// not overlap; key prefixes the pieces' keys.
export function markPieces(text: string, start: number, ranges: ReadonlyArray<[number, number]>, key: string): ReactNode[] {
  const end = start + text.length;
  const out: ReactNode[] = [];
  let at = start;
  // JsonCode calls this once per token: start from the first range that
  // ends past start, found by binary search, so many tokens times many
  // matches stays cheap.
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid][1] <= start) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < ranges.length; i++) {
    const [a, b] = ranges[i];
    if (a >= end) break;
    const from = Math.max(a, at);
    const to = Math.min(b, end);
    if (from > at) out.push(text.slice(at - start, from - start));
    out.push(
      <mark key={`${key}-${from}`} className={MARK_CLASS}>
        {text.slice(from - start, to - start)}
      </mark>,
    );
    at = to;
  }
  if (at < end) out.push(text.slice(at - start));
  return out;
}
