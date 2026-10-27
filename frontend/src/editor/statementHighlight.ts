import { StateField } from "@codemirror/state";
import { EditorView, RectangleMarker, layer } from "@codemirror/view";
import { type Statement, split } from "@/sql/split";
import { statementUnder } from "@/sql/target";

// A soft rounded block behind the statement Mod-Enter will run: the same
// one toRun picks (sql/target.ts), none while text is selected. It is a
// layer below the text with one rectangle over whole lines, so it reads as
// one card; per-line decorations would look banded.

// Keeps the block off the gutter's border and the right edge.
const INSET = 4;

// The document's statements, split again only when the text changes. A
// selection change just looks the statement up.
const statements = StateField.define<Statement[]>({
  create: (state) => split(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? split(tr.newDoc.toString()) : value),
});

const block = layer({
  above: false,
  class: "cm-statementLayer",
  update: (u) => u.docChanged || u.selectionSet || u.viewportChanged || u.geometryChanged,
  markers(view: EditorView) {
    const s = statementUnder(view.state.field(statements), view.state.selection.main);
    if (!s) return [];
    const doc = view.state.doc;
    // Positions are relative to the scroller's content, as CodeMirror's own
    // layers compute them. The editor is never transformed, so scale is 1.
    const sr = view.scrollDOM.getBoundingClientRect();
    const cr = view.contentDOM.getBoundingClientRect();
    const baseLeft = sr.left - view.scrollDOM.scrollLeft;
    const baseTop = sr.top - view.scrollDOM.scrollTop;
    const top = view.documentTop + view.lineBlockAt(doc.lineAt(s.from).from).top - baseTop;
    const bottom = view.documentTop + view.lineBlockAt(doc.lineAt(s.to).from).bottom - baseTop;
    return [new RectangleMarker("cm-currentStatement", cr.left - baseLeft + INSET, top, cr.width - 2 * INSET, bottom - top)];
  },
});

export const statementHighlight = [statements, block];
