import { describe, expect, it } from "vitest";
import { formatKey, matchesKey } from "./keys";

type Ev = Parameters<typeof matchesKey>[0];
const ev = (key: string, patch: Partial<Ev> = {}): Ev => ({
  key,
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...patch,
});

describe("formatKey", () => {
  // The labels the app showed before the registry, on both platforms.
  it.each([
    ["Cmd-Enter", "⌘↵", "Ctrl-Enter", "Ctrl+Enter"],
    ["Cmd-i", "⌘I", "Ctrl-i", "Ctrl+I"],
    ["Cmd-Shift-Enter", "⇧⌘↵", "Ctrl-Shift-Enter", "Ctrl+Shift+Enter"],
    ["Cmd-.", "⌘.", "Ctrl-.", "Ctrl+."],
    ["Cmd-t", "⌘T", "Ctrl-t", "Ctrl+T"],
    ["Cmd-w", "⌘W", "Ctrl-w", "Ctrl+W"],
    ["Cmd-Shift-t", "⇧⌘T", "Ctrl-Shift-t", "Ctrl+Shift+T"],
    ["Cmd-Shift-p", "⇧⌘P", "Ctrl-Shift-p", "Ctrl+Shift+P"],
    ["Cmd-p", "⌘P", "Ctrl-p", "Ctrl+P"],
    ["Cmd-e", "⌘E", "Ctrl-e", "Ctrl+E"],
    ["Cmd-r", "⌘R", "Ctrl-r", "Ctrl+R"],
    ["Cmd-b", "⌘B", "Ctrl-b", "Ctrl+B"],
    ["Cmd-j", "⌘J", "Ctrl-j", "Ctrl+J"],
    ["Cmd-=", "⌘=", "Ctrl-=", "Ctrl+="],
    ["Cmd--", "⌘-", "Ctrl--", "Ctrl+-"],
    ["Cmd-0", "⌘0", "Ctrl-0", "Ctrl+0"],
    ["Cmd-f", "⌘F", "Ctrl-f", "Ctrl+F"],
    ["Cmd-g", "⌘G", "Ctrl-g", "Ctrl+G"],
    ["Cmd-Shift-g", "⇧⌘G", "Ctrl-Shift-g", "Ctrl+Shift+G"],
    ["Cmd-Alt-g", "⌥⌘G", "Ctrl-Alt-g", "Ctrl+Alt+G"],
    ["Cmd-PageUp", "⌘PageUp", "Ctrl-PageUp", "Ctrl+PageUp"],
    ["Cmd-,", "⌘,", "Ctrl-,", "Ctrl+,"],
  ])("%s is %s; %s is %s", (mac, macLabel, other, otherLabel) => {
    expect(formatKey(mac, true)).toBe(macLabel);
    expect(formatKey(other, false)).toBe(otherLabel);
  });

  it("writes Control on macOS as ⌃, before the other modifiers", () => {
    expect(formatKey("Ctrl-Tab", true)).toBe("⌃Tab");
    expect(formatKey("Cmd-Ctrl-Alt-Shift-f", true)).toBe("⌃⌥⇧⌘F");
  });

  it("shows a bare key as written", () => {
    expect(formatKey("F3", false)).toBe("F3");
    expect(formatKey("Shift-F3", true)).toBe("⇧F3");
  });
});

describe("matchesKey", () => {
  it("wants Cmd as Meta alone, and Ctrl as Ctrl alone", () => {
    expect(matchesKey(ev("b", { metaKey: true }), "Cmd-b")).toBe(true);
    expect(matchesKey(ev("b", { metaKey: true, ctrlKey: true }), "Cmd-b")).toBe(false);
    expect(matchesKey(ev("b", { ctrlKey: true }), "Cmd-b")).toBe(false);
    expect(matchesKey(ev("b", { ctrlKey: true }), "Ctrl-b")).toBe(true);
    expect(matchesKey(ev("b", { ctrlKey: true, metaKey: true }), "Ctrl-b")).toBe(false);
    expect(matchesKey(ev("b"), "Ctrl-b")).toBe(false);
  });

  it("refuses an extra Shift or Alt", () => {
    expect(matchesKey(ev("B", { metaKey: true, shiftKey: true }), "Cmd-b")).toBe(false);
    expect(matchesKey(ev("b", { metaKey: true, altKey: true }), "Cmd-b")).toBe(false);
  });

  it("takes a letter in either case, with Shift only when written", () => {
    expect(matchesKey(ev("P", { metaKey: true, shiftKey: true }), "Cmd-Shift-p")).toBe(true);
    expect(matchesKey(ev("P", { metaKey: true, shiftKey: true }), "Cmd-p")).toBe(false);
    expect(matchesKey(ev("p", { metaKey: true }), "Cmd-Shift-p")).toBe(false);
  });

  it("matches digits by code", () => {
    expect(matchesKey(ev("&", { metaKey: true, code: "Digit1" }), "Cmd-1")).toBe(true);
    expect(matchesKey(ev("1", { metaKey: true, code: "Numpad1" }), "Cmd-1")).toBe(false);
  });

  it("matches named and punctuation keys by key", () => {
    expect(matchesKey(ev("-", { metaKey: true }), "Cmd--")).toBe(true);
    expect(matchesKey(ev(",", { ctrlKey: true }), "Ctrl-,")).toBe(true);
    expect(matchesKey(ev("PageUp", { ctrlKey: true }), "Ctrl-PageUp")).toBe(true);
    expect(matchesKey(ev("F3", { shiftKey: true }), "Shift-F3")).toBe(true);
    expect(matchesKey(ev("F3"), "Shift-F3")).toBe(false);
  });
});
