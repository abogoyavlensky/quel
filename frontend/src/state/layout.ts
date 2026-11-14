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
//
// Whether the sidebar's Structure section is collapsed to its header,
// likewise saved app-wide, through the same save chain. Unlike the
// sidebar it toggles with or without a tab strip: its header shows
// whenever the sidebar does. A toggle moves the header (into the
// Structure panel, or under the connections), so focus inside the
// section follows it to the new header.
//
// Whether the results pane shows, likewise (⌘J, the strip's button, the
// Command Palette), but in memory only, as a run brings it back.

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

export function structureCollapsed(s: AppState): boolean {
  return s.structureCollapsed === true;
}

// The saved choice, at start-up, as loadSidebar.
export async function loadStructure(): Promise<void> {
  let collapsed: boolean;
  try {
    collapsed = await api.structureCollapsed();
  } catch {
    return;
  }
  if (store.getState().structureCollapsed === null) store.setState({ structureCollapsed: collapsed });
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

// Collapse or expand the Structure section, and save the choice in the
// background; a failed save is dropped. With focus in the section, the
// new header takes it once drawn.
export function toggleStructure(): void {
  const collapsed = !structureCollapsed(store.getState());
  const refocus = !!document.activeElement?.closest("[data-quel-structure]");
  store.setState({ structureCollapsed: collapsed });
  saving = saving.then(() => api.setStructureCollapsed(collapsed)).catch(() => {});
  if (refocus) setTimeout(() => document.querySelector<HTMLElement>("[data-quel-structure-toggle]")?.focus());
}

// Hide or show the results. Nothing to do without a tab strip: there are no
// results then. Hiding them with focus inside moves focus to the editor.
export function toggleResults(): void {
  const s = store.getState();
  if (!hasTabStrip(s)) return;
  const hidden = !s.resultsHidden;
  store.setState({ resultsHidden: hidden });
  if (hidden && document.activeElement?.closest("[data-quel-results]")) setTimeout(focusEditor);
}

// A run has something to say, or a key wants the grid.
export function showResults(): void {
  store.setState({ resultsHidden: false });
}
