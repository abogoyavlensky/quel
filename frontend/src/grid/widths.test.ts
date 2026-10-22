import { describe, expect, it } from "vitest";
import { CHAR_W, MAX_W, MIN_W, PAD, initialWidths } from "./widths";

describe("initialWidths", () => {
  it("fits the header when there are no rows", () => {
    expect(initialWidths([{ name: "customer_name", type: "TEXT" }], [])).toEqual([
      Math.ceil(15 * CHAR_W + PAD),
    ]);
  });

  it("fits the widest value in the sample", () => {
    const w = initialWidths([{ name: "id", type: "INT4" }], [["a".repeat(20)], ["b"]]);
    expect(w).toEqual([Math.ceil(20 * CHAR_W + PAD)]);
  });

  it("leaves room for the column's type", () => {
    expect(initialWidths([{ name: "id", type: "TIMESTAMPTZ" }], [])).toEqual([Math.ceil(10 * CHAR_W + PAD)]);
  });

  it("clamps to a minimum and a maximum", () => {
    const w = initialWidths(
      [
        { name: "x", type: "" },
        { name: "y", type: "" },
      ],
      [[null, "z".repeat(500)]],
    );
    expect(w).toEqual([MIN_W, MAX_W]);
  });
});
