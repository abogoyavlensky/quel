import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/editor/states", () => ({ focusEditor: vi.fn() }));
vi.mock("./runner", () => ({ selectResult: vi.fn(), selectTab: vi.fn() }));

import { closeAbout, openAbout } from "./about";
import { modalOpen, openPalette } from "./palette";
import { openSettings } from "./settings";
import { type AppState, initialState, store } from "./store";

beforeEach(() => {
  store.setState(initialState(), true);
});

describe("openAbout", () => {
  it("opens, and counts as a dialog", () => {
    openAbout();
    expect(store.getState().aboutOpen).toBe(true);
    expect(modalOpen(store.getState())).toBe(true);
    closeAbout();
    expect(store.getState().aboutOpen).toBe(false);
  });

  it("does not open under another dialog or a palette", () => {
    const others: Partial<AppState>[] = [
      { palette: "commands" },
      { profileDialog: { mode: "new" } as AppState["profileDialog"] },
      { updateDialogOpen: true },
      { runConfirm: {} as AppState["runConfirm"] },
      { settingsOpen: true },
    ];
    for (const patch of others) {
      store.setState({ ...initialState(), ...patch }, true);
      openAbout();
      expect(store.getState().aboutOpen).toBe(false);
    }
  });

  it("keeps the palettes and Settings out while it is open", () => {
    openAbout();
    openPalette("commands");
    openSettings();
    expect(store.getState().palette).toBeNull();
    expect(store.getState().settingsOpen).toBe(false);
  });
});
