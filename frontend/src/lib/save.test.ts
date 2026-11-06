import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  exportBegin: vi.fn(),
  exportAppend: vi.fn(),
  exportFinish: vi.fn(),
  exportAbort: vi.fn(),
}));
vi.mock("@/lib/api", () => api);

const { saveChunks } = await import("./save");

const chunks = [
  { text: "a", rows: 1 },
  { text: "b", rows: 2 },
];
const save = (
  onRows: (rows: number) => void = () => {},
  from: Iterable<(typeof chunks)[0]> = chunks,
  signal = new AbortController().signal,
) => saveChunks("result.csv", "csv", from, onRows, signal);

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  // What the runtime checks for to know it is in the app's webview.
  vi.stubGlobal("window", { webkit: { messageHandlers: { external: { postMessage() {} } } } });
  api.exportBegin.mockResolvedValue("id-1");
  api.exportAppend.mockResolvedValue(undefined);
  api.exportFinish.mockResolvedValue("/tmp/result.csv");
  api.exportAbort.mockResolvedValue(undefined);
});

describe("saveChunks in the app's webview", () => {
  it("sends each chunk in order and answers the path", async () => {
    const seen: number[] = [];
    expect(await save((n) => seen.push(n))).toBe("/tmp/result.csv");
    expect(api.exportBegin).toHaveBeenCalledWith("csv", "result.csv");
    expect(api.exportAppend.mock.calls).toEqual([
      ["id-1", "a"],
      ["id-1", "b"],
    ]);
    expect(api.exportFinish).toHaveBeenCalledWith("id-1");
    expect(api.exportAbort).not.toHaveBeenCalled();
    expect(seen).toEqual([0, 1, 2]);
  });

  it("reads and reports nothing when the dialog is canceled", async () => {
    api.exportBegin.mockResolvedValue(null);
    const onRows = vi.fn();
    let read = false;
    const lazy = (function* () {
      read = true;
      yield* chunks;
    })();
    expect(await save(onRows, lazy)).toBeNull();
    expect(read).toBe(false);
    expect(onRows).not.toHaveBeenCalled();
    expect(api.exportAppend).not.toHaveBeenCalled();
    expect(api.exportFinish).not.toHaveBeenCalled();
    expect(api.exportAbort).not.toHaveBeenCalled();
  });

  it("drops the export when a write fails", async () => {
    api.exportAppend.mockRejectedValueOnce(new Error("disk full"));
    await expect(save()).rejects.toThrow("disk full");
    expect(api.exportAbort).toHaveBeenCalledWith("id-1");
    expect(api.exportAppend).toHaveBeenCalledTimes(1);
    expect(api.exportFinish).not.toHaveBeenCalled();
  });

  it("keeps the first error when dropping the export fails too", async () => {
    api.exportAppend.mockRejectedValueOnce(new Error("disk full"));
    api.exportAbort.mockRejectedValue(new Error("gone"));
    await expect(save()).rejects.toThrow("disk full");
  });

  it("drops the export when canceled, and sends nothing more", async () => {
    const controller = new AbortController();
    const onRows = (n: number) => {
      if (n === 1) controller.abort();
    };
    expect(await save(onRows, chunks, controller.signal)).toBeNull();
    expect(api.exportAppend).toHaveBeenCalledTimes(1);
    expect(api.exportAbort).toHaveBeenCalledWith("id-1");
    expect(api.exportFinish).not.toHaveBeenCalled();
  });

  it("drops the export when canceled after the last chunk", async () => {
    const controller = new AbortController();
    const onRows = (n: number) => {
      if (n === 2) controller.abort();
    };
    expect(await save(onRows, chunks, controller.signal)).toBeNull();
    expect(api.exportAbort).toHaveBeenCalledWith("id-1");
    expect(api.exportFinish).not.toHaveBeenCalled();
  });

  it("drops the export when finishing fails", async () => {
    api.exportFinish.mockRejectedValue(new Error("rename failed"));
    await expect(save()).rejects.toThrow("rename failed");
    expect(api.exportAbort).toHaveBeenCalledWith("id-1");
  });
});
