import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { goToLineTarget } from "./goToLine";

// Ten lines, "line 1" to "line 10", cursor on line 4.
const doc = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
const state = EditorState.create({ doc, selection: EditorSelection.cursor(doc.indexOf("line 4") + 2) });
const lineStart = (n: number) => state.doc.line(n).from;

describe("goToLineTarget", () => {
  it.each([
    ["7", lineStart(7)],
    ["+2", lineStart(6)],
    ["-3", lineStart(1)],
    ["50%", lineStart(5)],
    ["+10%", lineStart(5)],
    ["3:2", lineStart(3) + 2],
    [":2", lineStart(4) + 2],
    ["99", lineStart(10)],
    ["0", lineStart(1)],
    ["2:99", state.doc.line(2).to],
    [" 7 ", lineStart(7)],
  ])("goes to %j", (input, pos) => {
    expect(goToLineTarget(state, input)).toBe(pos);
  });

  it.each(["", "  ", "abc", "1:2:3"])("rejects %j", (input) => {
    expect(goToLineTarget(state, input)).toBeNull();
  });
});
