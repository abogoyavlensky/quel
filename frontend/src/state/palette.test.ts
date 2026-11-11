import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const focusEditor = vi.hoisted(() => vi.fn());
vi.mock("@/editor/states", () => ({ focusEditor }));
const selectTab = vi.hoisted(() => vi.fn());
const selectResult = vi.hoisted(() => vi.fn());
vi.mock("@/state/runner", () => ({ selectTab, selectResult }));
const layout = vi.hoisted(() => ({ toggleSidebar: vi.fn(), toggleResults: vi.fn(), showResults: vi.fn() }));
vi.mock("./layout", () => layout);
const { toggleSidebar, toggleResults, showResults } = layout;

import {
  closePalette,
  cycleTabsKey,
  focusEditorKey,
  focusResultKey,
  focusTabKey,
  modalOpen,
  openPalette,
  restoreFocus,
  toggleResultsKey,
  toggleSidebarKey,
} from "./palette";
import { MESSAGES, initialState, newTabState, newWorkspace, store } from "./store";

// A workspace for profile p with n tabs.
function seed(n = 1, patch: Partial<ReturnType<typeof newWorkspace>> = {}) {
  const w = newWorkspace("p");
  for (let i = 2; i <= n; i++) w.tabs.push(newTabState(i));
  store.setState({ ...initialState(), selected: "p", workspaces: { p: { ...w, ...patch } } }, true);
  return store.getState().workspaces.p.tabs.map((t) => t.id);
}

// A focused element, as far as palette.ts looks at one.
const element = (isConnected = true) => ({ focus: vi.fn(), isConnected });

