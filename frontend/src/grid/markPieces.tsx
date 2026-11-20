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
  for (const [a, b] of ranges) {
    if (b <= at) continue;
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
