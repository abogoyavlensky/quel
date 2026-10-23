import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchResult, RunResult } from "@/lib/types";

const api = vi.hoisted(() => ({
  connect: vi.fn(),
  closeDb: vi.fn(),
  run: vi.fn(),
  fetchPage: vi.fn(),
  cancel: vi.fn(),
  closeResult: vi.fn(),
  closeSession: vi.fn(),
}));
vi.mock("@/lib/api", () => api);

const editor = vi.hoisted(() => ({
  input: { text: "", selection: { from: 0, to: 0 } },
  dropped: [] as string[],
}));
vi.mock("@/editor/states", () => ({
  currentInput: () => editor.input,
  dropState: (id: string) => editor.dropped.push(id),
}));

const { store, initialState, newWorkspace, activeTabOf, MESSAGES } = await import("./store");
const runner = await import("./runner");
const { split } = await import("@/sql/split");

const rows = (n: number, start = 1) => Array.from({ length: n }, (_, i) => [start + i]);
const rowsResult = (n: number, hasMore: boolean): RunResult => ({
  columns: [{ name: "id", type: "INT4" }],
  rows: rows(n),
  "has-more": hasMore,
  "update-count": null,
  "elapsed-ms": 5,
});
const update = (count: number): RunResult => ({
  columns: [],
  rows: [],
  "has-more": false,
  "update-count": count,
  "elapsed-ms": 3,
});
const page = (n: number, hasMore: boolean, closed = false): FetchResult => ({
  rows: rows(n, 1000),
  "has-more": hasMore,
  closed,
});

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

const ws = (id = "p1") => store.getState().workspaces[id];
const tab = (id = "p1") => activeTabOf(ws(id));
const tabId = (id = "p1") => ws(id).activeTab;
const stmts = (sql: string) => split(sql);

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.closeResult.mockResolvedValue(undefined);
  api.closeSession.mockResolvedValue(undefined);
  api.closeDb.mockResolvedValue(undefined);
  api.cancel.mockResolvedValue({ canceled: true });
  editor.dropped = [];
  // Two profiles, both connected; p1 is the one on screen.
  store.setState(
    {
      ...initialState(),
      selected: "p1",
      workspaces: {
        p1: { ...newWorkspace("p1"), status: "connected", connId: "c1" },
        p2: { ...newWorkspace("p2"), status: "connected", connId: "c2" },
      },
    },
    true,
  );
});

