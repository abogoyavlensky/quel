import { describe, expect, it } from "vitest";
import { shortcutOf } from "./shortcuts";

type Ev = Parameters<typeof shortcutOf>[0];
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

describe("shortcutOf", () => {
  it("opens Go to Connection on ⌘P and Ctrl+P", () => {
    expect(shortcutOf(ev("p", cmd), true)).toEqual({ kind: "palette", palette: "connections" });
    expect(shortcutOf(ev("p", ctrl), false)).toEqual({ kind: "palette", palette: "connections" });
  });

  it("opens the Command Palette on ⇧⌘P, whatever the case of key", () => {
    expect(shortcutOf(ev("P", { ...cmd, shiftKey: true }), true)).toEqual({ kind: "palette", palette: "commands" });
    expect(shortcutOf(ev("p", { ...ctrl, shiftKey: true }), false)).toEqual({ kind: "palette", palette: "commands" });
  });

  it("focuses the editor on ⌘E", () => {
    expect(shortcutOf(ev("e", cmd), true)).toEqual({ kind: "editor" });
    expect(shortcutOf(ev("e", ctrl), false)).toEqual({ kind: "editor" });
  });

  it("hides and shows the sidebar on ⌘B", () => {
    expect(shortcutOf(ev("b", cmd), true)).toEqual({ kind: "sidebar" });
    expect(shortcutOf(ev("b", ctrl), false)).toEqual({ kind: "sidebar" });
    expect(shortcutOf(ev("B", { ...cmd, shiftKey: true }), true)).toBeNull();
    expect(shortcutOf(ev("b", { ...cmd, altKey: true }), true)).toBeNull();
  });

  it("picks a tab on ⌘1–⌘9, by code", () => {
    expect(shortcutOf(ev("1", { ...cmd, code: "Digit1" }), true)).toEqual({ kind: "tab", n: 1 });
    expect(shortcutOf(ev("&", { ...cmd, code: "Digit1" }), true)).toEqual({ kind: "tab", n: 1 });
    expect(shortcutOf(ev("9", { ...ctrl, code: "Digit9" }), false)).toEqual({ kind: "tab", n: 9 });
  });

  it("wants the platform's modifier", () => {
    expect(shortcutOf(ev("p", ctrl), true)).toBeNull();
    expect(shortcutOf(ev("p", cmd), false)).toBeNull();
    expect(shortcutOf(ev("e", { ...cmd, ...ctrl }), true)).toBeNull();
    expect(shortcutOf(ev("p"), true)).toBeNull();
  });

  it("ignores Alt, Shift with a digit or E, and keys that are not ours", () => {
    expect(shortcutOf(ev("p", { ...cmd, altKey: true }), true)).toBeNull();
    expect(shortcutOf(ev("!", { ...cmd, shiftKey: true, code: "Digit1" }), true)).toBeNull();
    expect(shortcutOf(ev("E", { ...cmd, shiftKey: true }), true)).toBeNull();
    expect(shortcutOf(ev("0", { ...cmd, code: "Digit0" }), true)).toBeNull();
    expect(shortcutOf(ev("k", cmd), true)).toBeNull();
  });
});
