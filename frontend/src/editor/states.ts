import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Range } from "@/sql/target";

// Each editor tab's CodeMirror state lives here, outside the store: one
// EditorView is mounted at a time (the active tab's), and the others keep
// their EditorState - document, selection, undo history - for when they
// come back. The runner reads a tab's text and selection through
// currentInput.

const saved = new Map<string, EditorState>();
let mounted: { tabId: string; view: EditorView } | null = null;

export function mountView(tabId: string, view: EditorView): void {
  mounted = { tabId, view };
}

export function unmountView(tabId: string): void {
  if (mounted?.tabId === tabId) {
    saved.set(tabId, mounted.view.state);
    mounted = null;
  }
}

export function savedState(tabId: string): EditorState | undefined {
  return saved.get(tabId);
}

export function dropState(tabId: string): void {
  saved.delete(tabId);
  if (mounted?.tabId === tabId) mounted = null;
}

function stateOf(tabId: string): EditorState | undefined {
  return mounted?.tabId === tabId ? mounted.view.state : saved.get(tabId);
}

export function currentInput(tabId: string): { text: string; selection: Range } {
  const state = stateOf(tabId);
  if (!state) return { text: "", selection: { from: 0, to: 0 } };
  const { from, to } = state.selection.main;
  return { text: state.doc.toString(), selection: { from, to } };
}

export function focusEditor(): void {
  mounted?.view.focus();
}
