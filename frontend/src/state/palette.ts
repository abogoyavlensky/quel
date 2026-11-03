import { focusEditor } from "@/editor/states";
import { selectTab } from "@/state/runner";
import { toggleSidebar } from "./layout";
import { store, selectedWorkspace, showsResult, type AppState } from "@/state/store";

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
// grid is mounted).
export function focusResult(): void {
  document.querySelector<HTMLElement>("[data-result-grid]")?.focus();
}

// ⌘R: the grid of the result the current tab shows. Nothing on Messages,
// with no result, or under a dialog. The selected row stays as it is.
export function focusResultKey(): void {
  const s = store.getState();
  if (!modalOpen(s) && showsResult(s)) focusResult();
}

// ⌘B: hide or show the sidebar (layout.ts does nothing without a tab
// strip).
export function toggleSidebarKey(): void {
  if (!modalOpen(store.getState())) toggleSidebar();
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
