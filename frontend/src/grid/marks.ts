// Where a search text occurs in a value, for the row details panel's
// highlights (components/RowDetails.tsx, grid/JsonCode.tsx).

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Non-overlapping [start, end) ranges where needle occurs in text, ignoring
// case. A case-insensitive regex rather than lowercasing both: lowercasing
// can change a string's length (İ), which would shift the offsets.
// An empty needle gives [].
export function matchRanges(text: string, needle: string): Array<[number, number]> {
  if (needle === "") return [];
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(new RegExp(escape(needle), "giu"))) {
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

// Whether needle occurs in text, ignoring case, as matchRanges finds it.
export const hasMatch = (text: string, needle: string) => needle !== "" && new RegExp(escape(needle), "iu").test(text);
