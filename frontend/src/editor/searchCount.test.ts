import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { countLabel, countMatches } from "./searchCount";

const doc = "select 1;\nselect 2;\nselect 3;";
const stateAt = (from = 0, to = from, text = doc) =>
  EditorState.create({ doc: text, selection: EditorSelection.single(from, to) });
const q = (search: string, more: Partial<ConstructorParameters<typeof SearchQuery>[0]> = {}) =>
  new SearchQuery({ search, ...more });

describe("countMatches", () => {
  it("counts matches with the selection on none", () => {
    const c = countMatches(stateAt(3), q("select"));
    expect(c).toEqual({ total: 3, current: null, capped: false });
    expect(countLabel(q("select"), c)).toBe("3 matches");
  });

  it("knows which match the selection is on", () => {
    const c = countMatches(stateAt(10, 16), q("select"));
    expect(c).toEqual({ total: 3, current: 2, capped: false });
    expect(countLabel(q("select"), c)).toBe("2 of 3");
  });

  it("says 1 match", () => {
    expect(countLabel(q("2"), countMatches(stateAt(), q("2")))).toBe("1 match");
  });

  it("says No results for a query that matches nothing", () => {
    expect(countLabel(q("zzz"), countMatches(stateAt(), q("zzz")))).toBe("No results");
  });

  it("says nothing for an empty query", () => {
    expect(countLabel(q(""), countMatches(stateAt(), q("")))).toBe("");
  });

  it("counts nothing for an invalid regexp", () => {
    const bad = q("(", { regexp: true });
    const c = countMatches(stateAt(), bad);
    expect(c).toEqual({ total: 0, current: null, capped: false });
    expect(countLabel(bad, c)).toBe("");
  });

  it("stops at the cap", () => {
    const c = countMatches(stateAt(3), q("select"), 2);
    expect(c).toEqual({ total: 2, current: null, capped: true });
    expect(countLabel(q("select"), c)).toBe("2+ matches");
    expect(countLabel(q("select"), countMatches(stateAt(0, 6), q("select"), 2))).toBe("1 of 2+");
  });

  it("respects case sensitivity and whole words", () => {
    const text = "Select selected select";
    expect(countMatches(stateAt(0, 0, text), q("select", { caseSensitive: true })).total).toBe(2);
    expect(countMatches(stateAt(0, 0, text), q("select", { wholeWord: true })).total).toBe(2);
  });
});
