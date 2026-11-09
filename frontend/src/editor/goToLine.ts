import type { EditorState } from "@codemirror/state";

// Where a Go to Line input points: a line number, a relative offset (+5,
// -3), a percentage of the document (50%, or +10% from the cursor's line),
// and an optional column (12:8, or :8 on the cursor's line). Ported from
// @codemirror/search's gotoLine (MIT), which dispatches instead of
// returning. Unlike it, a blank input is an error, not the current line.

const SPEC = /^([+-])?(\d+)?(:\d+)?(%)?$/;

export function goToLineTarget(state: EditorState, input: string): number | null {
  const text = input.trim();
  const match = text === "" ? null : SPEC.exec(text);
  if (!match) return null;
  const startLine = state.doc.lineAt(state.selection.main.head);
  const [, sign, ln, cl, percent] = match;
  const col = cl ? +cl.slice(1) : 0;
  let line = ln ? +ln : startLine.number;
  if (ln && percent) {
    let pc = line / 100;
    if (sign) pc = pc * (sign === "-" ? -1 : 1) + startLine.number / state.doc.lines;
    line = Math.round(state.doc.lines * pc);
  } else if (ln && sign) {
    line = line * (sign === "-" ? -1 : 1) + startLine.number;
  }
  const docLine = state.doc.line(Math.max(1, Math.min(state.doc.lines, line)));
  return docLine.from + Math.max(0, Math.min(col, docLine.length));
}
