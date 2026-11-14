/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KEYMAP, type KeyEntry, keyFor, keyLabel } from "./keymap";

type Ev = Parameters<typeof keyFor>[0];
const ev = (key: string, patch: Partial<Ev> = {}): Ev => ({
  key,
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...patch,
});
const cmd = { metaKey: true };
const ctrl = { ctrlKey: true };
const entries: readonly KeyEntry[] = KEYMAP;

describe("keyFor", () => {
  it("opens Go to Connection on ⌘P and Ctrl+P", () => {
    expect(keyFor(ev("p", cmd), true)).toEqual({ id: "go-to-connection", index: 0 });
    expect(keyFor(ev("p", ctrl), false)).toEqual({ id: "go-to-connection", index: 0 });
  });

  it("opens the Command Palette on ⇧⌘P, whatever the case of key", () => {
    expect(keyFor(ev("P", { ...cmd, shiftKey: true }), true)).toEqual({ id: "command-palette", index: 0 });
    expect(keyFor(ev("p", { ...ctrl, shiftKey: true }), false)).toEqual({ id: "command-palette", index: 0 });
  });

  it("focuses the editor on ⌘E", () => {
    expect(keyFor(ev("e", cmd), true)?.id).toBe("focus-editor");
    expect(keyFor(ev("e", ctrl), false)?.id).toBe("focus-editor");
  });

  it("focuses the result on ⌘R", () => {
    expect(keyFor(ev("r", cmd), true)?.id).toBe("focus-result");
    expect(keyFor(ev("r", ctrl), false)?.id).toBe("focus-result");
    expect(keyFor(ev("R", { ...cmd, shiftKey: true }), true)).toBeNull();
  });

  it("hides and shows the sidebar on ⌘B", () => {
    expect(keyFor(ev("b", cmd), true)?.id).toBe("sidebar");
    expect(keyFor(ev("b", ctrl), false)?.id).toBe("sidebar");
    expect(keyFor(ev("B", { ...cmd, shiftKey: true }), true)).toBeNull();
    expect(keyFor(ev("b", { ...cmd, altKey: true }), true)).toBeNull();
  });

  it("hides and shows the results on ⌘J, and on Ctrl+J off macOS", () => {
    expect(keyFor(ev("j", cmd), true)?.id).toBe("results");
    expect(keyFor(ev("j", ctrl), false)?.id).toBe("results");
    expect(keyFor(ev("j", ctrl), true)).toBeNull();
    expect(keyFor(ev("J", { ...cmd, shiftKey: true }), true)).toBeNull();
    expect(keyFor(ev("j", { ...cmd, altKey: true }), true)).toBeNull();
  });

  it("picks a tab on ⌘1–⌘8 and the last on ⌘9, by code", () => {
    expect(keyFor(ev("1", { ...cmd, code: "Digit1" }), true)).toEqual({ id: "go-to-tab", index: 0 });
    expect(keyFor(ev("&", { ...cmd, code: "Digit1" }), true)).toEqual({ id: "go-to-tab", index: 0 });
    expect(keyFor(ev("3", { ...cmd, code: "Digit3" }), true)).toEqual({ id: "go-to-tab", index: 2 });
    expect(keyFor(ev("8", { ...ctrl, code: "Digit8" }), false)).toEqual({ id: "go-to-tab", index: 7 });
    expect(keyFor(ev("9", { ...ctrl, code: "Digit9" }), false)).toEqual({ id: "last-tab", index: 0 });
  });

  it("wants the platform's modifier", () => {
    expect(keyFor(ev("p", ctrl), true)).toBeNull();
    expect(keyFor(ev("p", cmd), false)).toBeNull();
    expect(keyFor(ev("e", { ...cmd, ...ctrl }), true)).toBeNull();
    expect(keyFor(ev("p"), true)).toBeNull();
  });

  it("ignores Alt, Shift with a digit or E, and keys that are not ours", () => {
    expect(keyFor(ev("p", { ...cmd, altKey: true }), true)).toBeNull();
    expect(keyFor(ev("!", { ...cmd, shiftKey: true, code: "Digit1" }), true)).toBeNull();
    expect(keyFor(ev("E", { ...cmd, shiftKey: true }), true)).toBeNull();
    expect(keyFor(ev("0", { ...cmd, code: "Digit0" }), true)).toBeNull();
    expect(keyFor(ev("k", cmd), true)).toBeNull();
  });

  it("cycles tabs on ⌘PageUp and ⌘PageDown, and on Ctrl off macOS", () => {
    expect(keyFor(ev("PageUp", cmd), true)?.id).toBe("previous-tab");
    expect(keyFor(ev("PageDown", cmd), true)?.id).toBe("next-tab");
    expect(keyFor(ev("PageUp", ctrl), false)?.id).toBe("previous-tab");
    expect(keyFor(ev("PageDown", ctrl), false)?.id).toBe("next-tab");
    expect(keyFor(ev("PageDown", ctrl), true)).toBeNull();
    expect(keyFor(ev("PageDown", { ...cmd, shiftKey: true }), true)).toBeNull();
    expect(keyFor(ev("PageUp", { ...ctrl, altKey: true }), false)).toBeNull();
    expect(keyFor(ev("PageUp"), true)).toBeNull();
    expect(keyFor(ev("PageDown"), false)).toBeNull();
  });

  it("stops on ⌘., toggles row details on ⌘I and opens Settings on ⌘,", () => {
    expect(keyFor(ev(".", cmd), true)?.id).toBe("cancel");
    expect(keyFor(ev(".", ctrl), false)?.id).toBe("cancel");
    expect(keyFor(ev("i", cmd), true)?.id).toBe("row-details");
    expect(keyFor(ev("I", { ...cmd, shiftKey: true }), true)).toBeNull();
    expect(keyFor(ev(",", cmd), true)?.id).toBe("settings");
    expect(keyFor(ev(",", ctrl), false)?.id).toBe("settings");
  });

  it("leaves the menu's and the editor's keys alone", () => {
    expect(keyFor(ev("t", cmd), true)).toBeNull();
    expect(keyFor(ev("Enter", cmd), true)).toBeNull();
    expect(keyFor(ev("f", ctrl), false)).toBeNull();
    expect(keyFor(ev("=", cmd), true)).toBeNull();
  });
});

