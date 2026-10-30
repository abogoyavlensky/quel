import { describe, expect, it } from "vitest";
import { CHAR_W, MAX_W, MIN_W, PAD, initialWidths, numberWidth } from "./widths";

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

describe("numberWidth", () => {
  const w = (digits: number) => Math.ceil(digits * CHAR_W + 17);

  it("fits a small single-page result's own count, at least 2 digits", () => {
    expect(numberWidth(12, false)).toBe(w(2));
    expect(numberWidth(7, false)).toBe(w(2));
    expect(numberWidth(212, false)).toBe(w(3));
  });

  it("leaves room for 4 digits once a result is a full page or may be paged", () => {
    expect(numberWidth(500, false)).toBe(w(4));
    expect(numberWidth(12, true)).toBe(w(4));
  });

  it("grows with the digits past that", () => {
    expect(numberWidth(2000, false)).toBe(w(4));
    expect(numberWidth(100000, false)).toBe(w(6));
  });

  it("is 32px for 12 rows and 47px for 2,000", () => {
    expect(numberWidth(12, false)).toBe(35);
    expect(numberWidth(2000, false)).toBe(52);
  });
});
