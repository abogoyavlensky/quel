import type { Cell } from "@/lib/types";
import type { RowsSort } from "@/state/store";

// Sorting a result's rows in memory, on the raw cells (never the display
// text). Kinds order boolean < number < text < NULL: NULL is the largest
// value, so it is last ascending and first descending (the Postgres
// default), and a mixed SQLite column puts numbers before text, as SQLite
// does. In a numeric column a string that reads as a number (big
// integers, decimals) compares as one, exactly.

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const SPECIAL = new Set(["NaN", "Infinity", "-Infinity", "+Infinity"]);
const PLAIN = /^([+-]?)(\d*)(?:\.(\d*))?$/;

const collator = new Intl.Collator(undefined, { sensitivity: "variant" });

const isNumberText = (s: string) => NUMBER.test(s) || SPECIAL.has(s);

function rank(cell: Cell, numeric: boolean): number {
  if (cell === null) return 3;
  if (typeof cell === "boolean") return 0;
  if (typeof cell === "number") return 1;
  return numeric && isNumberText(cell) ? 1 : 2;
}

// Two plain decimals ("-12.50", "007"), exactly; 0 for anything else
// (exponents, NaN), which the caller has already ordered as doubles.
export function compareDecimal(a: string, b: string): number {
  const ma = PLAIN.exec(a);
  const mb = PLAIN.exec(b);
  if (!ma || !mb) return 0;
  const parts = (m: RegExpExecArray) => {
    const int = m[2].replace(/^0+/, "");
    const frac = (m[3] ?? "").replace(/0+$/, "");
    const zero = int === "" && frac === "";
    return { neg: m[1] === "-" && !zero, int, frac };
  };
  const x = parts(ma);
  const y = parts(mb);
  if (x.neg !== y.neg) return x.neg ? -1 : 1;
  let c = x.int.length - y.int.length || (x.int < y.int ? -1 : x.int > y.int ? 1 : 0);
  if (c === 0) {
    const n = Math.max(x.frac.length, y.frac.length);
    const fx = x.frac.padEnd(n, "0");
    const fy = y.frac.padEnd(n, "0");
    c = fx < fy ? -1 : fx > fy ? 1 : 0;
  }
  return c === 0 ? 0 : x.neg ? -c : c;
}

function compareNumbers(a: number | string, b: number | string): number {
  // Number() rounds monotonically, so strict inequality of the doubles
  // means strict inequality of the exact values; only equal doubles need
  // the exact decimal comparison.
  const x = Number(a);
  const y = Number(b);
  const nx = Number.isNaN(x);
  const ny = Number.isNaN(y);
  if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1; // NaN above all, as in Postgres
  if (x !== y) return x < y ? -1 : 1;
  if (typeof a === "string" && typeof b === "string") return compareDecimal(a, b);
  return 0;
}

// Ascending order of two cells of a column.
export function compareCells(a: Cell, b: Cell, numeric: boolean): number {
  const ra = rank(a, numeric);
  const rb = rank(b, numeric);
  if (ra !== rb) return ra - rb;
  switch (ra) {
    case 0:
      return Number(a) - Number(b);
    case 1:
      return compareNumbers(a as number | string, b as number | string);
    case 2:
      return collator.compare(a as string, b as string);
    default:
      return 0;
  }
}

// The rows in the sort's order, as a new array. Stable: equal cells keep
// their order either way (descending negates the comparison rather than
// reversing the array).
export function sortRows(rows: Cell[][], s: RowsSort, numeric: boolean): Cell[][] {
  const sign = s.dir === "asc" ? 1 : -1;
  const i = s.column;
  return rows.slice().sort((a, b) => sign * compareCells(a[i], b[i], numeric) || 0);
}

// What a click on a column's header makes of the current sort: ascending,
// then descending, then none; another column starts at ascending.
export function nextSort(cur: RowsSort | null, column: number): RowsSort | null {
  if (cur?.column !== column) return { column, dir: "asc" };
  return cur.dir === "asc" ? { column, dir: "desc" } : null;
}
