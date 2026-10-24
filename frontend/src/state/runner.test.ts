import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClosedTab, FetchResult, RunResult, SavedTab, SavedWorkspace } from "@/lib/types";

const api = vi.hoisted(() => ({
  connect: vi.fn(),
  closeDb: vi.fn(),
  run: vi.fn(),
  fetchPage: vi.fn(),
  cancel: vi.fn(),
  closeResult: vi.fn(),
  closeSession: vi.fn(),
  loadWorkspace: vi.fn(),
  saveWorkspace: vi.fn(),
  closeTab: vi.fn(),
  reopenTab: vi.fn(),
  selectedProfile: vi.fn(),
  selectProfile: vi.fn(),
}));
vi.mock("@/lib/api", () => api);

// The editor's text per tab (texts, set by a test or by seed), else input.
const editor = vi.hoisted(() => ({
  input: { text: "", selection: { from: 0, to: 0 } },
  texts: {} as Record<string, string>,
  seeds: {} as Record<string, { text: string; from: number; to: number }>,
  dropped: [] as string[],
}));
vi.mock("@/editor/states", () => ({
  currentInput: (id: string) =>
    id in editor.texts ? { text: editor.texts[id], selection: { from: 0, to: 0 } } : editor.input,
  dropState: (id: string) => editor.dropped.push(id),
  seed: (id: string, text: string, sel: { from: number; to: number }) => {
    editor.texts[id] = text;
    editor.seeds[id] = { text, ...sel };
  },
}));

const { metaKeys, queryClient } = await import("@/lib/query");
const { store, initialState, newWorkspace, activeTabOf, updateTab, updateWorkspace, MESSAGES } = await import("./store");
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
  api.closeTab.mockResolvedValue(null);
  api.saveWorkspace.mockResolvedValue(undefined);
  api.selectProfile.mockResolvedValue(undefined);
  api.loadWorkspace.mockResolvedValue({ tabs: [], "active-tab": null, "next-tab-number": 1, closed: [] });
  editor.input = { text: "", selection: { from: 0, to: 0 } };
  editor.dropped = [];
  editor.texts = {};
  editor.seeds = {};
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

