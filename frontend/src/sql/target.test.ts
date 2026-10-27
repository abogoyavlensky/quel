import { describe, expect, it } from "vitest";
import { split } from "./split";
import { statementAt, statementUnder, toRun } from "./target";

const sql = "select 1;\n\nselect 2;\nselect 3";
const stmts = split(sql);

describe("statementAt", () => {
  it("picks the statement around the cursor", () => {
    expect(statementAt(stmts, sql.indexOf("2"))?.text).toBe("select 2");
  });

  it("picks a statement with the cursor at its start", () => {
    expect(statementAt(stmts, sql.indexOf("select 2"))?.text).toBe("select 2");
  });

  it("picks the statement the cursor sits just after", () => {
    expect(statementAt(stmts, sql.indexOf(";") + 1)?.text).toBe("select 1");
  });

  it("picks the previous statement from a gap", () => {
    expect(statementAt(stmts, sql.indexOf("\n\n") + 1)?.text).toBe("select 1");
  });

  it("picks the first statement before any", () => {
    const s = "\n\n  select 1;";
    expect(statementAt(split(s), 0)?.text).toBe("select 1");
  });

  it("picks the earlier of two statements touching at the cursor", () => {
    const s = "select 1;select 2";
    expect(statementAt(split(s), s.indexOf(";") + 1)?.text).toBe("select 1");
  });

  it("finds nothing in an empty document", () => {
    expect(statementAt([], 0)).toBeUndefined();
  });
});

describe("toRun", () => {
  it("runs the statement under the cursor", () => {
    const pos = sql.indexOf("3");
    expect(toRun(sql, { from: pos, to: pos }, "statement").map((s) => s.text)).toEqual(["select 3"]);
  });

  it("runs every statement in a selection, at document offsets", () => {
    const from = sql.indexOf("1");
    const to = sql.indexOf("3") + 1;
    const run = toRun(sql, { from, to }, "statement");
    expect(run.map((s) => s.text)).toEqual(["1", "select 2", "select 3"]);
    for (const s of run) expect(sql.slice(s.from, s.to)).toBe(s.text);
  });

  it("runs the whole script, whatever the selection", () => {
    expect(toRun(sql, { from: 0, to: 3 }, "script").map((s) => s.text)).toEqual([
      "select 1",
      "select 2",
      "select 3",
    ]);
  });

  it("runs nothing in an empty document", () => {
    expect(toRun("", { from: 0, to: 0 }, "statement")).toEqual([]);
  });
});

describe("statementUnder", () => {
  const two = "select 1;\n\nselect 2;";
  const at = (pos: number) => ({ from: pos, to: pos });

  it("picks the statement the cursor is in", () => {
    expect(statementUnder(split(two), at(3))?.text).toBe("select 1");
  });

  it("picks the statement the cursor sits just after", () => {
    expect(statementUnder(split(two), at(two.indexOf(";") + 1))?.text).toBe("select 1");
  });

  it("picks the nearest one before from a blank line", () => {
    expect(statementUnder(split(two), at(two.indexOf("\n\n") + 1))?.text).toBe("select 1");
  });

  it("picks the statement after when nothing is before", () => {
    expect(statementUnder(split("\n\nselect 1;"), at(0))?.text).toBe("select 1");
  });

  it("is undefined for a non-empty selection: the selection is what runs", () => {
    expect(statementUnder(split(two), { from: 0, to: 5 })).toBeUndefined();
  });

  it("is undefined when there are no statements", () => {
    expect(statementUnder([], at(0))).toBeUndefined();
  });
});
