import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/editor/states", () => ({ focusEditor: vi.fn() }));
vi.mock("./runner", () => ({ selectResult: vi.fn(), selectTab: vi.fn() }));

import { modalOpen, openPalette } from "./palette";
import { closeSettings, openSettings } from "./settings";
import { type AppState, initialState, store } from "./store";

beforeEach(() => {
  store.setState(initialState(), true);
});

describe("openSettings", () => {
  it("opens, and counts as a dialog", () => {
    openSettings();
    expect(store.getState().settingsOpen).toBe(true);
    expect(modalOpen(store.getState())).toBe(true);
    closeSettings();
    expect(store.getState().settingsOpen).toBe(false);
  });

  it("does not open under another dialog or a palette", () => {
    const others: Partial<AppState>[] = [
      { palette: "commands" },
      { profileDialog: { mode: "new" } as AppState["profileDialog"] },
      { updateDialogOpen: true },
      { runConfirm: {} as AppState["runConfirm"] },
    ];
    for (const patch of others) {
      store.setState({ ...initialState(), ...patch }, true);
      openSettings();
      expect(store.getState().settingsOpen).toBe(false);
    }
  });

  it("keeps the palettes out while it is open", () => {
    openSettings();
    openPalette("commands");
    expect(store.getState().palette).toBeNull();
  });
});
