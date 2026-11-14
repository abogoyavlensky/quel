import { focusEditor } from "@/editor/states";
import { modalOpen } from "./palette";
import { store } from "./store";

// The Settings dialog (components/SettingsDialog.tsx): ⌘, or the palette's
// Settings…. Not under another dialog or a palette, where the keys belong
// to that one; a pick from the palette closes the palette before it runs,
// so that way opens.

// Where focus was when it opened. A Radix dialog gives focus back only to
// its trigger, and this one has none.
let before: HTMLElement | null = null;

export function openSettings(): void {
  const s = store.getState();
  if (modalOpen(s)) return;
  before = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
  store.setState({ settingsOpen: true });
}

export function closeSettings(): void {
  store.setState({ settingsOpen: false });
}

// After it closes: back to where focus was, or to the editor when that is
// gone or was nothing (the body, as after a pick from the palette).
export function restoreSettingsFocus(): void {
  const el = before;
  before = null;
  if (el?.isConnected && el !== document.body) el.focus();
  else focusEditor();
}
