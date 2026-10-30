import type { Cell, Column } from "@/lib/types";
import { display } from "./format";

// A column's starting width, from its header and the first page: wide
// enough for the widest value in a sample, at the grid's monospace
// character width, within bounds. The user resizes from there.

// Geist Mono at 13px renders at about 8.0px; a little over, so the
// cell's 1px border never clips the widest value.
export const CHAR_W = 8.1;
export const PAD = 20; // the cell's horizontal padding
export const MIN_W = 60;
export const MAX_W = 400;
const SAMPLE = 200;

export function initialWidths(columns: Column[], rows: Cell[][]): number[] {
  const sample = rows.slice(0, SAMPLE);
  return columns.map((c, i) => {
    // The header's name is set in the sans face, a little wider than the
    // grid's mono, and its type in a smaller size beneath it.
    let chars = Math.max(c.name.length + 2, Math.ceil(c.type.length * 0.85));
    for (const row of sample) chars = Math.max(chars, display(row[i]).text.length);
    return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(chars * CHAR_W + PAD)));
  });
}

// The row-number column: its digits at the grid's mono width, plus padding
// and border. Room for at least 4 digits once a result is paged (or may
// be), so it does not widen as pages load past 999; a small single-page
// result fits its own count (at least 2 digits).
export const FIRST_PAGE = 500; // the backend's first page
export function numberWidth(rowCount: number, more: boolean): number {
  const floor = more || rowCount >= FIRST_PAGE ? 4 : 2;
  return Math.ceil(Math.max(floor, String(rowCount).length) * CHAR_W + 17);
}