describe("runStatements", () => {
  it("makes one active result tab for a select", async () => {
    api.run.mockResolvedValue(rowsResult(500, true));
    await runner.runStatements(tabId(), stmts("select 1"));
    const t = tab();
    expect(t.results).toHaveLength(1);
    expect(t.results[0].cursor).toBe("open");
    expect(t.results[0].rows).toHaveLength(500);
    expect(t.active).toBe(t.results[0].id);
    expect(t.runningQueryId).toBeNull();
    expect(api.run).toHaveBeenCalledWith("c1", tabId(), t.results[0].id, "select 1");
    expect(t.messages[0]).toMatchObject({ kind: "rows", sql: "select 1" });
  });

  it("gives each row-returning statement of a script its own tab", async () => {
    api.run
      .mockResolvedValueOnce(rowsResult(2, false))
      .mockResolvedValueOnce(update(3))
      .mockResolvedValueOnce(rowsResult(1, false));
    await runner.runStatements(tabId(), stmts("select 1; update t set x = 1; select 2"));
    const t = tab();
    expect(t.results).toHaveLength(2);
    expect(t.results.map((r) => r.cursor)).toEqual(["done", "done"]);
    expect(t.messages.map((m) => m.kind)).toEqual(["rows", "update", "rows"]);
    expect(t.messages[1].text).toBe("3 rows affected");
    expect(t.active).toBe(t.results[1].id);
  });

  it("shows messages for a run with no rows", async () => {
    api.run.mockResolvedValue(update(1));
    await runner.runStatements(tabId(), stmts("insert into t values (1)"));
    expect(tab().active).toBe(MESSAGES);
  });

  it("replaces unpinned results and keeps pinned ones, closed", async () => {
    api.run.mockResolvedValue(rowsResult(500, true));
    await runner.runStatements(tabId(), stmts("select 1"));
    const pinned = tab().results[0].id;
    runner.pin(tabId(), pinned);
    await runner.runStatements(tabId(), stmts("select 2"));
    const unpinned = tab().results[1].id;
    await runner.runStatements(tabId(), stmts("select 3"));
    const t = tab();
    expect(t.results.map((r) => r.id)).toEqual([pinned, t.results[1].id]);
    expect(t.results[1].id).not.toBe(unpinned);
    expect(t.results[0].cursor).toBe("closed");
    expect(api.closeResult).toHaveBeenCalledWith(unpinned);
    expect(api.closeResult).not.toHaveBeenCalledWith(pinned);
  });

  it("stops a script at the first error and shows it", async () => {
    api.run.mockResolvedValueOnce(rowsResult(1, false)).mockRejectedValueOnce(new Error("no such table: nope"));
    await runner.runStatements(tabId(), stmts("select 1; select * from nope; select 3"));
    const t = tab();
    expect(api.run).toHaveBeenCalledTimes(2);
    expect(t.messages.at(-1)).toMatchObject({ kind: "error", text: "no such table: nope" });
    expect(t.active).toBe(MESSAGES);
    expect(t.runningQueryId).toBeNull();
  });

  it("stops a script after a cancelled statement", async () => {
    const first = deferred<RunResult>();
    api.run.mockReturnValueOnce(first.promise);
    const running = runner.runStatements(tabId(), stmts("select 1; select 2"));
    runner.cancel(tabId());
    expect(tab().stopping).toBe(true);
    expect(api.cancel).toHaveBeenCalledWith(tab().runningQueryId);
    first.reject(new Error("Query canceled."));
    await running;
    expect(api.run).toHaveBeenCalledTimes(1);
    expect(tab().messages.at(-1)).toMatchObject({ kind: "canceled" });
    expect(tab().stopping).toBe(false);
  });

  it("ignores a run while one is in flight", async () => {
    const first = deferred<RunResult>();
    api.run.mockReturnValueOnce(first.promise);
    const running = runner.runStatements(tabId(), stmts("select 1"));
    await runner.runStatements(tabId(), stmts("select 2"));
    expect(api.run).toHaveBeenCalledTimes(1);
    first.resolve(rowsResult(1, false));
    await running;
  });

  it("does nothing on a disconnected profile", async () => {
    store.setState((s) => ({ workspaces: { ...s.workspaces, p1: { ...ws(), status: "disconnected", connId: null } } }));
    await runner.runStatements(tabId(), stmts("select 1"));
    expect(api.run).not.toHaveBeenCalled();
  });

  it("closes an earlier result's cursor when the script runs on", async () => {
    api.run.mockResolvedValueOnce(rowsResult(500, true)).mockResolvedValueOnce(update(1));
    await runner.runStatements(tabId(), stmts("select 1; delete from t"));
    expect(tab().results[0].cursor).toBe("closed");
  });

  it("does not open a cursor for a profile disconnected meanwhile", async () => {
    const first = deferred<RunResult>();
    api.run.mockReturnValueOnce(first.promise);
    const running = runner.runStatements(tabId(), stmts("select 1"));
    await runner.disconnectProfile("p1");
    first.resolve(rowsResult(500, true));
    await running;
    expect(tab().results[0].cursor).toBe("closed");
  });

  it("does not activate a result closed while the script ran on", async () => {
    const second = deferred<RunResult>();
    api.run.mockResolvedValueOnce(rowsResult(1, false)).mockReturnValueOnce(second.promise);
    const running = runner.runStatements(tabId(), stmts("select 1; update t set x = 1"));
    await vi.waitFor(() => expect(api.run).toHaveBeenCalledTimes(2));
    runner.closeResult(tabId(), tab().results[0].id);
    second.resolve(update(1));
    await running;
    expect(tab().results).toHaveLength(0);
    expect(tab().active).toBe(MESSAGES);
  });

  it("caps the messages log", async () => {
    api.run.mockResolvedValue(update(0));
    for (let i = 0; i < 510; i++) await runner.runStatements(tabId(), stmts("delete from t"));
    expect(tab().messages).toHaveLength(500);
  });
});

