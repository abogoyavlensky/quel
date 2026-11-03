import { describe, expect, it } from "vitest";
import { connectionWords, runWords } from "./status";
import { type EditorTab, type ResultTab, newWorkspace } from "./store";

const result = (fetching: boolean): ResultTab => ({
  kind: "rows",
  id: "r1",
  sql: "select 1",
  columns: [],
  rows: [],
  cursor: "open",
  fetching,
  pinned: false,
  elapsedMs: 1,
  selectedRow: null,
});

const tab = (patch: Partial<EditorTab> = {}): EditorTab => ({ ...newWorkspace("p").tabs[0], ...patch });

describe("connectionWords", () => {
  it("says the state unless connected", () => {
    expect(connectionWords("disconnected")).toBe("Not connected");
    expect(connectionWords("connecting")).toBe("Connecting…");
    expect(connectionWords("disconnecting")).toBe("Disconnecting…");
    expect(connectionWords("connected")).toBeNull();
  });
});

describe("runWords", () => {
  it("says nothing for an idle tab", () => {
    expect(runWords(tab())).toBeNull();
  });

  it("says Running… while a statement runs", () => {
    expect(runWords(tab({ runningQueryId: "q1", runStartedAt: 1 }))).toBe("Running…");
  });

  it("says Canceling… once a cancel is asked", () => {
    expect(runWords(tab({ runningQueryId: "q1", runStartedAt: 1, stopping: true }))).toBe("Canceling…");
  });

  it("says nothing while a page loads", () => {
    expect(runWords(tab({ runningQueryId: "r1", results: [result(true)] }))).toBeNull();
  });
});
