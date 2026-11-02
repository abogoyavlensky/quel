import { focusEditor } from "@/editor/states";
import * as api from "@/lib/api";
import { type AppState, selectedWorkspace, store } from "./store";

// Whether the left sidebar (the connections and the structure tree) shows.
// The user hides and shows it (⌘B, the tab strip's button, the Command
// Palette), and the choice is saved app-wide. It always shows when there
// is no tab strip: with no connections, on a failed tab load, while tabs
// load. The button lives in the strip, so without the strip nothing would
// bring the sidebar back; the saved choice applies again once a workspace
// loads.

// AppShell draws the tab strip, with the editor under it, exactly then.
export function hasTabStrip(s: AppState): boolean {
  const w = selectedWorkspace(s);
  return w !== undefined && !w.loadError;
}

export function sidebarShown(s: AppState): boolean {
  return s.sidebarHidden !== true || !hasTabStrip(s);
}

// The saved choice, at start-up. A toggle made before the answer arrives
// wins; a failed read leaves the sidebar shown.
export async function loadSidebar(): Promise<void> {
  let hidden: boolean;
  try {
    hidden = await api.sidebarHidden();
  } catch {
    return;
  }
  if (store.getState().sidebarHidden === null) store.setState({ sidebarHidden: hidden });
}

// Saves go one after another: the backend runs bridge calls concurrently,
// so two quick toggles could otherwise land in the wrong order.
let saving: Promise<void> = Promise.resolve();

// Hide or show it, and save the choice in the background; a failed save
// is dropped (the next start shows the old choice). Nothing to do without
// a tab strip. Hiding it with focus inside moves focus to the editor
// rather than letting it fall to the page.
export function toggleSidebar(): void {
  const s = store.getState();
  if (!hasTabStrip(s)) return;
  const hidden = sidebarShown(s);
  store.setState({ sidebarHidden: hidden });
  saving = saving.then(() => api.setSidebarHidden(hidden)).catch(() => {});
  if (hidden && document.activeElement?.closest("[data-quel-sidebar]")) setTimeout(focusEditor);
}
