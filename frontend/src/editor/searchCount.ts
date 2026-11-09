import type { EditorState } from "@codemirror/state";
import type { SearchQuery } from "@codemirror/search";

// How many matches the find panel's query has, and which one the main
// selection is on (1-based). Counting stops at the cap: past it the panel
// says "1000+".

export interface MatchCount {
  total: number;
  current: number | null;
  capped: boolean;
}

const NONE: MatchCount = { total: 0, current: null, capped: false };

export function countMatches(state: EditorState, query: SearchQuery, cap = 1000): MatchCount {
  if (!query.valid || query.search === "") return NONE;
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current: number | null = null;
  for (let m = cursor.next(); !m.done; m = cursor.next()) {
    if (total === cap) return { total, current, capped: true };
    total++;
    if (m.value.from === from && m.value.to === to) current = total;
  }
  return { total, current, capped: false };
}

export function countLabel(query: SearchQuery, count: MatchCount): string {
  if (!query.valid || query.search === "") return "";
  if (count.total === 0) return "No results";
  const total = count.capped ? `${count.total}+` : String(count.total);
  if (count.current !== null) return `${count.current} of ${total}`;
  return count.total === 1 && !count.capped ? "1 match" : `${total} matches`;
}
