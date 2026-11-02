import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const focusEditor = vi.hoisted(() => vi.fn());
vi.mock("@/editor/states", () => ({ focusEditor }));
const selectTab = vi.hoisted(() => vi.fn());
vi.mock("@/state/runner", () => ({ selectTab }));
const toggleSidebar = vi.hoisted(() => vi.fn());
vi.mock("./layout", () => ({ toggleSidebar }));

import {
  closePalette,
  focusEditorKey,
  focusTabKey,
  modalOpen,
  openPalette,
  restoreFocus,
  toggleSidebarKey,
} from "./palette";
import { initialState, newTabState, newWorkspace, store } from "./store";

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
  toggleSidebar.mockReset();
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
});

describe("modalOpen", () => {
  it("is true for each dialog and palette", () => {
    expect(modalOpen(initialState())).toBe(false);
    expect(modalOpen({ ...initialState(), profileDialog: { mode: "new" } })).toBe(true);
    expect(modalOpen({ ...initialState(), updateDialogOpen: true })).toBe(true);
    expect(modalOpen({ ...initialState(), palette: "commands" })).toBe(true);
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
