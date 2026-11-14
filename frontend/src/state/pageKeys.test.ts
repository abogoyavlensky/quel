import { beforeEach, describe, expect, it, vi } from "vitest";

const palette = vi.hoisted(() => ({
  cycleTabsKey: vi.fn(),
  focusEditorKey: vi.fn(),
  focusResultKey: vi.fn(),
  focusTabKey: vi.fn(),
  openPalette: vi.fn(),
  toggleResultsKey: vi.fn(),
  toggleSidebarKey: vi.fn(),
}));
vi.mock("./palette", () => palette);
const runner = vi.hoisted(() => ({ cancel: vi.fn(), selectedTabId: vi.fn(), toggleRowDetails: vi.fn() }));
vi.mock("./runner", () => runner);
const settings = vi.hoisted(() => ({ openSettings: vi.fn() }));
vi.mock("./settings", () => settings);
vi.mock("@/components/keys", async (orig) => ({ ...(await orig<object>()), isMac: true }));

import { KEYMAP, type KeyEntry } from "./keymap";
import { PAGE_KEYS, onPageKey } from "./pageKeys";

const press = (key: string, patch: Partial<KeyboardEvent> = {}) => {
  const e = {
    key,
    code: "",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...patch,
  };
  onPageKey(e as unknown as KeyboardEvent);
  return e;
};

beforeEach(() => {
  for (const f of [...Object.values(palette), ...Object.values(runner)]) f.mockReset();
});

describe("PAGE_KEYS", () => {
  it("has an action for every entry the page catches, and no other", () => {
    const page = (KEYMAP as readonly KeyEntry[]).filter((e) => e.caught.includes("page")).map((e) => e.id);
    expect(Object.keys(PAGE_KEYS).sort()).toEqual(page.sort());
  });
});

describe("onPageKey", () => {
  it("picks tab n on ⌘n, and the last on ⌘9", () => {
    press("3", { code: "Digit3" });
    expect(palette.focusTabKey).toHaveBeenLastCalledWith(3);
    press("9", { code: "Digit9" });
    expect(palette.focusTabKey).toHaveBeenLastCalledWith(9);
  });

  it("cancels the selected tab on ⌘., and nothing without one", () => {
    runner.selectedTabId.mockReturnValue("t1");
    press(".");
    expect(runner.cancel).toHaveBeenCalledWith("t1");
    runner.cancel.mockReset();
    runner.selectedTabId.mockReturnValue(null);
    press(".");
    expect(runner.cancel).not.toHaveBeenCalled();
  });

  it("opens the palettes and toggles the panels", () => {
    press("P", { shiftKey: true });
    expect(palette.openPalette).toHaveBeenLastCalledWith("commands");
    press("p");
    expect(palette.openPalette).toHaveBeenLastCalledWith("connections");
    press("i");
    expect(runner.toggleRowDetails).toHaveBeenCalled();
    press("b");
    expect(palette.toggleSidebarKey).toHaveBeenCalled();
    press(",");
    expect(settings.openSettings).toHaveBeenCalled();
  });

  it("stops a key it catches, and leaves the others alone", () => {
    const hit = press("e");
    expect(palette.focusEditorKey).toHaveBeenCalled();
    expect(hit.preventDefault).toHaveBeenCalled();
    expect(hit.stopPropagation).toHaveBeenCalled();
    for (const miss of [press("k"), press("Enter"), press("t")]) {
      expect(miss.preventDefault).not.toHaveBeenCalled();
      expect(miss.stopPropagation).not.toHaveBeenCalled();
    }
  });
});
