import { describe, expect, it } from "vitest";
import { connectionWords, exportWords, runWords } from "./status";
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
  sort: null,
  unsorted: null,
  find: null,
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

describe("exportWords", () => {
  it("says nothing with no export, or before rows are moving", () => {
    expect(exportWords(tab())).toBeNull();
    expect(exportWords(tab({ exporting: { action: "save", rows: null, total: 0 } }))).toBeNull();
  });

  it("counts the rows", () => {
    expect(exportWords(tab({ exporting: { action: "save", rows: 12500, total: 100000 } }))).toBe(
      "Saving 12,500 of 100,000 rows…",
    );
    expect(exportWords(tab({ exporting: { action: "copy", rows: 0, total: 100000 } }))).toBe(
      "Copying 0 of 100,000 rows…",
    );
  });
});
