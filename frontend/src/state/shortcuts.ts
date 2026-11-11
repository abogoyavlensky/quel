// What a keydown means to the app: a palette, the editor, the result, a
// tab, the previous or next tab, the sidebar, or the results pane.
export type Shortcut =
  | { kind: "palette"; palette: "commands" | "connections" }
  | { kind: "editor" }
  | { kind: "result" }
  | { kind: "sidebar" }
  | { kind: "resultsPane" }
  | { kind: "tab"; n: number } // 1–9; 9 means the last tab
  | { kind: "cycle"; dir: -1 | 1 }; // ⌘PageUp: -1, ⌘PageDown: 1

// ⇧⌘P and ⌘P (Ctrl on other platforms) open the palettes, ⌘E the editor,
// ⌘R the result grid, ⌘1–⌘9 a tab, ⌘PageUp and ⌘PageDown the previous and
// next tab, ⌘B hides or shows the sidebar, ⌘J the results pane. The modifier is the one the other app keys use. Digits go by
// e.code: Shift or the keyboard layout can change e.key.
export function shortcutOf(
  e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  mac: boolean,
): Shortcut | null {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === "p") return { kind: "palette", palette: e.shiftKey ? "commands" : "connections" };
  if (e.shiftKey) return null;
  if (e.key === "PageUp") return { kind: "cycle", dir: -1 };
  if (e.key === "PageDown") return { kind: "cycle", dir: 1 };
  if (key === "e") return { kind: "editor" };
  if (key === "r") return { kind: "result" };
  if (key === "b") return { kind: "sidebar" };
  if (key === "j") return { kind: "resultsPane" };
  const digit = /^Digit([1-9])$/.exec(e.code);
  return digit ? { kind: "tab", n: Number(digit[1]) } : null;
}