describe("row details", () => {
  it("selects a row on one result only", async () => {
    api.run.mockResolvedValueOnce(rowsResult(3, false)).mockResolvedValueOnce(rowsResult(3, false));
    await runner.runStatements(tabId(), stmts("select 1; select 2"));
    const [r1, r2] = tab().results;
    expect(r1.selectedRow).toBeNull();
    runner.selectRow(tabId(), r1.id, 2);
    expect(tab().results.map((r) => r.selectedRow)).toEqual([2, null]);
    expect(r2.selectedRow).toBeNull();
  });

  it("starts a new run's results unselected and keeps a pinned one's selection", async () => {
    api.run.mockResolvedValue(rowsResult(3, false));
    await runner.runStatements(tabId(), stmts("select 1"));
    const pinned = tab().results[0].id;
    runner.selectRow(tabId(), pinned, 1);
    runner.pin(tabId(), pinned);
    await runner.runStatements(tabId(), stmts("select 2"));
    runner.selectRow(tabId(), tab().results[1].id, 0);
    await runner.runStatements(tabId(), stmts("select 3"));
    expect(tab().results.map((r) => r.selectedRow)).toEqual([1, null]);
  });

  it("toggles the panel, and opening leaves it open", () => {
    expect(store.getState().rowDetails).toBe(false);
    runner.toggleRowDetails();
    expect(store.getState().rowDetails).toBe(true);
    runner.openRowDetails();
    expect(store.getState().rowDetails).toBe(true);
    runner.toggleRowDetails();
    expect(store.getState().rowDetails).toBe(false);
    runner.openRowDetails();
    expect(store.getState().rowDetails).toBe(true);
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

  it("selecting a profile loads its workspace, remembers it, and never connects", async () => {
    store.setState({ notice: "Not connected." });
    await runner.selectProfile("p3");
    expect(store.getState().selected).toBe("p3");
    expect(api.loadWorkspace).toHaveBeenCalledWith("p3");
    expect(api.selectProfile).toHaveBeenCalledWith("p3");
    expect(ws("p3")).toMatchObject({ status: "disconnected", connId: null });
    expect(store.getState().notice).toBeNull();
    expect(api.connect).not.toHaveBeenCalled();
  });

  it("connecting keeps the selection and sets the connection", async () => {
    const opened = deferred<{ "conn-id": string; engine: "postgres"; label: string; "profile-id": string }>();
    api.connect.mockReturnValue(opened.promise);
    const connecting = runner.connectProfile("p3");
    await vi.waitFor(() => expect(ws("p3")?.status).toBe("connecting"));
    await runner.connectProfile("p3");
    opened.resolve({ "conn-id": "c3", engine: "postgres", label: "P3", "profile-id": "p3" });
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

const saved = (over: Partial<SavedWorkspace> = {}): SavedWorkspace => ({
  tabs: [],
  "active-tab": null,
  "next-tab-number": 1,
  closed: [],
  ...over,
});
const savedTab = (id: string, body: string, over: Partial<SavedTab> = {}): SavedTab => ({
  id,
  title: `T ${id}`,
  body,
  pinned: false,
  "sel-from": 0,
  "sel-to": 0,
  ...over,
});
const closedTab = (id: string, at: number): ClosedTab => ({ id, title: `T ${id}`, body: `select ${id}`, "closed-at": at });

describe("loading a workspace", () => {
  it("restores the saved tabs, seeded, with the active one and the closed list", async () => {
    api.loadWorkspace.mockResolvedValue(
      saved({
        tabs: [savedTab("a", "select 1", { pinned: true, "sel-from": 2, "sel-to": 4 }), savedTab("b", "select 2")],
        "active-tab": "b",
        "next-tab-number": 5,
        closed: [closedTab("z", 2)],
      }),
    );
    const w = await runner.ensureWorkspace("p3");
    expect(w.tabs.map((t) => [t.id, t.title, t.pinned])).toEqual([
      ["a", "T a", true],
      ["b", "T b", false],
    ]);
    expect(w).toMatchObject({ activeTab: "b", nextTabNumber: 5, loadError: null, status: "disconnected" });
    expect(w.closed.map((c) => c.id)).toEqual(["z"]);
    expect(editor.seeds.a).toEqual({ text: "select 1", from: 2, to: 4 });
    expect(ws("p3")).toBe(w);
  });

  it("loads once however many ask, and falls back to the first tab", async () => {
    const held = deferred<SavedWorkspace>();
    api.loadWorkspace.mockReturnValue(held.promise);
    const one = runner.ensureWorkspace("p3");
    const two = runner.ensureWorkspace("p3");
    held.resolve(saved({ tabs: [savedTab("a", "x")], "active-tab": "gone", "next-tab-number": 2 }));
    expect(await one).toBe(await two);
    expect(api.loadWorkspace).toHaveBeenCalledTimes(1);
    expect(ws("p3").activeTab).toBe("a");
  });

  it("nothing saved gives one fresh tab, numbered on", async () => {
    api.loadWorkspace.mockResolvedValueOnce(saved()).mockResolvedValueOnce(saved({ "next-tab-number": 4 }));
    const fresh = await runner.ensureWorkspace("p3");
    expect(fresh.tabs.map((t) => t.title)).toEqual(["Query 1"]);
    expect(fresh.nextTabNumber).toBe(2);
    const later = await runner.ensureWorkspace("p4");
    expect(later.tabs.map((t) => t.title)).toEqual(["Query 4"]);
    expect(later.nextTabNumber).toBe(5);
  });

  it("a failed load is marked, never saved, and can be retried", async () => {
    vi.useFakeTimers();
    try {
      api.loadWorkspace.mockRejectedValueOnce(new Error("disk I/O error"));
      await runner.selectProfile("p3");
      expect(ws("p3").loadError).toBe("disk I/O error");
      runner.newTab();
      await runner.closeTab(ws("p3").tabs[0].id);
      await vi.advanceTimersByTimeAsync(2000);
      expect(api.saveWorkspace).not.toHaveBeenCalled();
      expect(api.closeTab).not.toHaveBeenCalled();
      api.loadWorkspace.mockResolvedValueOnce(saved({ tabs: [savedTab("a", "x")] }));
      await runner.retryLoad("p3");
      expect(ws("p3")).toMatchObject({ loadError: null, activeTab: "a" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("retrying a failed load", () => {
  it("keeps a connection opened meanwhile", async () => {
    api.loadWorkspace.mockRejectedValueOnce(new Error("disk I/O error"));
    await runner.ensureWorkspace("p3");
    api.connect.mockResolvedValue({ "conn-id": "c3", engine: "postgres", label: "P3", "profile-id": "p3" });
    await runner.connectProfile("p3");
    api.loadWorkspace.mockResolvedValueOnce(saved({ tabs: [savedTab("a", "x")] }));
    await runner.retryLoad("p3");
    expect(ws("p3")).toMatchObject({ loadError: null, status: "connected", connId: "c3", activeTab: "a" });
    expect(api.closeDb).not.toHaveBeenCalled();
  });
});

describe("retrying twice at once", () => {
  it("loads once and keeps the tabs' text", async () => {
    api.loadWorkspace.mockRejectedValueOnce(new Error("disk I/O error"));
    await runner.ensureWorkspace("p3");
    const held = deferred<SavedWorkspace>();
    api.loadWorkspace.mockReturnValueOnce(held.promise);
    const one = runner.retryLoad("p3");
    const two = runner.retryLoad("p3");
    held.resolve(saved({ tabs: [savedTab("a", "select a")] }));
    await Promise.all([one, two]);
    expect(api.loadWorkspace).toHaveBeenCalledTimes(2);
    expect(editor.dropped).not.toContain("a");
    expect(ws("p3").activeTab).toBe("a");
  });
});

describe("the selected profile", () => {
  it("is saved one write at a time, the last click winning", async () => {
    const first = deferred<void>();
    api.selectProfile.mockReturnValueOnce(first.promise);
    void runner.selectProfile("p2");
    await vi.waitFor(() => expect(api.selectProfile).toHaveBeenCalledTimes(1));
    void runner.selectProfile("p3");
    void runner.selectProfile("p1");
    first.resolve();
    await vi.waitFor(() => expect(api.selectProfile).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(api.selectProfile.mock.calls.map((c) => c[0])).toEqual(["p2", "p1"]);
  });
});

describe("saving", () => {
  it("each tab change schedules a save of its workspace", async () => {
    vi.useFakeTimers();
    try {
      runner.newTab();
      await vi.advanceTimersByTimeAsync(800);
      expect(api.saveWorkspace).toHaveBeenCalledTimes(1);
      expect(api.saveWorkspace.mock.calls[0][0]).toBe("p1");
      expect(api.saveWorkspace.mock.calls[0][1].tabs).toHaveLength(2);
      runner.selectTab(ws().tabs[0].id);
      await vi.advanceTimersByTimeAsync(800);
      expect(api.saveWorkspace).toHaveBeenCalledTimes(2);
      expect(api.saveWorkspace.mock.calls[1][1]["active-tab"]).toBe(ws().tabs[0].id);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("closing and reopening", () => {
  it("keeps the text typed just before closing, even for a tab never saved", async () => {
    runner.newTab();
    const id = tabId();
    editor.texts[id] = "select typed";
    api.closeTab.mockResolvedValue(closedTab(id, 5));
    await runner.closeTab(id);
    expect(api.closeTab).toHaveBeenCalledWith("p1", { id, title: "Query 2", body: "select typed" });
    expect(ws().closed.map((c) => c.id)).toEqual([id]);
    expect(api.closeSession).toHaveBeenCalledWith("c1", id);
  });

  it("a pending save goes first, and the close waits for it", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      api.saveWorkspace.mockImplementation(async () => void order.push("save"));
      api.closeTab.mockImplementation(async () => (order.push("close"), null));
      runner.newTab();
      await runner.closeTab(tabId());
      expect(order).toEqual(["save", "close"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a blank tab is not kept", async () => {
    const id = tabId();
    await runner.closeTab(id);
    expect(ws().closed).toEqual([]);
  });

  it("a failed close puts the tab back with its text, and the queue goes on", async () => {
    runner.newTab();
    runner.newTab();
    const [, id] = ws().tabs.map((t) => t.id);
    editor.texts[id] = "keep me";
    api.closeTab.mockRejectedValueOnce(new Error("disk full"));
    await runner.closeTab(id);
    expect(ws().tabs.map((t) => t.id)[1]).toBe(id);
    expect(editor.seeds[id]).toMatchObject({ text: "keep me" });
    expect(store.getState().notice).toBe("Could not close the tab: disk full");
    expect(api.closeSession).not.toHaveBeenCalled();
    api.closeTab.mockResolvedValueOnce(closedTab(id, 9));
    await runner.closeTab(id);
    expect(ws().tabs.map((t) => t.id)).not.toContain(id);
    expect(ws().closed.map((c) => c.id)).toEqual([id]);
  });

  it("a failed close of a running tab cancels the run and restores its results", async () => {
    api.run.mockResolvedValueOnce(rowsResult(500, true));
    await runner.runStatements(tabId(), stmts("select 1"));
    const id = tabId();
    const held = deferred<RunResult>();
    api.run.mockReturnValueOnce(held.promise);
    const script = runner.runStatements(id, stmts("select 2; select 3"));
    const running = tab().runningQueryId;
    const pinnedBefore = tab().results;
    api.closeTab.mockRejectedValueOnce(new Error("disk full"));
    await runner.closeTab(id);
    expect(api.cancel).toHaveBeenCalledWith(running);
    expect(ws().tabs.map((t) => t.id)).toEqual([id]);
    // The number the stand-in took is not handed out again.
    expect(ws().nextTabNumber).toBe(3);
    expect(tab().id).toBe(id);
    expect(tab()).toMatchObject({ runningQueryId: null, stopping: false });
    expect(tab().results).toEqual(pinnedBefore);
    expect(tab().messages).toHaveLength(1);
    // The script's late reply is dropped, and it runs nothing more.
    held.resolve(rowsResult(1, false));
    await script;
    expect(api.run).toHaveBeenCalledTimes(2);
    expect(tab().results).toEqual(pinnedBefore);
    expect(tab().runningQueryId).toBeNull();
  });

  it("a failed close during a page load closes that result", async () => {
    api.run.mockResolvedValueOnce(rowsResult(500, true));
    await runner.runStatements(tabId(), stmts("select 1"));
    const id = tabId();
    const resultId = tab().results[0].id;
    const page = deferred<FetchResult>();
    api.fetchPage.mockReturnValueOnce(page.promise);
    const loading = runner.fetchMore(id, resultId);
    api.closeTab.mockRejectedValueOnce(new Error("disk full"));
    await runner.closeTab(id);
    expect(tab().results[0]).toMatchObject({ cursor: "closed", fetching: false, rows: expect.any(Array) });
    expect(api.closeResult).toHaveBeenCalledWith(resultId);
    page.resolve({ rows: rows(500, 501), "has-more": true, closed: false });
    await loading;
    expect(tab().results[0].rows).toHaveLength(500);
    expect(tab().results[0].cursor).toBe("closed");
  });

  it("a save before the close has run still lists the tab, with its last text", async () => {
    vi.useFakeTimers();
    try {
      runner.newTab();
      const id = tabId();
      editor.texts[id] = "select latest";
      const closing = deferred<ClosedTab>();
      api.closeTab.mockReturnValue(closing.promise);
      const closed = runner.closeTab(id);
      await vi.advanceTimersByTimeAsync(0);
      // The pending save went first, the tab in it.
      const first = api.saveWorkspace.mock.calls[0][1];
      expect(first.tabs.find((t: { id: string }) => t.id === id)).toMatchObject({ body: "select latest" });
      closing.resolve(closedTab(id, 4));
      await closed;
      await vi.advanceTimersByTimeAsync(800);
      const after = api.saveWorkspace.mock.calls.at(-1)![1];
      expect(after.tabs.map((t: { id: string }) => t.id)).not.toContain(id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a pinned tab is not closed", async () => {
    const id = tabId();
    updateTab(id, (t) => ({ ...t, pinned: true }));
    await runner.closeTab(id);
    expect(ws().tabs.map((t) => t.id)).toEqual([id]);
    expect(store.getState().notice).toBe("Unpin the tab to close it.");
    expect(api.closeTab).not.toHaveBeenCalled();
  });

  it("reopen right after close waits for the close, then reopens that tab", async () => {
    runner.newTab();
    const id = tabId();
    editor.texts[id] = "select 9";
    const closing = deferred<ClosedTab>();
    api.closeTab.mockReturnValue(closing.promise);
    api.reopenTab.mockResolvedValue(savedTab("new-id", "select 9", { title: "Query 2" }));
    const closed = runner.closeTab(id);
    const reopened = runner.reopenTab();
    await Promise.resolve();
    expect(api.reopenTab).not.toHaveBeenCalled();
    closing.resolve(closedTab(id, 7));
    await Promise.all([closed, reopened]);
    expect(api.reopenTab).toHaveBeenCalledWith("p1", id);
    expect(ws().closed).toEqual([]);
    expect(ws().tabs.at(-1)).toMatchObject({ id: "new-id", title: "Query 2", pinned: false });
    expect(ws().activeTab).toBe("new-id");
    expect(editor.seeds["new-id"]).toMatchObject({ text: "select 9" });
  });

  it("reopens a chosen entry; a failure puts it back in the list", async () => {
    updateWorkspace("p1", (w) => ({ ...w, closed: [closedTab("x", 3), closedTab("y", 2)] }));
    api.reopenTab.mockRejectedValueOnce(new Error("gone"));
    await runner.reopenTab("y");
    expect(ws().closed.map((c) => c.id)).toEqual(["x", "y"]);
    expect(store.getState().notice).toBe("Could not reopen the tab: gone");
    api.reopenTab.mockResolvedValueOnce(savedTab("n", "select y"));
    await runner.reopenTab("y");
    expect(ws().closed.map((c) => c.id)).toEqual(["x"]);
    expect(ws().activeTab).toBe("n");
  });

  it("with nothing closed, reopen does nothing", async () => {
    await runner.reopenTab();
    expect(api.reopenTab).not.toHaveBeenCalled();
  });
});

describe("rename and pin", () => {
  it("renames a tab; a blank name keeps the old one", () => {
    const id = tabId();
    runner.renameTab(id, "  Orders  ");
    expect(tab().title).toBe("Orders");
    runner.renameTab(id, "   ");
    expect(tab().title).toBe("Orders");
  });

  it("pinned tabs come first, in the order they were pinned", () => {
    runner.newTab();
    runner.newTab();
    runner.newTab();
    const [a, b, c, d] = ws().tabs.map((t) => t.id);
    runner.togglePin(c);
    runner.togglePin(a);
    expect(ws().tabs.map((t) => t.id)).toEqual([c, a, b, d]);
    expect(ws().tabs.map((t) => t.pinned)).toEqual([true, true, false, false]);
    // Unpinned, it goes first among the unpinned.
    runner.togglePin(c);
    expect(ws().tabs.map((t) => t.id)).toEqual([a, c, b, d]);
    expect(ws().tabs.map((t) => t.pinned)).toEqual([true, false, false, false]);
    // Unpinning clears the hint to unpin.
    store.setState({ notice: "Unpin the tab to close it." });
    runner.togglePin(a);
    expect(store.getState().notice).toBeNull();
    runner.togglePin(a);
    // A new tab goes last, after the pinned ones.
    runner.newTab();
    expect(ws().tabs[4].pinned).toBe(false);
  });

  it("rename and pin schedule a save", async () => {
    vi.useFakeTimers();
    try {
      runner.renameTab(tabId(), "Orders");
      runner.togglePin(tabId());
      await vi.advanceTimersByTimeAsync(800);
      expect(api.saveWorkspace).toHaveBeenCalledTimes(1);
      expect(api.saveWorkspace.mock.calls[0][1].tabs[0]).toMatchObject({ title: "Orders", pinned: true });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("cached structure", () => {
  const cached = (connId: string) => queryClient.getQueryData(metaKeys.schemas(connId));
  const fill = (connId: string) => queryClient.setQueryData(metaKeys.schemas(connId), [{ name: "main", default: true }]);

  it("goes when the profile disconnects, and only its own", async () => {
    fill("c1");
    fill("c2");
    await runner.disconnectProfile("p1");
    expect(cached("c1")).toBeUndefined();
    expect(cached("c2")).toBeDefined();
    queryClient.clear();
  });

  it("goes when closing the database fails too", async () => {
    fill("c1");
    api.closeDb.mockRejectedValue(new Error("gone"));
    await runner.disconnectProfile("p1");
    expect(cached("c1")).toBeUndefined();
    expect(ws().error).toBe("gone");
  });

  it("stays after DDL: refresh is manual", async () => {
    fill("c1");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    api.run.mockResolvedValue(update(0));
    await runner.runStatements(tabId(), stmts("create table t (x int)"));
    expect(invalidate).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(metaKeys.schemas("c1"))?.isInvalidated).toBe(false);
    invalidate.mockRestore();
    queryClient.clear();
  });

  it("keeps the tree's open nodes per workspace, across a disconnect", async () => {
    runner.setTreeExpanded("p1", ["a", "b"]);
    expect(ws().treeExpanded).toEqual(["a", "b"]);
    expect(ws("p2").treeExpanded).toBeNull();
    await runner.disconnectProfile("p1");
    expect(ws().treeExpanded).toEqual(["a", "b"]);
  });
});
