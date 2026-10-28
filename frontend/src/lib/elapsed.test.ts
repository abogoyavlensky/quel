import { describe, expect, it } from "vitest";
import { formatElapsed } from "./elapsed";

describe("formatElapsed", () => {
  it("shows nothing under a second", () => {
    expect(formatElapsed(0)).toBe("");
    expect(formatElapsed(999)).toBe("");
  });

  it("counts whole seconds, then minutes, then hours", () => {
    expect(formatElapsed(1000)).toBe("1s");
    expect(formatElapsed(59_999)).toBe("59s");
    expect(formatElapsed(60_000)).toBe("1m 00s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
    expect(formatElapsed(3_599_000)).toBe("59m 59s");
    expect(formatElapsed(3_720_000)).toBe("1h 02m");
  });
});
