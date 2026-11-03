import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { notify } = await import("./notify");

beforeEach(() => {
  for (const f of [toast, toast.success, toast.error, toast.dismiss]) f.mockReset();
});

describe("notify", () => {
  it("shows a success, an error and a plain notice with their options", () => {
    const action = { label: "Connect", onClick: () => {} };
    notify.success("Saved");
    notify.error("Failed", { id: "x", action });
    notify.info("FYI", { id: "y" });
    expect(toast.success).toHaveBeenCalledWith("Saved", undefined);
    expect(toast.error).toHaveBeenCalledWith("Failed", { id: "x", action });
    expect(toast).toHaveBeenCalledWith("FYI", { id: "y" });
  });

  it("passes a duration through", () => {
    notify.error("Stuck", { id: "z", duration: Infinity });
    expect(toast.error).toHaveBeenCalledWith("Stuck", { id: "z", duration: Infinity });
  });

  it("dismisses one notice by id, or all of them", () => {
    notify.dismiss("x");
    notify.dismiss();
    expect(toast.dismiss).toHaveBeenNthCalledWith(1, "x");
    expect(toast.dismiss).toHaveBeenNthCalledWith(2, undefined);
  });
});
