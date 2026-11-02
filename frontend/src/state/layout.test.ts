import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const focusEditor = vi.hoisted(() => vi.fn());
vi.mock("@/editor/states", () => ({ focusEditor }));
const api = vi.hoisted(() => ({ sidebarHidden: vi.fn(), setSidebarHidden: vi.fn() }));
vi.mock("@/lib/api", () => api);

import { loadSidebar, sidebarShown, toggleSidebar } from "./layout";
import { type AppState, initialState, newWorkspace, store } from "./store";

// A selected profile p with a loaded workspace (the tab strip shows).
const loaded = (patch: Partial<AppState> = {}): AppState => ({
  ...initialState(),
  selected: "p",
  workspaces: { p: newWorkspace("p") },
  ...patch,
});

// A focused element, as far as layout.ts looks at one.
const focused = (inSidebar: boolean) => ({ closest: () => (inSidebar ? {} : null) });

beforeEach(() => {
  vi.useFakeTimers();
  focusEditor.mockReset();
  api.sidebarHidden.mockReset();
  api.setSidebarHidden.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("document", { activeElement: null });
  store.setState(initialState(), true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sidebarShown", () => {
  it("shows until the user hides it", () => {
    expect(sidebarShown(loaded())).toBe(true);
    expect(sidebarShown(loaded({ sidebarHidden: false }))).toBe(true);
    expect(sidebarShown(loaded({ sidebarHidden: true }))).toBe(false);
  });

  it("always shows without a tab strip", () => {
    expect(sidebarShown({ ...initialState(), sidebarHidden: true })).toBe(true);
    const failed = { ...newWorkspace("p"), loadError: "disk full" };
    expect(sidebarShown(loaded({ sidebarHidden: true, workspaces: { p: failed } }))).toBe(true);
    // Selected, its tabs still loading.
    expect(sidebarShown(loaded({ sidebarHidden: true, workspaces: {} }))).toBe(true);
  });
});

describe("loadSidebar", () => {
  it("applies the saved choice", async () => {
    api.sidebarHidden.mockResolvedValue(true);
    await loadSidebar();
    expect(store.getState().sidebarHidden).toBe(true);
  });

  it("keeps a choice made before the answer arrived", async () => {
    api.sidebarHidden.mockResolvedValue(true);
    store.setState({ sidebarHidden: false });
    await loadSidebar();
    expect(store.getState().sidebarHidden).toBe(false);
  });

  it("leaves the sidebar shown when the read fails", async () => {
    api.sidebarHidden.mockRejectedValue(new Error("no database"));
    await loadSidebar();
    expect(store.getState().sidebarHidden).toBeNull();
  });
});

describe("toggleSidebar", () => {
  it("hides and shows it, and saves each choice", async () => {
    store.setState(loaded(), true);
    toggleSidebar();
    expect(store.getState().sidebarHidden).toBe(true);
    await vi.runAllTimersAsync();
    expect(api.setSidebarHidden).toHaveBeenLastCalledWith(true);
    toggleSidebar();
    expect(store.getState().sidebarHidden).toBe(false);
    await vi.runAllTimersAsync();
    expect(api.setSidebarHidden).toHaveBeenLastCalledWith(false);
  });

  it("saves quick toggles one at a time, in order", async () => {
    let finish = () => {};
    api.setSidebarHidden.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    store.setState(loaded(), true);
    toggleSidebar();
    toggleSidebar();
    await vi.runAllTimersAsync();
    expect(api.setSidebarHidden.mock.calls).toEqual([[true]]);
    finish();
    await vi.runAllTimersAsync();
    expect(api.setSidebarHidden.mock.calls).toEqual([[true], [false]]);
  });

  it("does nothing without a tab strip", () => {
    store.setState({ ...initialState(), sidebarHidden: true }, true);
    toggleSidebar();
    expect(store.getState().sidebarHidden).toBe(true);
    expect(api.setSidebarHidden).not.toHaveBeenCalled();
  });

  it("keeps the new state when the save fails", async () => {
    api.setSidebarHidden.mockRejectedValue(new Error("disk full"));
    store.setState(loaded(), true);
    toggleSidebar();
    await vi.runAllTimersAsync();
    expect(store.getState().sidebarHidden).toBe(true);
  });

  it("moves focus to the editor when it hides with focus inside", () => {
    store.setState(loaded(), true);
    vi.stubGlobal("document", { activeElement: focused(true) });
    toggleSidebar();
    vi.runAllTimers();
    expect(focusEditor).toHaveBeenCalledOnce();
  });

  it("leaves focus alone when it was elsewhere, or on show", () => {
    store.setState(loaded(), true);
    vi.stubGlobal("document", { activeElement: focused(false) });
    toggleSidebar();
    vi.stubGlobal("document", { activeElement: focused(true) });
    toggleSidebar();
    vi.runAllTimers();
    expect(focusEditor).not.toHaveBeenCalled();
  });
});
