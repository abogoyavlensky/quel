import { beforeEach, describe, expect, it, vi } from "vitest";

const byName = vi.fn();
const on = vi.fn();

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: (...args: unknown[]) => byName(...args) },
  Events: { On: (...args: unknown[]) => on(...args) },
}));

const { BRIDGE, call, onEvent } = await import("./bridge");

describe("bridge", () => {
  beforeEach(() => {
    byName.mockReset();
    on.mockReset();
  });

  it("calls the bridge method with the handler name and its args", async () => {
    byName.mockResolvedValue({ ok: true });
    await expect(call("run", "c", "q", "select 1")).resolves.toEqual({ ok: true });
    expect(byName).toHaveBeenCalledWith(BRIDGE, "run", ["c", "q", "select 1"]);
  });

  it("passes the event's data to the listener and returns the unsubscribe fn", () => {
    const off = () => {};
    on.mockReturnValue(off);
    const fn = vi.fn();
    expect(onEvent("menu:run", fn)).toBe(off);
    const [name, callback] = on.mock.calls[0];
    expect(name).toBe("menu:run");
    callback({ name: "menu:run", data: { path: "/x.db" } });
    expect(fn).toHaveBeenCalledWith({ path: "/x.db" });
  });
});
