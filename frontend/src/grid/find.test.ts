import { describe, expect, it } from "vitest";
import type { Cell } from "@/lib/types";
import { cellMatcher, countCellMatches, stepMatch } from "./find";

const q = (search: string, o: Partial<{ caseSensitive: boolean; wholeWord: boolean; regexp: boolean }> = {}) => ({
  search,
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
  ...o,
});
const test = (search: string, o = {}) => cellMatcher(q(search, o)).test!;

describe("cellMatcher", () => {
  it("has no test for an empty query, and is invalid for a bad regexp", () => {
    expect(cellMatcher(q(""))).toEqual({ valid: true, test: null });
    expect(cellMatcher(q("(", { regexp: true }))).toEqual({ valid: false, test: null });
    expect(cellMatcher(q("(")).valid).toBe(true);
  });

  it("searches literally unless regexp is on", () => {
    expect(test("a.b")("axb")).toBe(false);
    expect(test("a.b")("a.b")).toBe(true);
    expect(test("a.b", { regexp: true })("axb")).toBe(true);
  });

  it("ignores case unless Match case is on", () => {
    expect(test("abc")("xABCx")).toBe(true);
    expect(test("abc", { caseSensitive: true })("xABCx")).toBe(false);
  });

  it("matches whole words only when asked", () => {
    expect(test("id", { wholeWord: true })("the id")).toBe(true);
    expect(test("id", { wholeWord: true })("idle")).toBe(false);
  });

  it("never matches NULL, and matches numbers and booleans as text", () => {
    expect(test("null")(null)).toBe(false);
    expect(test("42")(42)).toBe(true);
    expect(test("true")(true)).toBe(true);
  });

  it("searches every line of a value", () => {
    expect(test("second")("first\nsecond")).toBe(true);
  });

  it("gives the same answer every time", () => {
    const t = test("a");
    expect([t("a"), t("a"), t("a")]).toEqual([true, true, true]);
  });
});

const rows: Cell[][] = [
  ["a", "b"],
  ["x", "a"],
  ["a", null],
];
const isA = (c: Cell) => c === "a";

describe("countCellMatches", () => {
  it("counts matches and finds the current one", () => {
    expect(countCellMatches(rows, isA, null)).toEqual({ total: 3, current: null, capped: false });
    expect(countCellMatches(rows, isA, { row: 1, col: 1 })).toEqual({ total: 3, current: 2, capped: false });
    expect(countCellMatches(rows, isA, { row: 0, col: 1 }).current).toBeNull();
  });

  it("stops at the cap", () => {
    expect(countCellMatches(rows, isA, null, 2)).toEqual({ total: 2, current: null, capped: true });
  });
});

describe("stepMatch", () => {
  it("goes forward and back in row-major order, wrapping", () => {
    expect(stepMatch(rows, null, 1, isA)).toEqual({ row: 0, col: 0 });
    expect(stepMatch(rows, { row: 0, col: 0 }, 1, isA)).toEqual({ row: 1, col: 1 });
    expect(stepMatch(rows, { row: 2, col: 0 }, 1, isA)).toEqual({ row: 0, col: 0 });
    expect(stepMatch(rows, null, -1, isA)).toEqual({ row: 2, col: 0 });
    expect(stepMatch(rows, { row: 0, col: 0 }, -1, isA)).toEqual({ row: 2, col: 0 });
    expect(stepMatch(rows, { row: 1, col: 1 }, -1, isA)).toEqual({ row: 0, col: 0 });
  });

  it("starts before or after a row's cells", () => {
    expect(stepMatch(rows, { row: 1, col: -1 }, 1, isA)).toEqual({ row: 1, col: 1 });
    expect(stepMatch(rows, { row: 1, col: 2 }, -1, isA)).toEqual({ row: 1, col: 1 });
  });

  it("comes back to a lone match", () => {
    const one: Cell[][] = [["a"], ["b"]];
    expect(stepMatch(one, { row: 0, col: 0 }, 1, isA)).toEqual({ row: 0, col: 0 });
  });

  it("is null when nothing matches", () => {
    expect(stepMatch(rows, null, 1, () => false)).toBeNull();
    expect(stepMatch([], null, 1, isA)).toBeNull();
    expect(stepMatch([[], []], null, 1, isA)).toBeNull();
  });
});
