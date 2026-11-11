import { focusEditor } from "@/editor/states";
import { selectResult, selectTab } from "@/state/runner";
import { showResults, toggleResults, toggleSidebar } from "./layout";
import { MESSAGES, activeTabOf, store, selectedWorkspace, showsResult, type AppState } from "@/state/store";

// The two palettes (components/CommandPalette.tsx, GoToConnection.tsx) and
// the keys that reach the editor and the tabs from anywhere.

// A dialog has the keyboard: the editor and tab keys leave it alone.
export function modalOpen(s: AppState): boolean {
  return s.profileDialog !== null || s.updateDialogOpen || s.runConfirm !== null || s.palette !== null;
}

// Where focus was before the first palette opened. A Radix dialog only
// returns focus to its trigger, and the palettes have none.
let before: HTMLElement | null = null;

// Opens a palette, or switches to the other one. Refused under the profile
// and update dialogs, whether the key or the native menu asks.
export function openPalette(kind: "commands" | "connections"): void {
  const s = store.getState();
  if (s.profileDialog !== null || s.updateDialogOpen || s.runConfirm !== null) return;
  if (s.palette === null) {
    before = document.activeElement as HTMLElement | null;
  }
  store.setState({ palette: kind });
}

export function closePalette(): void {
  store.setState({ palette: null });
}

// After a dismissal: focus returns to where it was, or to the editor when
// that is gone. Not while the other palette is open: a palette that closes
// because the user switched to the other one is not a dismissal, and the
// element is kept for that one.
export function restoreFocus(): void {
  if (store.getState().palette !== null) return;
  const el = before;
  before = null;
  if (el?.isConnected) el.focus();
  else focusEditor();
}

function loadedWorkspace() {
  const s = store.getState();
  if (modalOpen(s)) return undefined;
  const w = selectedWorkspace(s);
  return w && !w.loadError ? w : undefined;
}

// ⌘E: the current tab's editor.
export function focusEditorKey(): void {
  if (loadedWorkspace()) focusEditor();
}

// The active result's grid (ResultGrid marks it; only the active result's
// grid is mounted). Hidden results show first, and the grid is there on the
// next tick.
export function focusResult(): void {
  const focus = () => document.querySelector<HTMLElement>("[data-result-grid]")?.focus();
  if (store.getState().resultsHidden) {
    showResults();
    setTimeout(focus);
  } else focus();
}

// ⌘R: the grid of the result the current tab shows. Nothing without a grid
// (Messages, a result with no rows) or under a dialog. The selected row stays as it is.
export function focusResultKey(): void {
  const s = store.getState();
  if (!modalOpen(s) && showsResult(s)) focusResult();
}

// ⌘B: hide or show the sidebar (layout.ts does nothing without a tab
// strip).
export function toggleSidebarKey(): void {
  if (!modalOpen(store.getState())) toggleSidebar();
}

// ⌘J: hide or show the results (layout.ts does nothing without a tab strip).
export function toggleResultsKey(): void {
  if (!modalOpen(store.getState())) toggleResults();
}

// ⌘1–⌘9: tab n, and its editor; 9 is the last tab, as in browsers.
export function focusTabKey(n: number): void {
  const w = loadedWorkspace();
  if (!w) return;
  const tab = n === 9 ? w.tabs[w.tabs.length - 1] : w.tabs[n - 1];
  if (!tab) return;
  selectTab(tab.id);
  setTimeout(focusEditor);
}

// ⌘PageUp / ⌘PageDown: the previous or next tab, wrapping. While focus is
// in the results pane (AppShell marks it), the current tab's result tabs,
// Messages first; anywhere else, the editor tabs. Focus follows on the
// next tick, so the next press cycles the same strip: the editor, or the
// new result's grid, or (Messages, a result with no rows) its tab button.
// Hidden results have no pane in the page, so the keys cycle editor tabs.
export function cycleTabsKey(dir: -1 | 1): void {
  const w = loadedWorkspace();
  if (!w) return;
  const inResults = document.activeElement?.closest?.("[data-quel-results]");
  const tab = activeTabOf(w);
  const ids = inResults ? [MESSAGES, ...tab.results.map((r) => r.id)] : w.tabs.map((t) => t.id);
  if (ids.length < 2) return;
  const i = ids.indexOf(inResults ? tab.active : tab.id);
  const next = ids[(i + dir + ids.length) % ids.length];
  if (!inResults) {
    selectTab(next);
    setTimeout(focusEditor);
    return;
  }
  selectResult(tab.id, next);
  setTimeout(() => {
    const grid = document.querySelector<HTMLElement>("[data-result-grid]");
    const button = grid
      ? null
      : document.querySelector<HTMLElement>('[data-quel-results] [role="tab"][aria-selected="true"]');
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    (grid ?? button)?.focus();
  });
}
