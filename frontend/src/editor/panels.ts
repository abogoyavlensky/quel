import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import { type Command, EditorView, type KeyBinding, type Panel, type ViewUpdate, showPanel } from "@codemirror/view";

// The editor's Find and Go to Line panels. They are CodeMirror panels, so
// each tab's EditorState carries its own (open or not, and the query), and
// view.setState on a tab switch rebuilds them. Their dom is an empty div:
// React draws the controls into it through portals (EditorPanels.tsx),
// which follow the hosts registered here. Both dock at the top, clear of
// the Run button, and only one is open at a time.

export type PanelKind = "find" | "goto";
export interface PanelHost {
  kind: PanelKind;
  dom: HTMLElement;
  view: EditorView;
  focus: boolean; // a command opened it: its field takes focus
}
export interface PanelSnapshot {
  find: PanelHost | null;
  goto: PanelHost | null;
  rev: number;
}

// One EditorView exists for the app's life (SqlEditor), so one host per kind.
let snapshot: PanelSnapshot = { find: null, goto: null, rev: 0 };
const listeners = new Set<() => void>();

export function subscribePanels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function panelSnapshot(): PanelSnapshot {
  return snapshot;
}

function publish(next: PanelSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

function setHost(kind: PanelKind, host: PanelHost | null) {
  publish({ ...snapshot, [kind]: host, rev: snapshot.rev + 1 });
}

function bump() {
  publish({ ...snapshot, rev: snapshot.rev + 1 });
}

// Set by the open commands for the dispatch that creates a panel: a panel
// rebuilt by a tab switch leaves the caret in the editor.
let focusNext = false;

function hostPanel(kind: PanelKind, view: EditorView, changed: (u: ViewUpdate) => boolean): Panel {
  const dom = document.createElement("div");
  dom.className = kind === "find" ? "cm-quel-panel cm-search" : "cm-quel-panel cm-goto-line";
  setHost(kind, { kind, dom, view, focus: focusNext });
  focusNext = false;
  return {
    dom,
    top: true,
    update(u) {
      if (changed(u)) bump();
    },
    destroy() {
      if (snapshot[kind]?.dom === dom) setHost(kind, null);
    },
  };
}

const queryChanged = (u: ViewUpdate) =>
  u.docChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)));

function createFindPanel(view: EditorView): Panel {
  return hostPanel("find", view, queryChanged);
}

export const findExtension = search({ top: true, createPanel: createFindPanel });

const toggleGoTo = StateEffect.define<boolean>();

function createGoToPanel(view: EditorView): Panel {
  return hostPanel("goto", view, (u) => u.docChanged || u.selectionSet);
}

export const goToLineField = StateField.define<boolean>({
  create: () => false,
  update(open, tr) {
    for (const e of tr.effects) if (e.is(toggleGoTo)) open = e.value;
    return open;
  },
  provide: (f) => showPanel.from(f, (open) => (open ? createGoToPanel : null)),
});

const goToOpen = (view: EditorView) => view.state.field(goToLineField, false) === true;

function mainField(kind: PanelKind): HTMLInputElement | null {
  return snapshot[kind]?.dom.querySelector<HTMLInputElement>("[main-field]") ?? null;
}

function withFocus(run: () => void) {
  focusNext = true;
  try {
    run();
  } finally {
    focusNext = false;
  }
}

export const closeGoToLine: Command = (view) => {
  if (!goToOpen(view)) return false;
  if (snapshot.goto?.dom.contains(view.root.activeElement)) view.focus();
  view.dispatch({ effects: toggleGoTo.of(false) });
  return true;
};

export const openFind: Command = (view) => {
  closeGoToLine(view);
  const field = searchPanelOpen(view.state) ? mainField("find") : null;
  // openSearchPanel does nothing while its field has focus: ⌘F re-selects.
  if (field && field === view.root.activeElement) {
    field.select();
    return true;
  }
  let handled = false;
  withFocus(() => {
    handled = openSearchPanel(view);
  });
  return handled;
};

export const openGoToLine: Command = (view) => {
  if (goToOpen(view)) {
    mainField("goto")?.select();
    return true;
  }
  closeSearchPanel(view);
  withFocus(() => view.dispatch({ effects: toggleGoTo.of(true) }));
  return true;
};

// Moves the cursor to pos, centred, and closes Go to Line.
export function goToLine(view: EditorView, pos: number) {
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: [toggleGoTo.of(false), EditorView.scrollIntoView(pos, { y: "center" })],
  });
  view.focus();
}

// findNext and findPrevious open the stock way (openSearchPanel) when the
// query is empty or invalid: through openFind instead, so the field takes
// focus and Go to Line closes.
const viaFind =
  (cmd: Command): Command =>
  (view) =>
    getSearchQuery(view.state).valid ? cmd(view) : openFind(view);

const scope = "editor search-panel goto-panel";
export const panelKeymap: KeyBinding[] = [
  { key: "Mod-f", run: openFind, scope, preventDefault: true },
  { key: "Mod-Alt-g", run: openGoToLine, scope, preventDefault: true },
  { key: "Mod-g", run: viaFind(findNext), shift: viaFind(findPrevious), scope, preventDefault: true },
  { key: "F3", run: viaFind(findNext), shift: viaFind(findPrevious), scope, preventDefault: true },
];

// The keys searchKeymap binds that panelKeymap replaces.
export const replacedKeys = ["Mod-f", "Mod-Alt-g", "Mod-g", "F3"];
