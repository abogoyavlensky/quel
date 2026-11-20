import { focusEditor } from "@/editor/states";
import { modalOpen } from "./palette";
import { store } from "./store";

// The About dialog (components/AboutDialog.tsx): Quel > About Quel… or
// the palette's About Quel. Like Settings (state/settings.ts): not under
// another dialog or a palette, and focus goes back where it was on close.
// The native menu may deliver the click twice; opening sets the state, so
// the second delivery does nothing.

let before: HTMLElement | null = null;

export function openAbout(): void {
  const s = store.getState();
  if (modalOpen(s)) return;
  before = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
  store.setState({ aboutOpen: true });
}

export function closeAbout(): void {
  store.setState({ aboutOpen: false });
}

// After it closes: back to where focus was, or to the editor when that is
// gone or was nothing.
export function restoreAboutFocus(): void {
  const el = before;
  before = null;
  if (el?.isConnected && el !== document.body) el.focus();
  else focusEditor();
}
