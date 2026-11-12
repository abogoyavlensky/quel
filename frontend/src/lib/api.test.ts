import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/bridge", () => bridge);

const { chooseFile, describeObject, describeSchema, exportBegin } = await import("./api");

beforeEach(() => bridge.call.mockReset());

// A canceled dialog is nil on the let-go side, which the bridge may deliver
// as {} or null; neither may pass for a path.
describe("calls that answer a string or nil", () => {
  it("returns the path", async () => {
    bridge.call.mockResolvedValue("/tmp/result.csv");
    expect(await exportBegin("csv", "result.csv")).toBe("/tmp/result.csv");
    expect(bridge.call).toHaveBeenCalledWith("export-begin", "csv", "result.csv");
    expect(await chooseFile()).toBe("/tmp/result.csv");
    expect(await chooseFile("duckdb")).toBe("/tmp/result.csv");
    expect(bridge.call).toHaveBeenLastCalledWith("choose-file", "duckdb");
  });

  it.each([{}, null, undefined, ""])("returns null for %j", async (reply) => {
    bridge.call.mockResolvedValue(reply);
    expect(await exportBegin("csv", "result.csv")).toBeNull();
    expect(await chooseFile()).toBeNull();
  });
});

// Empty lists come back from the bridge as {} or null, at any depth, and a
// nil may be missing; the structure calls turn them into [] and null.
describe("structure calls", () => {
  it("normalize an empty schema", async () => {
    for (const reply of [null, {}, { objects: {}, functions: null, types: {}, sequences: null }]) {
      bridge.call.mockResolvedValue(reply);
      expect(await describeSchema("c1", "public")).toEqual({ objects: [], functions: [], types: [], sequences: [] });
    }
    expect(bridge.call).toHaveBeenCalledWith("describe-schema", "c1", "public");
  });

  it("normalize a type's values and detail", async () => {
    bridge.call.mockResolvedValue({ types: [{ name: "pair", kind: "composite", values: {} }] });
    expect((await describeSchema("c1", "s")).types).toEqual([{ name: "pair", kind: "composite", detail: null, values: [] }]);
  });

  it("normalize an object's lists and a key's name and columns", async () => {
    bridge.call.mockResolvedValue({
      columns: [{ name: "id", type: "int", pk: true, fk: false }],
      indexes: {},
      keys: [{ kind: "check", columns: null, definition: "CHECK (true)" }],
      sequences: null,
    });
    expect(await describeObject("c1", "s", "t")).toEqual({
      columns: [{ name: "id", type: "int", pk: true, fk: false }],
      indexes: [],
      keys: [{ name: null, kind: "check", columns: [], definition: "CHECK (true)" }],
      sequences: [],
    });
    expect(bridge.call).toHaveBeenCalledWith("describe-object", "c1", "s", "t");
  });
});
