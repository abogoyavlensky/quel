import { describe, expect, it } from "vitest";
import { display, isNumericType } from "./format";

describe("display", () => {
  it("shows NULL for null", () => {
    expect(display(null)).toEqual({ text: "NULL", kind: "null" });
  });

  it("shows booleans and numbers as written", () => {
    expect(display(true)).toEqual({ text: "true", kind: "bool" });
    expect(display(false)).toEqual({ text: "false", kind: "bool" });
    expect(display(42)).toEqual({ text: "42", kind: "number" });
    expect(display(-1.5)).toEqual({ text: "-1.5", kind: "number" });
  });

  it("keeps strings on one line", () => {
    expect(display("a\nb\r\nc")).toEqual({ text: "a↵b↵c", kind: "text" });
  });

  it("cuts very long strings, which the cell shows truncated anyway", () => {
    const { text } = display("x".repeat(5000));
    expect(text.length).toBeLessThanOrEqual(1001);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("isNumericType", () => {
  it.each(["INT4", "INT8", "INTEGER", "NUMERIC", "FLOAT8", "REAL", "DECIMAL(10,2)", "BIGINT", "DOUBLE"])(
    "%s is numeric",
    (t) => expect(isNumericType(t)).toBe(true),
  );
  it.each(["TEXT", "VARCHAR", "INTERVAL", "POINT", "", "_INT4"])("%s is not", (t) =>
    expect(isNumericType(t)).toBe(false),
  );
});
