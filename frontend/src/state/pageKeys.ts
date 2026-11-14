import { isMac } from "@/components/keys";
import { keyFor } from "./keymap";
import {
  cycleTabsKey,
  focusEditorKey,
  focusResultKey,
  focusTabKey,
  openPalette,
  toggleResultsKey,
  toggleSidebarKey,
} from "./palette";
import { cancel, selectedTabId, toggleRowDetails } from "./runner";

// What each key the page catches does: the registry's entries caught by
// "page" (state/keymap.ts), by id. The index is which of the entry's keys
// it was (⌘3 is index 2 of go-to-tab).
//
// The native menu has some of these keys too, so in the app window they
// may arrive twice. That is harmless for the palettes (opening sets the
// state, it does not toggle) and for Cancel (it only marks the tab as
// stopping and asks the backend again; a failed ask is swallowed). The
// toggles (⌘I, ⌘B, ⌘J) and the tab keys are the page's alone: a toggle
// cannot take the double delivery, nine "Tab N" items would be clutter,
// ⌘PageUp / ⌘PageDown act on the focused area, which a menu would take
// focus from, and server mode has no native menu. ⌘I is not CodeMirror's
// either: this listener runs in the capture phase, before the editor.
export const PAGE_KEYS: Record<string, (index: number) => void> = {
  "go-to-tab": (i) => focusTabKey(i + 1),
  "last-tab": () => focusTabKey(9),
  "previous-tab": () => cycleTabsKey(-1),
  "next-tab": () => cycleTabsKey(1),
  "focus-editor": () => focusEditorKey(),
  "focus-result": () => focusResultKey(),
  cancel: () => {
    const id = selectedTabId();
    if (id) cancel(id);
  },
  "go-to-connection": () => openPalette("connections"),
  "command-palette": () => openPalette("commands"),
  "row-details": () => toggleRowDetails(),
  sidebar: () => toggleSidebarKey(),
  results: () => toggleResultsKey(),
};

// The page's one keydown listener (App.tsx, capture phase). A key the page
// catches stops here: no default (⌘P would print, ⌘R reload in a browser)
// and no editor. A key whose entry has no action yet is left alone.
export function onPageKey(e: KeyboardEvent): void {
  const hit = keyFor(e, isMac);
  const act = hit && PAGE_KEYS[hit.id];
  if (!act) return;
  e.preventDefault();
  e.stopPropagation();
  act(hit.index);
}
