// What a keydown means to the app: a palette, the editor, or a tab.
export type Shortcut =
  | { kind: "palette"; palette: "commands" | "connections" }
  | { kind: "editor" }
  | { kind: "tab"; n: number }; // 1–9; 9 means the last tab

// ⇧⌘P and ⌘P (Ctrl on other platforms) open the palettes, ⌘E the editor,
// ⌘1–⌘9 a tab. The modifier is the one the other app keys use. Digits go by
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
  if (key === "e") return { kind: "editor" };
  const digit = /^Digit([1-9])$/.exec(e.code);
  return digit ? { kind: "tab", n: Number(digit[1]) } : null;
}