beforeEach(() => {
  vi.useFakeTimers();
  focusEditor.mockReset();
  selectTab.mockReset();
  selectResult.mockReset();
  toggleSidebar.mockReset();
  toggleResults.mockReset();
  showResults.mockReset().mockImplementation(() => store.setState({ resultsHidden: false }));
  vi.stubGlobal("document", { activeElement: null });
  store.setState(initialState(), true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("openPalette", () => {
  it("opens, switches to the other palette, and closes", () => {
    openPalette("connections");
    expect(store.getState().palette).toBe("connections");
    openPalette("commands");
    expect(store.getState().palette).toBe("commands");
    closePalette();
    expect(store.getState().palette).toBeNull();
  });

  it("is refused under the profile dialog", () => {
    store.setState({ profileDialog: { mode: "new" } });
    openPalette("commands");
    expect(store.getState().palette).toBeNull();
  });

  it("is refused under the update dialog", () => {
    store.setState({ updateDialogOpen: true });
    openPalette("connections");
    expect(store.getState().palette).toBeNull();
  });

  it("is refused while a run waits for its confirmation", () => {
    store.setState({ runConfirm: { profileId: "p1", reason: "writes", statements: ["delete from t"], total: 1 } });
    openPalette("commands");
    expect(store.getState().palette).toBeNull();
  });
});

describe("modalOpen", () => {
  it("is true for each dialog and palette", () => {
    expect(modalOpen(initialState())).toBe(false);
    expect(modalOpen({ ...initialState(), profileDialog: { mode: "new" } })).toBe(true);
    expect(modalOpen({ ...initialState(), updateDialogOpen: true })).toBe(true);
    expect(
      modalOpen({ ...initialState(), runConfirm: { profileId: "p1", reason: "always", statements: [], total: 1 } }),
    ).toBe(true);
    expect(modalOpen({ ...initialState(), palette: "commands" })).toBe(true);
  });
});

describe("focusResultKey", () => {
  // The current tab with one result, r1, shown or not.
  function withResult(active: string, kind = "rows") {
    seed();
    store.setState((s) => {
      const w = s.workspaces.p;
      const tab = { ...w.tabs[0], results: [{ id: "r1", kind } as (typeof w.tabs)[0]["results"][number]], active };
      return { workspaces: { p: { ...w, tabs: [tab] } } };
    });
  }
  const grid = () => {
    const el = { focus: vi.fn() };
    vi.stubGlobal("document", { activeElement: null, querySelector: () => el });
    return el;
  };

  it("focuses the grid of the shown result", () => {
    withResult("r1");
    const el = grid();
    focusResultKey();
    expect(el.focus).toHaveBeenCalledOnce();
  });

  it("shows hidden results first, and focuses on the next tick", () => {
    withResult("r1");
    store.setState({ resultsHidden: true });
    const el = grid();
    focusResultKey();
    expect(store.getState().resultsHidden).toBe(false);
    expect(el.focus).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(el.focus).toHaveBeenCalledOnce();
  });

  it("leaves results hidden where there is no grid to focus", () => {
    withResult(MESSAGES);
    store.setState({ resultsHidden: true });
    focusResultKey();
    expect(store.getState().resultsHidden).toBe(true);
    expect(showResults).not.toHaveBeenCalled();
  });

  it("does nothing on a result with no rows", () => {
    const el = grid();
    withResult("r1", "update");
    focusResultKey();
    expect(el.focus).not.toHaveBeenCalled();
  });

  it("does nothing on Messages, with no such result, or under a dialog", () => {
    const el = grid();
    focusResultKey();
    withResult(MESSAGES);
    focusResultKey();
    withResult("gone");
    focusResultKey();
    withResult("r1");
    store.setState({ updateDialogOpen: true });
    focusResultKey();
    expect(el.focus).not.toHaveBeenCalled();
  });
});

describe("toggleSidebarKey", () => {
  it("toggles the sidebar, not under a dialog or palette", () => {
    seed();
    toggleSidebarKey();
    expect(toggleSidebar).toHaveBeenCalledOnce();
    store.setState({ palette: "connections" });
    toggleSidebarKey();
    store.setState({ palette: null, profileDialog: { mode: "new" } });
    toggleSidebarKey();
    expect(toggleSidebar).toHaveBeenCalledOnce();
  });
});

describe("toggleResultsKey", () => {
  it("toggles the results, not under a dialog or palette", () => {
    seed();
    toggleResultsKey();
    expect(toggleResults).toHaveBeenCalledOnce();
    store.setState({ palette: "connections" });
    toggleResultsKey();
    store.setState({ palette: null, profileDialog: { mode: "new" } });
    toggleResultsKey();
    expect(toggleResults).toHaveBeenCalledOnce();
  });
});

describe("focusEditorKey", () => {
  it("focuses the editor of a loaded workspace", () => {
    seed();
    focusEditorKey();
    expect(focusEditor).toHaveBeenCalledOnce();
  });

  it("does nothing with no workspace, a load error, or a dialog or palette open", () => {
    focusEditorKey();
    seed(1, { loadError: "boom" });
    focusEditorKey();
    seed();
    store.setState({ palette: "commands" });
    focusEditorKey();
    store.setState({ palette: null, profileDialog: { mode: "new" } });
    focusEditorKey();
    store.setState({ profileDialog: null, updateDialogOpen: true });
    focusEditorKey();
    expect(focusEditor).not.toHaveBeenCalled();
  });
});

describe("focusTabKey", () => {
  it("selects tab n and focuses the editor on the next tick", () => {
    const ids = seed(3);
    focusTabKey(1);
    expect(selectTab).toHaveBeenLastCalledWith(ids[0]);
    focusTabKey(2);
    expect(selectTab).toHaveBeenLastCalledWith(ids[1]);
    expect(focusEditor).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(focusEditor).toHaveBeenCalledTimes(2);
  });

  it("picks the last tab for 9", () => {
    const ids = seed(3);
    focusTabKey(9);
    expect(selectTab).toHaveBeenCalledWith(ids[2]);
  });

  it("does nothing past the last tab", () => {
    seed(3);
    focusTabKey(5);
    vi.runAllTimers();
    expect(selectTab).not.toHaveBeenCalled();
    expect(focusEditor).not.toHaveBeenCalled();
  });

  it("does nothing with no workspace, a load error, or a palette open", () => {
    focusTabKey(1);
    seed(2, { loadError: "boom" });
    focusTabKey(1);
    seed(2);
    store.setState({ palette: "connections" });
    focusTabKey(1);
    vi.runAllTimers();
    expect(selectTab).not.toHaveBeenCalled();
    expect(focusEditor).not.toHaveBeenCalled();
  });
});

describe("cycleTabsKey", () => {
  // Focus outside the results: no element, or one not inside the pane.
  const outside = () => vi.stubGlobal("document", { activeElement: { closest: () => null } });
  // Focus inside the results pane; the page has a grid or not, and a
  // selected result tab button.
  function inside(hasGrid: boolean) {
    const grid = { focus: vi.fn() };
    const tabButton = { focus: vi.fn(), scrollIntoView: vi.fn() };
    vi.stubGlobal("document", {
      activeElement: { closest: (sel: string) => (sel === "[data-quel-results]" ? {} : null) },
      querySelector: (sel: string) => (sel === "[data-result-grid]" ? (hasGrid ? grid : null) : tabButton),
    });
    return { grid, tabButton };
  }
  // The current tab with results r1 and r2, showing `active`.
  function withResults(active: string, ids = ["r1", "r2"]) {
    seed();
    store.setState((s) => {
      const w = s.workspaces.p;
      const results = ids.map((id) => ({ id, kind: "rows" }) as (typeof w.tabs)[0]["results"][number]);
      return { workspaces: { p: { ...w, tabs: [{ ...w.tabs[0], results, active }] } } };
    });
    return store.getState().workspaces.p.tabs[0].id;
  }

  it("cycles the editor tabs, wrapping, and focuses the editor on the next tick", () => {
    const ids = seed(3);
    cycleTabsKey(1);
    expect(selectTab).toHaveBeenLastCalledWith(ids[1]);
    outside();
    cycleTabsKey(-1);
    expect(selectTab).toHaveBeenLastCalledWith(ids[2]);
    expect(focusEditor).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(focusEditor).toHaveBeenCalledTimes(2);
    expect(selectResult).not.toHaveBeenCalled();
  });

  it("cycles the result tabs, Messages first, while focus is in the results", () => {
    const tabId = withResults("r1");
    inside(true);
    cycleTabsKey(1);
    expect(selectResult).toHaveBeenLastCalledWith(tabId, "r2");
    cycleTabsKey(-1);
    expect(selectResult).toHaveBeenLastCalledWith(tabId, MESSAGES);
    const tabId2 = withResults("r2");
    cycleTabsKey(1);
    expect(selectResult).toHaveBeenLastCalledWith(tabId2, MESSAGES);
    expect(selectTab).not.toHaveBeenCalled();
  });

  it("focuses the new result's grid on the next tick", () => {
    withResults("r1");
    const { grid, tabButton } = inside(true);
    cycleTabsKey(1);
    expect(grid.focus).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(grid.focus).toHaveBeenCalledOnce();
    expect(tabButton.focus).not.toHaveBeenCalled();
    expect(focusEditor).not.toHaveBeenCalled();
  });

  it("focuses the selected tab button, scrolled into view, when there is no grid", () => {
    withResults("r1");
    const { tabButton } = inside(false);
    cycleTabsKey(-1);
    vi.runAllTimers();
    expect(tabButton.focus).toHaveBeenCalledOnce();
    expect(tabButton.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });

  it("does nothing with one editor tab, or no results", () => {
    seed(1);
    cycleTabsKey(1);
    withResults(MESSAGES, []);
    inside(true);
    cycleTabsKey(1);
    vi.runAllTimers();
    expect(selectTab).not.toHaveBeenCalled();
    expect(selectResult).not.toHaveBeenCalled();
    expect(focusEditor).not.toHaveBeenCalled();
  });

  it("does nothing with no workspace, a load error, or a palette open", () => {
    cycleTabsKey(1);
    seed(2, { loadError: "boom" });
    cycleTabsKey(1);
    seed(2);
    store.setState({ palette: "commands" });
    cycleTabsKey(1);
    vi.runAllTimers();
    expect(selectTab).not.toHaveBeenCalled();
    expect(focusEditor).not.toHaveBeenCalled();
  });
});

describe("restoreFocus", () => {
  it("returns to the element focused before the first open, also after a switch", () => {
    const el = element();
    vi.stubGlobal("document", { activeElement: el });
    openPalette("commands");
    // Focus is in the palette now; switching keeps the first element.
    vi.stubGlobal("document", { activeElement: element() });
    openPalette("connections");
    closePalette();
    restoreFocus();
    expect(el.focus).toHaveBeenCalledOnce();
    expect(focusEditor).not.toHaveBeenCalled();
  });

  it("leaves focus alone while the other palette is open, and keeps the element for it", () => {
    const el = element();
    vi.stubGlobal("document", { activeElement: el });
    openPalette("commands");
    openPalette("connections");
    restoreFocus();
    expect(el.focus).not.toHaveBeenCalled();
    expect(focusEditor).not.toHaveBeenCalled();
    closePalette();
    restoreFocus();
    expect(el.focus).toHaveBeenCalledOnce();
  });

  it("focuses the editor when that element has left the document", () => {
    const el = element(false);
    vi.stubGlobal("document", { activeElement: el });
    openPalette("commands");
    closePalette();
    restoreFocus();
    expect(el.focus).not.toHaveBeenCalled();
    expect(focusEditor).toHaveBeenCalledOnce();
  });

  it("forgets the element once restored", () => {
    const el = element();
    vi.stubGlobal("document", { activeElement: el });
    openPalette("commands");
    closePalette();
    restoreFocus();
    restoreFocus();
    expect(el.focus).toHaveBeenCalledOnce();
    expect(focusEditor).toHaveBeenCalledOnce();
  });
});