describe("runCurrent", () => {
  it("runs the statement under the cursor of the active tab", async () => {
    api.run.mockResolvedValue(rowsResult(1, false));
    editor.input = { text: "select 1;\nselect 2;", selection: { from: 12, to: 12 } };
    await runner.runCurrent("statement");
    expect(api.run).toHaveBeenCalledTimes(1);
    expect(api.run.mock.calls[0][3]).toBe("select 2");
  });

  it("runs the whole script", async () => {
    api.run.mockResolvedValue(rowsResult(1, false));
    editor.input = { text: "select 1;\nselect 2;", selection: { from: 0, to: 0 } };
    await runner.runCurrent("script");
    expect(api.run).toHaveBeenCalledTimes(2);
  });

  it("runs in the selected workspace", async () => {
    api.run.mockResolvedValue(rowsResult(1, false));
    editor.input = { text: "select 1", selection: { from: 0, to: 0 } };
    runner.selectProfile("p2");
    await runner.runCurrent("statement");
    expect(api.run).toHaveBeenCalledWith("c2", tabId("p2"), expect.any(String), "select 1");
  });

  it("sends nothing on a disconnected profile and says so", async () => {
    await runner.disconnectProfile("p1");
    editor.input = { text: "select 1", selection: { from: 0, to: 0 } };
    await runner.runCurrent("statement");
    expect(api.run).not.toHaveBeenCalled();
    expect(store.getState().notice).toBe("Not connected.");
    runner.clearNotice();
    expect(store.getState().notice).toBeNull();
  });

  it("drops a run while the profile connects", async () => {
    await runner.disconnectProfile("p1");
    const opening = deferred<{ "conn-id": string; engine: string; label: string }>();
    api.connect.mockReturnValueOnce(opening.promise);
    const connecting = runner.connectProfile("p1");
    editor.input = { text: "select 1", selection: { from: 0, to: 0 } };
    await runner.runCurrent("statement");
    expect(api.run).not.toHaveBeenCalled();
    expect(store.getState().notice).toBeNull();
    opening.resolve({ "conn-id": "c3", engine: "sqlite", label: "P1" });
    await connecting;
  });
});

describe("fetchMore", () => {
  async function openResult() {
    api.run.mockResolvedValue(rowsResult(500, true));
    await runner.runStatements(tabId(), stmts("select * from t"));
    return tab().results[0].id;
  }

  it("appends pages until done", async () => {
    const id = await openResult();
    api.fetchPage.mockResolvedValueOnce(page(500, true)).mockResolvedValueOnce(page(200, false));
    await runner.fetchMore(tabId(), id);
    expect(tab().results[0].rows).toHaveLength(1000);
    expect(tab().results[0].cursor).toBe("open");
    await runner.fetchMore(tabId(), id);
    expect(tab().results[0].rows).toHaveLength(1200);
    expect(tab().results[0].cursor).toBe("done");
    await runner.fetchMore(tabId(), id);
    expect(api.fetchPage).toHaveBeenCalledTimes(2);
  });

  it("marks a result the server closed", async () => {
    const id = await openResult();
    api.fetchPage.mockResolvedValue(page(0, false, true));
    await runner.fetchMore(tabId(), id);
    expect(tab().results[0].cursor).toBe("closed");
  });

  it("caps the rows it loads and closes the cursor", async () => {
    const id = await openResult();
    api.fetchPage.mockResolvedValue(page(500, true));
    await runner.fetchMore(tabId(), id, 800);
    const r = tab().results[0];
    expect(r.rows).toHaveLength(800);
    expect(r.cursor).toBe("capped");
    expect(api.closeResult).toHaveBeenCalledWith(id);
  });

  it("caps a final page too", async () => {
    const id = await openResult();
    api.fetchPage.mockResolvedValue({ ...page(400, false) });
    await runner.fetchMore(tabId(), id, 800);
    const r = tab().results[0];
    expect(r.rows).toHaveLength(800);
    expect(r.cursor).toBe("capped");
  });

  it("does not reopen a result whose profile disconnected during the fetch", async () => {
    const id = await openResult();
    const p = deferred<FetchResult>();
    api.fetchPage.mockReturnValueOnce(p.promise);
    const fetching = runner.fetchMore(tabId(), id);
    await runner.disconnectProfile("p1");
    p.resolve(page(500, true));
    await fetching;
    expect(tab().results[0].cursor).toBe("closed");
  });

  it("reads one page at a time", async () => {
    const id = await openResult();
    const p = deferred<FetchResult>();
    api.fetchPage.mockReturnValueOnce(p.promise);
    const first = runner.fetchMore(tabId(), id);
    expect(tab().results[0].fetching).toBe(true);
    expect(tab().runningQueryId).toBe(id);
    await runner.fetchMore(tabId(), id);
    expect(api.fetchPage).toHaveBeenCalledTimes(1);
    p.resolve(page(10, true));
    await first;
    expect(tab().results[0].fetching).toBe(false);
    expect(tab().runningQueryId).toBeNull();
  });

  it("logs a failed page and closes the result", async () => {
    const id = await openResult();
    api.fetchPage.mockRejectedValue(new Error("Query canceled."));
    await runner.fetchMore(tabId(), id);
    expect(tab().results[0].cursor).toBe("closed");
    expect(tab().messages.at(-1)).toMatchObject({ kind: "canceled" });
  });
});

