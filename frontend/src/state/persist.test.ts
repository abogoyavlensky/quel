import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInput } from "@/lib/types";

const api = vi.hoisted(() => ({ saveWorkspace: vi.fn() }));
vi.mock("@/lib/api", () => api);

const texts = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock("@/editor/states", () => ({
  currentInput: (id: string) => ({ text: texts[id] ?? "", selection: { from: 1, to: 2 } }),
}));

const { store, initialState, newWorkspace, updateWorkspace } = await import("./store");
const persist = await import("./persist");

// A promise and the fns that settle it, to hold a call open.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ws = () => store.getState().workspaces.p1;
const sent = (i: number) => api.saveWorkspace.mock.calls[i][1] as WorkspaceInput;

beforeEach(() => {
  vi.useFakeTimers();
  api.saveWorkspace.mockReset();
  api.saveWorkspace.mockResolvedValue(undefined);
  for (const k of Object.keys(texts)) delete texts[k];
  store.setState({ ...initialState(), selected: "p1", workspaces: { p1: newWorkspace("p1") } }, true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("persist", () => {
  it("saves once, 800 ms after the last change", async () => {
    persist.scheduleSave("p1");
    await vi.advanceTimersByTimeAsync(500);
    persist.scheduleSave("p1");
    await vi.advanceTimersByTimeAsync(500);
    expect(api.saveWorkspace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(api.saveWorkspace).toHaveBeenCalledTimes(1);
    const tab = ws().tabs[0];
    texts[tab.id] = "select 1";
    expect(persist.snapshot(ws())).toEqual({
      tabs: [{ id: tab.id, title: "Query 1", body: "select 1", pinned: false, "sel-from": 1, "sel-to": 2 }],
      "active-tab": tab.id,
      "next-tab-number": 2,
    });
  });

  it("an edit schedules its workspace's save", async () => {
    persist.onEdit(ws().tabs[0].id);
    persist.onEdit("unknown");
    await vi.advanceTimersByTimeAsync(800);
    expect(api.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(api.saveWorkspace.mock.calls[0][0]).toBe("p1");
  });

  it("runs one operation at a time, in order", async () => {
    const order: string[] = [];
    const first = deferred<void>();
    const a = persist.enqueue("p1", async () => {
      order.push("a start");
      await first.promise;
      order.push("a end");
    });
    const b = persist.enqueue("p1", async () => void order.push("b"));
    // Another profile's queue does not wait.
    const c = persist.enqueue("p2", async () => void order.push("c"));
    await c;
    expect(order).toEqual(["a start", "c"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["a start", "c", "a end", "b"]);
  });

  it("a failed operation does not stop the queue", async () => {
    const failing = persist.enqueue("p1", async () => {
      throw new Error("boom");
    });
    const next = persist.enqueue("p1", async () => "ran");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ran");
  });

  it("a queued save sends the tabs as they are when it runs", async () => {
    const held = deferred<void>();
    void persist.enqueue("p1", () => held.promise);
    persist.scheduleSave("p1");
    await vi.advanceTimersByTimeAsync(800);
    updateWorkspace("p1", (w) => ({ ...w, nextTabNumber: 9 }));
    held.resolve();
    await vi.runAllTimersAsync();
    expect(api.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(sent(0)["next-tab-number"]).toBe(9);
  });

  it("flushing saves at once; with nothing pending it does nothing", async () => {
    persist.flushAll();
    persist.scheduleSave("p1");
    persist.flushAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.saveWorkspace).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it("a cancelled save never runs", async () => {
    persist.scheduleSave("p1");
    persist.cancelSave("p1");
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveWorkspace).not.toHaveBeenCalled();
  });

  it("never saves a workspace whose load failed", async () => {
    updateWorkspace("p1", (w) => ({ ...w, loadError: "disk I/O error" }));
    persist.scheduleSave("p1");
    persist.flushAll();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveWorkspace).not.toHaveBeenCalled();
  });

  it("a failed save says so, and the next good one clears it", async () => {
    api.saveWorkspace.mockRejectedValueOnce(new Error("database is locked"));
    persist.scheduleSave("p1");
    await vi.advanceTimersByTimeAsync(800);
    expect(store.getState().notice).toBe("Could not save tabs: database is locked");
    persist.scheduleSave("p1");
    await vi.advanceTimersByTimeAsync(800);
    expect(api.saveWorkspace).toHaveBeenCalledTimes(2);
    expect(store.getState().notice).toBeNull();
  });
});
