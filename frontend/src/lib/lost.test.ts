import { describe, expect, it } from "vitest";
import { lostOf } from "./lost";

const err = (cause: unknown) => Object.assign(new Error("lost"), { cause });

describe("lostOf", () => {
  it("reads the backend's :lost", () => {
    const e = err({ "query-id": "q1", lost: { "not-run": true, reconnected: true, page: false, canceled: false, error: "broken pipe" } });
    expect(lostOf(e)).toEqual({ notRun: true, reconnected: true, page: false, canceled: false, error: "broken pipe" });
  });

  it("is null without one", () => {
    expect(lostOf(new Error("no such table"))).toBeNull();
    expect(lostOf(err({}))).toBeNull();
    expect(lostOf(err(null))).toBeNull();
    expect(lostOf("text")).toBeNull();
  });

  it("is null for a malformed one", () => {
    expect(lostOf(err({ lost: "yes" }))).toBeNull();
    expect(lostOf(err({ lost: { "not-run": true } }))).toBeNull();
  });
});
