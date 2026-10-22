import { type Statement, split } from "./split";

// Which statements a run sends, given the editor's text and selection.

export interface Range {
  from: number;
  to: number;
}

export type RunMode = "statement" | "script";

// The statement under the cursor: the one containing it, the cursor just
// after its `;` included; otherwise the nearest one before it; otherwise
// the first one after it.
export function statementAt(statements: Statement[], pos: number): Statement | undefined {
  const around = statements.find((s) => s.from <= pos && pos <= s.to + 1);
  if (around) return around;
  const before = statements.filter((s) => s.to < pos);
  if (before.length > 0) return before[before.length - 1];
  return statements.find((s) => s.from > pos);
}

// "statement" (Mod-Enter): a non-empty selection runs every statement in
// it, otherwise the statement under the cursor. "script" (Shift-Mod-Enter):
// every statement in the document. Offsets are always document offsets.
export function toRun(text: string, selection: Range, mode: RunMode): Statement[] {
  if (mode === "script") return split(text);
  if (selection.from !== selection.to) {
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    return split(text.slice(from, to)).map((s) => ({ ...s, from: s.from + from, to: s.to + from }));
  }
  const s = statementAt(split(text), selection.from);
  return s ? [s] : [];
}
