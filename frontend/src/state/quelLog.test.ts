import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  setQuelQueriesSink: vi.fn(),
  quelQueriesHidden: vi.fn(),
  setQuelQueriesHidden: vi.fn(),
}));
vi.mock("@/lib/api", () => api);

import {
  appendForConn,
  appendQuelQueries,
  loadQuelQueriesHidden,
  messagesWithQuel,
  startQuelLog,
  toQuelQueries,
  toggleQuelQueries,
} from "./quelLog";
import { MAX_MESSAGES, type Message, type QuelQuery, initialState, newWorkspace, store } from "./store";

const raw = (sql: string, extra: Record<string, unknown> = {}) => ({ sql, params: [], ms: 2, rows: 3, ...extra });

beforeEach(() => {
  store.setState(
    {
      ...initialState(),
      workspaces: { p: { ...newWorkspace("p"), connId: "c1" }, q: { ...newWorkspace("q"), connId: "c2" } },
    },
    true,
  );
  api.quelQueriesHidden.mockReset();
  api.setQuelQueriesHidden.mockReset();
  api.setQuelQueriesHidden.mockResolvedValue(undefined);
});

describe("the log", () => {
  it("takes the api's catalog replies once started", () => {
    startQuelLog();
    expect(api.setQuelQueriesSink).toHaveBeenCalledWith(appendForConn);
  });

  it("normalizes the backend's entries", () => {
    const [ok, bad] = toQuelQueries([raw("select 1", { params: ["a", 1] }), raw("select x", { error: "no x" })], 5);
    expect(ok).toMatchObject({ sql: "select 1", params: ["a", "1"], ms: 2, rows: 3, error: null, at: 5 });
    expect(bad).toMatchObject({ sql: "select x", rows: null, error: "no x" });
    expect(toQuelQueries({})).toEqual([]);
    expect(toQuelQueries([{ ms: 1 }])).toEqual([]);
  });

  it("goes to the workspace with that conn-id, and to no other", () => {
    appendForConn("c2", [raw("pragma table_info(t)")]);
    expect(store.getState().workspaces.q.quelLog.map((x) => x.sql)).toEqual(["pragma table_info(t)"]);
    expect(store.getState().workspaces.p.quelLog).toEqual([]);
    appendForConn("gone", [raw("select 1")]);
    expect(store.getState().workspaces.p.quelLog).toEqual([]);
  });

  it("keeps at most MAX_MESSAGES, newest last", () => {
    appendQuelQueries(
      "p",
      Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => raw(`select ${i}`)),
    );
    const log = store.getState().workspaces.p.quelLog;
    expect(log).toHaveLength(MAX_MESSAGES);
    expect(log.at(-1)?.sql).toBe(`select ${MAX_MESSAGES + 4}`);
  });
});

describe("the toggle", () => {
  it("is shown until the saved choice says otherwise", async () => {
    api.quelQueriesHidden.mockResolvedValue(true);
    expect(store.getState().quelQueriesHidden).toBeNull();
    await loadQuelQueriesHidden();
    expect(store.getState().quelQueriesHidden).toBe(true);
  });

  it("keeps a toggle made before the read, and a failed read leaves them shown", async () => {
    api.quelQueriesHidden.mockResolvedValue(false);
    toggleQuelQueries();
    await loadQuelQueriesHidden();
    expect(store.getState().quelQueriesHidden).toBe(true);
    store.setState({ quelQueriesHidden: null });
    api.quelQueriesHidden.mockRejectedValue(new Error("down"));
    await loadQuelQueriesHidden();
    expect(store.getState().quelQueriesHidden).toBeNull();
  });

  it("saves each toggle", async () => {
    toggleQuelQueries();
    toggleQuelQueries();
    await vi.waitFor(() => expect(api.setQuelQueriesHidden).toHaveBeenCalledTimes(2));
    expect(api.setQuelQueriesHidden.mock.calls).toEqual([[true], [false]]);
    expect(store.getState().quelQueriesHidden).toBe(false);
  });
});

describe("messagesWithQuel", () => {
  const msg = (at: number): Message => ({ id: `m${at}`, sql: "s", kind: "rows", text: "1 row", elapsedMs: 1, at });
  const q = (at: number, id = `q${at}`): QuelQuery => ({ id, sql: "s", params: [], ms: 1, rows: 1, error: null, at });

  it("merges by time; a tie puts the tab's message first and keeps a batch's order", () => {
    const w = { ...newWorkspace("p"), quelLog: [q(1), q(3, "a"), q(3, "b")] };
    const got = messagesWithQuel([msg(2), msg(3)], w, true).map((e) => (e.kind === "tab" ? e.m.id : e.q.id));
    expect(got).toEqual(["q1", "m2", "m3", "a", "b"]);
  });

  it("is the tab's messages alone when hidden", () => {
    const w = { ...newWorkspace("p"), quelLog: [q(1)] };
    expect(messagesWithQuel([msg(2)], w, false).map((e) => e.kind)).toEqual(["tab"]);
  });
});
