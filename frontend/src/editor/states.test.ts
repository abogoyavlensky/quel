import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { currentInput, dropState, mountView, seed, seedOf, textOf, unmountView } from "./states";
import { newState } from "./setup";

// An EditorView needs a DOM; the module reads only its state.
const fakeView = (state: EditorState) => ({ state }) as unknown as EditorView;

describe("editor states", () => {
  it("reports a seeded, never-mounted tab's text and selection", () => {
    seed("s1", "select 1", { from: 2, to: 5 });
    expect(currentInput("s1")).toEqual({ text: "select 1", selection: { from: 2, to: 5 } });
    expect(textOf("s1")).toBe("select 1");
    dropState("s1");
    expect(seedOf("s1")).toBeUndefined();
    expect(textOf("s1")).toBe("");
  });

  it("prefers the mounted view, then the kept state, to the seed", () => {
    seed("s2", "old");
    const state = EditorState.create({ doc: "newer", selection: EditorSelection.single(1, 3) });
    mountView("s2", fakeView(state));
    expect(currentInput("s2")).toEqual({ text: "newer", selection: { from: 1, to: 3 } });
    unmountView("s2");
    expect(textOf("s2")).toBe("newer");
    dropState("s2");
  });

  it("starts a seeded state from the seed, its selection clamped", () => {
    const s = newState("sqlite", { text: "abc", from: 1, to: 99 });
    expect(s.doc.toString()).toBe("abc");
    expect([s.selection.main.from, s.selection.main.to]).toEqual([1, 3]);
    expect(newState(null).doc.toString()).toBe("");
  });
});
