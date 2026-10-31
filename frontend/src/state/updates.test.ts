import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateCheck } from "@/lib/types";

const api = vi.hoisted(() => ({
  checkUpdate: vi.fn(),
  skipUpdate: vi.fn(),
  downloadUpdate: vi.fn(),
  restartToUpdate: vi.fn(),
}));
vi.mock("@/lib/api", () => api);
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const flushAllAndWait = vi.hoisted(() => vi.fn());
vi.mock("./persist", () => ({ flushAllAndWait }));
// The progress listener: tests call emit to send an event.
const listeners = vi.hoisted(() => new Map<string, (d: unknown) => void>());
vi.mock("@/lib/bridge", () => ({
  onEvent: (name: string, fn: (d: unknown) => void) => {
    listeners.set(name, fn);
    return () => listeners.delete(name);
  },
}));

const { store, initialState } = await import("./store");
const updates = await import("./updates");

const release = { version: "0.3.0", name: "Quel 0.3.0", url: "https://x/v0.3.0", "published-at": "", size: 100 };
const check = (over: Partial<UpdateCheck> = {}): UpdateCheck => ({
  current: "0.2.0",
  enabled: true,
  "can-install": true,
  reason: null,
  release,
  skipped: false,
  ...over,
});
const update = () => store.getState().update;

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

beforeEach(() => {
  for (const f of [...Object.values(api), toast, toast.error, flushAllAndWait]) f.mockReset();
  flushAllAndWait.mockResolvedValue(null);
  listeners.clear();
  store.setState(initialState(), true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("checks", () => {
  it("an automatic check that finds a release makes it available, quietly", async () => {
    api.checkUpdate.mockResolvedValue(check());
    await updates.checkForUpdates();
    expect(update()).toEqual({ phase: "available", info: check() });
    expect(store.getState().updateDialogOpen).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it("an automatic check hides a skipped release", async () => {
    api.checkUpdate.mockResolvedValue(check({ skipped: true }));
    await updates.checkForUpdates();
    expect(update()).toEqual({ phase: "idle" });
  });

  it("a manual check shows a skipped release, dialog open", async () => {
    api.checkUpdate.mockResolvedValue(check({ skipped: true }));
    await updates.checkForUpdates({ manual: true });
    expect(update().phase).toBe("available");
    expect(store.getState().updateDialogOpen).toBe(true);
  });

  it("a manual check while up to date says so", async () => {
    api.checkUpdate.mockResolvedValue(check({ release: null }));
    await updates.checkForUpdates({ manual: true });
    expect(update()).toEqual({ phase: "idle" });
    expect(toast).toHaveBeenCalledWith("Quel 0.2.0 is the latest version.", expect.anything());
  });

  it("a nil release lowered to {} counts as up to date", async () => {
    api.checkUpdate.mockResolvedValue(check({ release: {} as never }));
    await updates.checkForUpdates();
    expect(update()).toEqual({ phase: "idle" });
  });

  it("checks off: a manual check says so", async () => {
    api.checkUpdate.mockResolvedValue({ current: "0.2.0", enabled: false });
    await updates.checkForUpdates({ manual: true });
    expect(toast).toHaveBeenCalledWith("Update checks are off.", expect.anything());
  });

  it("a failed automatic check stays quiet; a manual one toasts", async () => {
    api.checkUpdate.mockRejectedValue(new Error("offline"));
    await updates.checkForUpdates();
    expect(update()).toEqual({ phase: "idle" });
    expect(toast.error).not.toHaveBeenCalled();
    await updates.checkForUpdates({ manual: true });
    expect(toast.error).toHaveBeenCalledWith("Could not check for updates: offline", expect.anything());
  });

  it("a check leaves a download alone", async () => {
    store.setState({ update: { phase: "downloading", info: check() as never, written: 5, total: 100 } });
    api.checkUpdate.mockResolvedValue(check({ release: null }));
    await updates.checkForUpdates();
    expect(api.checkUpdate).not.toHaveBeenCalled();
    expect(update().phase).toBe("downloading");
  });

  it("checks 10 s after start, then every 6 hours", async () => {
    vi.useFakeTimers();
    api.checkUpdate.mockResolvedValue(check({ release: null }));
    const stop = updates.startUpdateChecks();
    await vi.advanceTimersByTimeAsync(updates.FIRST_CHECK_MS - 1);
    expect(api.checkUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.checkUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(updates.CHECK_EVERY_MS);
    expect(api.checkUpdate).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(updates.CHECK_EVERY_MS);
    expect(api.checkUpdate).toHaveBeenCalledTimes(2);
  });
});

describe("skip, download, restart", () => {
  beforeEach(async () => {
    api.checkUpdate.mockResolvedValue(check());
    await updates.checkForUpdates();
  });

  it("skip goes idle and remembers the version", async () => {
    store.setState({ updateDialogOpen: true });
    await updates.skipVersion();
    expect(update()).toEqual({ phase: "idle" });
    expect(store.getState().updateDialogOpen).toBe(false);
    expect(api.skipUpdate).toHaveBeenCalledWith("0.3.0");
  });

  it("a download reports progress, then is ready", async () => {
    const d = deferred<void>();
    api.downloadUpdate.mockReturnValue(d.promise);
    const done = updates.startDownload();
    expect(update()).toMatchObject({ phase: "downloading", written: 0, total: 100 });
    listeners.get(updates.PROGRESS_EVENT)!({ written: 40, total: 200 });
    expect(update()).toMatchObject({ phase: "downloading", written: 40, total: 200 });
    d.resolve();
    await done;
    expect(update().phase).toBe("ready");
    expect(listeners.has(updates.PROGRESS_EVENT)).toBe(false);
  });

  it("a failed download is an error, and can be tried again", async () => {
    api.downloadUpdate.mockRejectedValueOnce(new Error("signer mismatch"));
    await updates.startDownload();
    expect(update()).toMatchObject({ phase: "error", message: "signer mismatch" });
    api.downloadUpdate.mockResolvedValueOnce(undefined);
    await updates.startDownload();
    expect(update().phase).toBe("ready");
  });

  it("restart saves the tabs first", async () => {
    api.downloadUpdate.mockResolvedValue(undefined);
    await updates.startDownload();
    const order: string[] = [];
    flushAllAndWait.mockImplementation(async () => {
      order.push("flush");
      return null;
    });
    api.restartToUpdate.mockImplementation(async () => {
      order.push("restart");
    });
    await updates.restartNow();
    expect(order).toEqual(["flush", "restart"]);
    expect(update().phase).toBe("restarting");
  });

  it("a failed save stops the restart; force restarts anyway", async () => {
    api.downloadUpdate.mockResolvedValue(undefined);
    await updates.startDownload();
    flushAllAndWait.mockResolvedValue("disk full");
    await updates.restartNow();
    expect(update()).toMatchObject({ phase: "ready", saveError: "disk full" });
    expect(api.restartToUpdate).not.toHaveBeenCalled();
    await updates.restartNow({ force: true });
    expect(api.restartToUpdate).toHaveBeenCalledTimes(1);
  });
});
