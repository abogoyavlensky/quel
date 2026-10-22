import type { Cell } from "@/lib/types";

// How a cell reads in the grid. Values arrive bridge-safe from quel.cells
// (big integers and decimals as strings); this only decides the text.

export type CellKind = "null" | "bool" | "number" | "text";

// The most characters a cell's text keeps: a cell shows one line, cut at
// its width, so more is never seen; the full value is the cell's title.
const MAX_CHARS = 1000;

export function display(cell: Cell): { text: string; kind: CellKind } {
  if (cell === null) return { text: "NULL", kind: "null" };
  if (typeof cell === "boolean") return { text: String(cell), kind: "bool" };
  if (typeof cell === "number") return { text: String(cell), kind: "number" };
  const line = cell.length > MAX_CHARS ? `${cell.slice(0, MAX_CHARS)}…` : cell;
  return { text: line.replace(/\r?\n/g, "↵"), kind: "text" };
}

// Numeric columns are right-aligned, including the ones whose values come
// as strings (int8 past 2^53, numeric). Arrays (_INT4) are not numbers.
const numeric = /^(INT[248]?|INTEGER|SMALLINT|BIGINT|TINYINT|MEDIUMINT|NUMERIC|DECIMAL|REAL|FLOAT[48]?|DOUBLE|MONEY|HUGEINT|UBIGINT|UINTEGER)\b/i;

export function isNumericType(type: string): boolean {
  return numeric.test(type);
}
