import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/bridge", () => bridge);

const { chooseFile, describeObject, describeSchema, exportBegin, listSchemas, setQuelQueriesSink } = await import("./api");

// Braces: a function returned from beforeEach is a teardown, and
// mockReset returns the mock, which vitest would then call after the test.
beforeEach(() => {
  bridge.call.mockReset();
});

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

// The structure calls reply {result, queries}. Empty lists come back from
// the bridge as {} or null, at any depth, and a nil may be missing; the
// structure calls turn them into [] and null.
const reply = (result: unknown) => ({ result, queries: [] });
describe("structure calls", () => {
  it("normalize an empty schema", async () => {
    for (const reply of [null, {}, { objects: {}, functions: null, types: {}, sequences: null }]) {
      bridge.call.mockResolvedValue({ result: reply, queries: [] });
      expect(await describeSchema("c1", "public")).toEqual({ objects: [], functions: [], types: [], sequences: [] });
    }
    expect(bridge.call).toHaveBeenCalledWith("describe-schema", "c1", "public");
  });

  it("normalize a type's values and detail", async () => {
    bridge.call.mockResolvedValue(reply({ types: [{ name: "pair", kind: "composite", values: {} }] }));
    expect((await describeSchema("c1", "s")).types).toEqual([{ name: "pair", kind: "composite", detail: null, values: [] }]);
  });

  it("normalize an object's lists and a key's name and columns", async () => {
    bridge.call.mockResolvedValue(
      reply({
        columns: [{ name: "id", type: "int", pk: true, fk: false }],
        indexes: {},
        keys: [{ kind: "check", columns: null, definition: "CHECK (true)" }],
        sequences: null,
      }),
    );
    expect(await describeObject("c1", "s", "t")).toEqual({
      columns: [{ name: "id", type: "int", pk: true, fk: false }],
      indexes: [],
      keys: [{ name: null, kind: "check", columns: [], definition: "CHECK (true)" }],
      sequences: [],
    });
    expect(bridge.call).toHaveBeenCalledWith("describe-object", "c1", "s", "t");
  });
});

// The SQL Quel ran for a structure call goes to the sink, on success and
// on failure; the call still resolves or rejects as before.
describe("Quel's queries", () => {
  const queries = [{ sql: "select 1", params: [], ms: 1, rows: 1 }];

  it("go to the sink with the call's conn-id", async () => {
    const sink = vi.fn();
    setQuelQueriesSink(sink);
    bridge.call.mockResolvedValue({ result: { objects: [] }, queries });
    expect((await describeSchema("c1", "s")).objects).toEqual([]);
    expect(sink).toHaveBeenCalledWith("c1", queries);
    setQuelQueriesSink(null);
  });

  it("ride on a failure's cause, and the failure still rejects", async () => {
    const sink = vi.fn();
    setQuelQueriesSink(sink);
    const err = Object.assign(new Error("no such table"), { cause: { queries } });
    bridge.call.mockRejectedValue(err);
    await expect(describeObject("c2", "s", "t")).rejects.toThrow("no such table");
    expect(sink).toHaveBeenCalledWith("c2", queries);
    setQuelQueriesSink(null);
  });

  it("need no sink", async () => {
    bridge.call.mockResolvedValue({ result: [], queries });
    expect(await listSchemas("c1")).toEqual([]);
  });
});
