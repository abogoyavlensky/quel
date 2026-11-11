import { describe, expect, it } from "vitest";
import { dragTarget, moveItem } from "./reorder";

describe("moveItem", () => {
  it("moves forward and backward", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns an equal list for the same index", () => {
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("clamps the target to the list's ends", () => {
    expect(moveItem(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
  });

  it("leaves the input alone", () => {
    const list = ["a", "b", "c"];
    moveItem(list, 0, 2);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("dragTarget", () => {
  // Unequal widths; centres at 20, 94 and 168.
  const spans = [
    { left: 0, right: 40 },
    { left: 44, right: 144 },
    { left: 148, right: 188 },
  ];

  it("moves right past each following tab whose centre the pointer passed", () => {
    expect(dragTarget(spans, 0, 50)).toBe(0);
    expect(dragTarget(spans, 0, 95)).toBe(1);
    expect(dragTarget(spans, 0, 170)).toBe(2);
  });

  it("moves left past each preceding tab whose centre the pointer passed", () => {
    expect(dragTarget(spans, 2, 150)).toBe(2);
    expect(dragTarget(spans, 2, 90)).toBe(1);
    expect(dragTarget(spans, 2, 10)).toBe(0);
  });

  it("does not flip back after a swap", () => {
    // Index 0 (40 wide) moved to 1: the wide tab is first now, centre 50.
    const after = [
      { left: 0, right: 100 },
      { left: 104, right: 144 },
      { left: 148, right: 188 },
    ];
    expect(dragTarget(after, 1, 95)).toBe(1);
  });
});
