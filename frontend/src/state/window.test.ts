import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ zoom: vi.fn(), restoreZoom: vi.fn(), saveWindowState: vi.fn() }));
vi.mock("@/lib/api", () => api);

import { WINDOW_STATE_DELAY_MS, loadZoom, stepZoom, watchWindowState } from "./window";

// The tests run under Node: the two globals the module touches.
const style = new Map<string, string>();
const zoomVar = () => style.get("--zoom") ?? "";
const fakeWindow = new EventTarget();
// Long enough for the chain's promises to settle.
const settled = () => new Promise((r) => setTimeout(r));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  style.clear();
  vi.stubGlobal("document", {
    documentElement: { style: { setProperty: (k: string, v: string) => style.set(k, v) } },
  });
  vi.stubGlobal("window", fakeWindow);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("zoom", () => {
  it("sets --zoom from the reply", async () => {
    api.zoom.mockResolvedValue(1.25);
    stepZoom("in");
    await settled();
    expect(api.zoom).toHaveBeenCalledWith("in");
    expect(zoomVar()).toBe("1.25");
  });

  it("runs quick steps one after the other", async () => {
    const first = deferred<number>();
    api.zoom.mockReturnValueOnce(first.promise).mockResolvedValueOnce(1.25);
    stepZoom("in");
    stepZoom("in");
    await settled();
    expect(api.zoom).toHaveBeenCalledTimes(1);
    first.resolve(1.1);
    await settled();
    expect(api.zoom).toHaveBeenCalledTimes(2);
    expect(zoomVar()).toBe("1.25");
  });

  it("drops a failed step and still runs the next", async () => {
    api.zoom.mockRejectedValueOnce(new Error("no")).mockResolvedValueOnce(1.1);
    stepZoom("in");
    stepZoom("in");
    await settled();
    expect(api.zoom).toHaveBeenCalledTimes(2);
    expect(zoomVar()).toBe("1.1");
  });

  it("restores the saved level", async () => {
    api.restoreZoom.mockResolvedValue(1.5);
    await loadZoom();
    expect(zoomVar()).toBe("1.5");
  });

  it("drops a failed restore", async () => {
    api.restoreZoom.mockRejectedValue(new Error("no"));
    await expect(loadZoom()).resolves.toBeUndefined();
    expect(zoomVar()).toBe("");
  });

  it("runs a step made during the restore after it", async () => {
    const restore = deferred<number>();
    api.restoreZoom.mockReturnValue(restore.promise);
    api.zoom.mockResolvedValue(1.25);
    void loadZoom();
    stepZoom("in");
    await settled();
    expect(api.zoom).not.toHaveBeenCalled();
    restore.resolve(1.1);
    await settled();
    expect(zoomVar()).toBe("1.25");
  });
});

describe("watchWindowState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.saveWindowState.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const resize = () => fakeWindow.dispatchEvent(new Event("resize"));

  it("saves once, after the last resize", () => {
    const stop = watchWindowState();
    resize();
    vi.advanceTimersByTime(WINDOW_STATE_DELAY_MS - 1);
    resize();
    vi.advanceTimersByTime(WINDOW_STATE_DELAY_MS - 1);
    expect(api.saveWindowState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(api.saveWindowState).toHaveBeenCalledTimes(1);
    stop();
  });

  it("drops a failed save", async () => {
    api.saveWindowState.mockRejectedValue(new Error("no"));
    const stop = watchWindowState();
    resize();
    vi.advanceTimersByTime(WINDOW_STATE_DELAY_MS);
    await Promise.resolve();
    expect(api.saveWindowState).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops on its remover, a pending save included", () => {
    const stop = watchWindowState();
    resize();
    stop();
    resize();
    vi.advanceTimersByTime(WINDOW_STATE_DELAY_MS * 2);
    expect(api.saveWindowState).not.toHaveBeenCalled();
  });
});
