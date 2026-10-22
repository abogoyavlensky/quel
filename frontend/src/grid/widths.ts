import type { Cell, Column } from "@/lib/types";
import { display } from "./format";

// A column's starting width, from its header and the first page: wide
// enough for the widest value in a sample, at the grid's monospace
// character width, within bounds. The user resizes from there.

export const CHAR_W = 7.3; // Geist Mono at 12px
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
