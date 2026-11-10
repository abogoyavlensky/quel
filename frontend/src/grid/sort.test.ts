import { describe, expect, it } from "vitest";
import type { Cell } from "@/lib/types";
import { compareCells, compareDecimal, nextSort, sortRows } from "./sort";

const col = (cells: Cell[]) => cells.map((c) => [c]);
const sorted = (cells: Cell[], dir: "asc" | "desc", numeric = false) =>
  sortRows(col(cells), { column: 0, dir }, numeric).map((r) => r[0]);

describe("compareCells", () => {
  it("orders kinds boolean, number, text, NULL", () => {
    expect(sorted([null, "b", 2, true], "asc")).toEqual([true, 2, "b", null]);
  });

  it("puts NULL last ascending and first descending", () => {
    expect(sorted([null, 1, 2], "asc")).toEqual([1, 2, null]);
    expect(sorted([1, null, 2], "desc")).toEqual([null, 2, 1]);
  });

  it("compares numeric strings as numbers in a numeric column", () => {
    expect(compareCells("10", "9", true)).toBeGreaterThan(0);
    expect(compareCells("9007199254740993", "9007199254740992", true)).toBeGreaterThan(0);
    expect(compareCells("-1.50", "-1.5", true)).toBe(0);
    expect(compareCells("0.1", "0.10000000000000001", true)).toBeLessThan(0);
    expect(compareCells("NaN", "Infinity", true)).toBeGreaterThan(0);
    expect(compareCells("NaN", "NaN", true)).toBe(0);
    expect(compareCells(5, "6", true)).toBeLessThan(0);
    expect(compareCells("-Infinity", "-1e300", true)).toBeLessThan(0);
    // Equal as doubles, yet ordered.
    expect(compareCells("Infinity", "1" + "0".repeat(400), true)).toBeGreaterThan(0);
    expect(compareCells("-" + "1".repeat(400), "-Infinity", true)).toBeGreaterThan(0);
    expect(compareCells("Infinity", "Infinity", true)).toBe(0);
    expect(compareCells(9007199254740992, "9007199254740993", true)).toBeLessThan(0);
    expect(compareCells("9007199254740993", 9007199254740992, true)).toBeGreaterThan(0);
  });

  it("keeps two NaN rows in arrival order either way", () => {
    const rows: Cell[][] = [["NaN", "a"], ["1", "x"], ["NaN", "b"]];
    expect(sortRows(rows, { column: 0, dir: "asc" }, true).map((r) => r[1])).toEqual(["x", "a", "b"]);
    expect(sortRows(rows, { column: 0, dir: "desc" }, true).map((r) => r[1])).toEqual(["a", "b", "x"]);
  });

  it("compares strings as text outside numeric columns", () => {
    expect(compareCells("10", "9", false)).toBeLessThan(0);
  });

  it("sorts text with the collator", () => {
    expect(sorted(["c", "B", "a"], "asc")).toEqual(["a", "B", "c"]);
  });

  it("orders false before true", () => {
    expect(sorted([true, false], "asc")).toEqual([false, true]);
  });
});

describe("compareDecimal", () => {
  it("compares sign, integer and fraction exactly", () => {
    expect(compareDecimal("007", "7")).toBe(0);
    expect(compareDecimal("-0", "0")).toBe(0);
    expect(compareDecimal("-2", "-10")).toBeGreaterThan(0);
    expect(compareDecimal("123", "45")).toBeGreaterThan(0);
    expect(compareDecimal("1.05", "1.5")).toBeLessThan(0);
    expect(compareDecimal("1e5", "2")).toBe(0);
  });
});

describe("sortRows", () => {
  it("is stable both ways and leaves its input alone", () => {
    const rows: Cell[][] = [[1, "a"], [0, "b"], [1, "c"], [0, "d"]];
    const copy = rows.slice();
    expect(sortRows(rows, { column: 0, dir: "asc" }, false).map((r) => r[1])).toEqual(["b", "d", "a", "c"]);
    expect(sortRows(rows, { column: 0, dir: "desc" }, false).map((r) => r[1])).toEqual(["a", "c", "b", "d"]);
    expect(rows).toEqual(copy);
  });
});

describe("nextSort", () => {
  it("cycles ascending, descending, none, and restarts on another column", () => {
    expect(nextSort(null, 2)).toEqual({ column: 2, dir: "asc" });
    expect(nextSort({ column: 2, dir: "asc" }, 2)).toEqual({ column: 2, dir: "desc" });
    expect(nextSort({ column: 2, dir: "desc" }, 2)).toBeNull();
    expect(nextSort({ column: 2, dir: "desc" }, 0)).toEqual({ column: 0, dir: "asc" });
  });
});
