import type { MatchCount } from "@/editor/searchCount";
import type { Cell } from "@/lib/types";
import type { CellPos, GridFind } from "@/state/store";

// Find in a result: a match is a whole cell, tested on its raw value
// (strings as they are, numbers and booleans as String() writes them; NULL
// never matches). Positions are in the rows as shown, row-major.

export type FindQuery = Pick<GridFind, "search" | "caseSensitive" | "wholeWord" | "regexp">;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// test is null for an empty or invalid query; valid is false only for a
// bad regular expression. No g flag: test keeps no lastIndex between cells.
export function cellMatcher(q: FindQuery): { valid: boolean; test: ((cell: Cell) => boolean) | null } {
  if (q.search === "") return { valid: true, test: null };
  let source = q.regexp ? q.search : escape(q.search);
  if (q.wholeWord) source = `\\b(?:${source})\\b`;
  let re: RegExp;
  try {
    re = new RegExp(source, q.caseSensitive ? "u" : "iu");
  } catch {
    return { valid: false, test: null };
  }
  return { valid: true, test: (cell) => cell !== null && re.test(typeof cell === "string" ? cell : String(cell)) };
}

// How many cells match, up to cap, and which one current is (1-based).
export function countCellMatches(
  rows: Cell[][],
  test: (c: Cell) => boolean,
  current: CellPos | null,
  cap = 1000,
): MatchCount {
  let total = 0;
  let index: number | null = null;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      if (!test(row[c])) continue;
      if (total === cap) return { total, current: index, capped: true };
      total++;
      if (current && current.row === r && current.col === c) index = total;
    }
  }
  return { total, current: index, capped: false };
}

// The next match after from (dir 1) or before it (dir -1), wrapping at
// both ends; from itself comes last. From null, forward starts at the top
// and back at the bottom. Null when nothing matches.
export function stepMatch(
  rows: Cell[][],
  from: CellPos | null,
  dir: 1 | -1,
  test: (c: Cell) => boolean,
): CellPos | null {
  const n = rows.length;
  const total = rows.reduce((k, row) => k + row.length, 0);
  if (total === 0) return null;
  const width = (r: number) => rows[r].length;
  let r = from ? from.row : dir === 1 ? 0 : n - 1;
  let c = from ? from.col : dir === 1 ? -1 : width(r);
  // Every cell once, from itself last.
  for (let seen = 0; seen <= total; ) {
    c += dir;
    if (c < 0 || c >= width(r)) {
      r = (r + dir + n) % n;
      c = dir === 1 ? 0 : width(r) - 1;
      if (width(r) === 0) continue;
    }
    seen++;
    if (test(rows[r][c])) return { row: r, col: c };
  }
  return null;
}