describe("tabs", () => {
  it("opens numbered tabs and makes the new one active", () => {
    runner.newTab();
    runner.newTab();
    const w = ws();
    expect(w.tabs.map((t) => t.title)).toEqual(["Query 1", "Query 2", "Query 3"]);
    expect(w.activeTab).toBe(w.tabs[2].id);
    expect(ws("p2").tabs).toHaveLength(1);
  });

  it("closing a tab closes its session and its editor state", async () => {
    runner.newTab();
    const id = tabId();
    await runner.closeTab(id);
    expect(api.closeSession).toHaveBeenCalledWith("c1", id);
    expect(editor.dropped).toEqual([id]);
    expect(ws().tabs).toHaveLength(1);
    expect(ws().activeTab).toBe(ws().tabs[0].id);
  });

  it("closing a tab of a disconnected profile closes no session", async () => {
    await runner.disconnectProfile("p1");
    const id = tabId();
    await runner.closeTab(id);
    expect(api.closeSession).not.toHaveBeenCalled();
    expect(editor.dropped).toEqual([id]);
  });

  it("closing the last tab opens a fresh one", async () => {
    const id = tabId();
    await runner.closeTab(id);
    const w = ws();
    expect(w.tabs).toHaveLength(1);
    expect(w.tabs[0].id).not.toBe(id);
    expect(w.activeTab).toBe(w.tabs[0].id);
  });

  it("a script stops when its tab closes, and its late reply is dropped", async () => {
    const id = tabId();
    const first = deferred<RunResult>();
    api.run.mockReturnValueOnce(first.promise);
    const running = runner.runStatements(id, stmts("select 1; select 2"));
    await runner.closeTab(id);
    first.resolve(rowsResult(1, false));
    await running;
    expect(api.run).toHaveBeenCalledTimes(1);
    expect(ws().tabs.find((t) => t.id === id)).toBeUndefined();
  });

  it("closing a result closes its cursor", async () => {
    api.run.mockResolvedValue(rowsResult(500, true));
    await runner.runStatements(tabId(), stmts("select 1"));
    const id = tab().results[0].id;
    runner.closeResult(tabId(), id);
    expect(api.closeResult).toHaveBeenCalledWith(id);
    expect(tab().results).toHaveLength(0);
    expect(tab().active).toBe(MESSAGES);
  });
});

describe("workspaces", () => {
  it("two connected profiles run independently", async () => {
    api.run.mockResolvedValue(rowsResult(500, true));
    await runner.runStatements(tabId("p1"), stmts("select 1"));
    await runner.runStatements(tabId("p2"), stmts("select 2"));
    expect(api.run.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["c1", tabId("p1")],
      ["c2", tabId("p2")],
    ]);
    expect(tab("p1").results[0].sql).toBe("select 1");
    expect(tab("p2").results[0].sql).toBe("select 2");
  });

  it("disconnecting one profile closes only its database and results", async () => {
    api.run.mockResolvedValue(rowsResult(500, true));
    await runner.runStatements(tabId("p1"), stmts("select 1"));
    await runner.runStatements(tabId("p2"), stmts("select 2"));
    const p1Tab = tabId("p1");
    await runner.disconnectProfile("p1");
    expect(api.closeDb).toHaveBeenCalledWith("c1");
    expect(api.closeDb).toHaveBeenCalledTimes(1);
    expect(ws("p1")).toMatchObject({ status: "disconnected", connId: null, error: null });
    expect(tabId("p1")).toBe(p1Tab);
    expect(tab("p1").results[0].cursor).toBe("closed");
    expect(ws("p2")).toMatchObject({ status: "connected", connId: "c2" });
    expect(tab("p2").results[0].cursor).toBe("open");
  });

  it("selecting a profile makes its workspace and never connects", () => {
    store.setState({ notice: "Not connected." });
    runner.selectProfile("p3");
    expect(store.getState().selected).toBe("p3");
    expect(ws("p3")).toMatchObject({ status: "disconnected", connId: null });
    expect(store.getState().notice).toBeNull();
    expect(api.connect).not.toHaveBeenCalled();
  });

  it("connecting keeps the selection and sets the connection", async () => {
    api.connect.mockResolvedValue({ "conn-id": "c3", engine: "postgres", label: "P3", "profile-id": "p3" });
    const connecting = runner.connectProfile("p3");
    expect(ws("p3").status).toBe("connecting");
    await runner.connectProfile("p3");
    await connecting;
    expect(api.connect).toHaveBeenCalledTimes(1);
    expect(ws("p3")).toMatchObject({ status: "connected", connId: "c3", error: null });
    expect(store.getState().selected).toBe("p1");
  });

  it("a failed connect stays disconnected and says why", async () => {
    api.connect.mockRejectedValue(new Error("password authentication failed"));
    await runner.connectProfile("p3");
    expect(ws("p3")).toMatchObject({
      status: "disconnected",
      connId: null,
      error: "password authentication failed",
    });
  });

  it("connecting a connected profile does nothing", async () => {
    await runner.connectProfile("p1");
    expect(api.connect).not.toHaveBeenCalled();
  });
});
