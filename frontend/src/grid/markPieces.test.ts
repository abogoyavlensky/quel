import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { markPieces } from "./markPieces";

// The pieces as text, a mark as [text].
const flat = (nodes: ReactNode[]) =>
  nodes
    .map((n) => (isValidElement(n) ? `[${(n.props as { children: string }).children}]` : String(n)))
    .join("");

describe("markPieces", () => {
  it("marks the parts of a token inside the ranges", () => {
    // The token "hello" at offset 10 of the value; matches at 9-12 and 13-14.
    expect(
      flat(
        markPieces("hello", 10, [
          [9, 12],
          [13, 14],
        ], "k"),
      ),
    ).toBe("[he]l[l]o");
  });

  it("skips ranges before the token and stops after it", () => {
    const ranges: Array<[number, number]> = Array.from({ length: 1000 }, (_, i) => [i * 2, i * 2 + 1]);
    expect(flat(markPieces("abcd", 1000, ranges, "k"))).toBe("[a]b[c]d");
    expect(flat(markPieces("xy", 5000, ranges, "k"))).toBe("xy");
  });
});
