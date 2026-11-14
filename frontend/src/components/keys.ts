// Shortcut labels as the platform writes them.
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// The app's modifier held (⌘ on macOS, Ctrl elsewhere), without Alt; Shift may be.
export const modKey = (e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey">) =>
  (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey;
export const RUN_KEY = isMac ? "⌘↵" : "Ctrl+Enter";
export const ROW_KEY = isMac ? "⌘I" : "Ctrl+I";
export const SCRIPT_KEY = isMac ? "⇧⌘↵" : "Ctrl+Shift+Enter";
export const STOP_KEY = isMac ? "⌘." : "Ctrl+.";
export const NEW_TAB_KEY = isMac ? "⌘T" : "Ctrl+T";
export const CLOSE_TAB_KEY = isMac ? "⌘W" : "Ctrl+W";
export const REOPEN_KEY = isMac ? "⇧⌘T" : "Ctrl+Shift+T";
export const PALETTE_KEY = isMac ? "⇧⌘P" : "Ctrl+Shift+P";
export const GOTO_KEY = isMac ? "⌘P" : "Ctrl+P";
export const FOCUS_KEY = isMac ? "⌘E" : "Ctrl+E";
export const RESULT_KEY = isMac ? "⌘R" : "Ctrl+R";
export const SIDEBAR_KEY = isMac ? "⌘B" : "Ctrl+B";
export const RESULTS_PANE_KEY = isMac ? "⌘J" : "Ctrl+J";
export const ZOOM_IN_KEY = isMac ? "⌘=" : "Ctrl+=";
export const ZOOM_OUT_KEY = isMac ? "⌘-" : "Ctrl+-";
export const ZOOM_RESET_KEY = isMac ? "⌘0" : "Ctrl+0";
export const FIND_KEY = isMac ? "⌘F" : "Ctrl+F";
export const FIND_NEXT_KEY = isMac ? "⌘G" : "Ctrl+G";
export const FIND_PREV_KEY = isMac ? "⇧⌘G" : "Ctrl+Shift+G";
export const GO_TO_LINE_KEY = isMac ? "⌥⌘G" : "Ctrl+Alt+G";

// A key binding as the registry (state/keymap.ts) writes it, for one
// platform: modifiers, then the key, joined by "-", in CodeMirror's style.
// The modifiers are Cmd (⌘, macOS only), Ctrl, Alt and Shift, written in
// that order. The key is a lower-case letter, a digit, a named key (Enter,
// PageUp, F3) or a punctuation character. "Cmd--" is Cmd plus "-": the
// split leaves a trailing dash alone.
interface Parsed {
  cmd: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function parse(binding: string): Parsed {
  const parts = binding.split(/-(?!$)/);
  const key = parts.pop()!;
  const has = (m: string) => parts.includes(m);
  return { cmd: has("Cmd"), ctrl: has("Ctrl"), alt: has("Alt"), shift: has("Shift"), key };
}

const isLetter = (k: string) => /^[a-z]$/.test(k);

// The label a binding shows. macOS: ⌃⌥⇧⌘ in that order, then the key, no
// separator, Enter as ↵. Elsewhere: Ctrl, Alt, Shift and the key joined by
// "+". Letters are upper-case; other keys show as written.
export function formatKey(binding: string, mac: boolean): string {
  const b = parse(binding);
  const key = isLetter(b.key) ? b.key.toUpperCase() : mac && b.key === "Enter" ? "↵" : b.key;
  if (mac) {
    return (b.ctrl ? "⌃" : "") + (b.alt ? "⌥" : "") + (b.shift ? "⇧" : "") + (b.cmd ? "⌘" : "") + key;
  }
  const mods = [b.cmd && "Cmd", b.ctrl && "Ctrl", b.alt && "Alt", b.shift && "Shift"].filter(Boolean);
  return [...mods, key].join("+");
}

// Whether a keydown is the binding. The binding is already the platform's,
// so Cmd is metaKey and Ctrl is ctrlKey, and all four modifiers must match
// exactly: present when written, absent when not. Digits go by e.code,
// because Shift or the keyboard layout can change e.key; letters by e.key
// in lower case; anything else by e.key.
export function matchesKey(
  e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  binding: string,
): boolean {
  const b = parse(binding);
  if (e.metaKey !== b.cmd || e.ctrlKey !== b.ctrl || e.altKey !== b.alt || e.shiftKey !== b.shift) return false;
  if (/^[0-9]$/.test(b.key)) return e.code === `Digit${b.key}`;
  if (isLetter(b.key)) return e.key.toLowerCase() === b.key;
  return e.key === b.key;
}
