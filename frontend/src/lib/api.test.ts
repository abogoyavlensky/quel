import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/bridge", () => bridge);

const { chooseFile, exportResult } = await import("./api");

beforeEach(() => bridge.call.mockReset());

// A canceled dialog is nil on the let-go side, which the bridge may deliver
// as {} or null; neither may pass for a path.
describe("calls that answer a path or nil", () => {
  it("returns the path", async () => {
    bridge.call.mockResolvedValue("/tmp/result.csv");
    expect(await exportResult("csv", "result.csv", "x")).toBe("/tmp/result.csv");
    expect(bridge.call).toHaveBeenCalledWith("export-result", "csv", "result.csv", "x");
    expect(await chooseFile()).toBe("/tmp/result.csv");
  });

  it.each([{}, null, undefined, ""])("returns null for %j", async (reply) => {
    bridge.call.mockResolvedValue(reply);
    expect(await exportResult("csv", "result.csv", "x")).toBeNull();
    expect(await chooseFile()).toBeNull();
  });
});
