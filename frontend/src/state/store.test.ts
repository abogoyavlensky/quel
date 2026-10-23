import { beforeEach, describe, expect, it } from "vitest";
import {
  type ResultTab,
  closeCursors,
  findTab,
  initialState,
  newWorkspace,
  selectedWorkspace,
  store,
  updateTab,
  workspaceOfTab,
} from "./store";

const result = (id: string): ResultTab => ({
  id,
  sql: "select 1",
  columns: [],
  rows: [],
  cursor: "open",
  fetching: false,
  pinned: false,
  elapsedMs: 1,
});

// Two workspaces, a and b, each with one tab holding an open result.
function seed() {
  const a = newWorkspace("a");
  const b = newWorkspace("b");
  a.tabs[0].results = [result("ra")];
  b.tabs[0].results = [result("rb")];
  store.setState({ ...initialState(), workspaces: { a, b } }, true);
  return { a: a.tabs[0].id, b: b.tabs[0].id };
}

beforeEach(() => store.setState(initialState(), true));

describe("workspaces", () => {
  it("finds a tab and its workspace in any workspace", () => {
    const { a, b } = seed();
    expect(workspaceOfTab(b)?.profileId).toBe("b");
    expect(findTab(a)?.id).toBe(a);
    expect(findTab("nope")).toBeUndefined();
    expect(workspaceOfTab("nope")).toBeUndefined();
  });

  it("updates a tab in its own workspace only", () => {
    const { a, b } = seed();
    updateTab(b, (t) => ({ ...t, title: "Changed" }));
    expect(findTab(b)?.title).toBe("Changed");
    expect(findTab(a)?.title).toBe("Query 1");
  });

  it("closes the cursors of one workspace", () => {
    const { a, b } = seed();
    closeCursors("a");
    expect(findTab(a)?.results[0].cursor).toBe("closed");
    expect(findTab(b)?.results[0].cursor).toBe("open");
  });

  it("gives the selected workspace", () => {
    seed();
    expect(selectedWorkspace(store.getState())).toBeUndefined();
    store.setState({ selected: "b" });
    expect(selectedWorkspace(store.getState())?.profileId).toBe("b");
    store.setState({ selected: "gone" });
    expect(selectedWorkspace(store.getState())).toBeUndefined();
  });
});
