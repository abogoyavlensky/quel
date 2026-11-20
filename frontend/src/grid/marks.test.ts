import { describe, expect, it } from "vitest";
import { matchRanges } from "./marks";

describe("matchRanges", () => {
  it("finds every match, ignoring case", () => {
    expect(matchRanges('{"Status": "active"}', "status")).toEqual([[2, 8]]);
    expect(matchRanges("a-A-a", "a")).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("does not overlap", () => {
    expect(matchRanges("aaaa", "aa")).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("finds a match at the very end", () => {
    expect(matchRanges("customer 12", "12")).toEqual([[9, 11]]);
  });

  it("finds nothing for an empty needle or no match", () => {
    expect(matchRanges("abc", "")).toEqual([]);
    expect(matchRanges("abc", "z")).toEqual([]);
  });
});