describe("KEYMAP", () => {
  it("has unique ids", () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has keys exactly when something catches them, the same number on both platforms", () => {
    for (const e of entries) {
      expect(e.keys.mac.length, e.id).toBe(e.keys.other.length);
      expect(e.keys.mac.length > 0, e.id).toBe(e.caught.length > 0);
    }
  });

  it("writes Cmd only in the macOS keys", () => {
    for (const e of entries) for (const k of e.keys.other) expect(k, e.id).not.toMatch(/(^|-)Cmd-/);
  });
});

describe("keyLabel", () => {
  it("labels the first key, a run first–last, and nothing without keys", () => {
    expect(keyLabel("run", true)).toBe("⌘↵");
    expect(keyLabel("run", false)).toBe("Ctrl+Enter");
    expect(keyLabel("find-next", true)).toBe("⌘G");
    expect(keyLabel("go-to-tab", true)).toBe("⌘1–⌘8");
    expect(keyLabel("go-to-tab", false)).toBe("Ctrl+1–Ctrl+8");
    expect(keyLabel("connect", true)).toBeUndefined();
  });
});

// The native menu's accelerators (src/quel/menu.lg) are a second copy of
// the "menu" keys. CmdOrCtrl is Cmd on macOS and Ctrl elsewhere.
describe("the native menu", () => {
  const menu = readFileSync(new URL("../../../src/quel/menu.lg", import.meta.url), "utf8");
  const accelerators = [...menu.matchAll(/:accelerator "([^"]+)"/g)].map((m) => m[1]);
  const asBinding = (acc: string, mod: string) =>
    acc
      .split(/\+(?!$)/)
      .map((part, i, all) => (part === "CmdOrCtrl" ? mod : i === all.length - 1 && /^[A-Z]$/.test(part) ? part.toLowerCase() : part))
      .join("-");
  const menuKeys = (mac: boolean) =>
    entries.filter((e) => e.caught.includes("menu")).flatMap((e) => (mac ? e.keys.mac : e.keys.other));

  it("has an accelerator for every menu key and no other", () => {
    expect(accelerators.length).toBeGreaterThan(5);
    expect(new Set(accelerators.map((a) => asBinding(a, "Cmd")))).toEqual(new Set(menuKeys(true)));
    expect(new Set(accelerators.map((a) => asBinding(a, "Ctrl")))).toEqual(new Set(menuKeys(false)));
  });
});
