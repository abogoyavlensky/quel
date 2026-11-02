import { describe, expect, it } from "vitest";
import { gate } from "./guard";
import { split } from "./split";

const texts = (g: ReturnType<typeof gate>) => (g.action === "confirm" ? g.statements.map((s) => s.text) : []);

describe("gate", () => {
  it("never runs everything", () => {
    expect(gate("never", split("drop table t"))).toEqual({ action: "run" });
  });

  it("always asks, listing every statement", () => {
    const g = gate("always", split("select 1; set x = 1"));
    expect(g).toMatchObject({ action: "confirm", reason: "always" });
    expect(texts(g)).toEqual(["select 1", "set x = 1"]);
  });

  it("writes asks for writes and unknowns only", () => {
    expect(gate("writes", split("select 1; set x = 1; begin"))).toEqual({ action: "run" });
    const g = gate("writes", split("select 1; delete from t; call p()"));
    expect(g).toMatchObject({ action: "confirm", reason: "writes" });
    expect(texts(g)).toEqual(["delete from t", "call p()"]);
  });

  it("read-only refuses the first write", () => {
    const g = gate("read-only", split("select 1; insert into t values (1); drop table t"));
    expect(g).toMatchObject({ action: "refuse", statement: { text: "insert into t values (1)" } });
  });

  it("read-only asks for unknowns", () => {
    const g = gate("read-only", split("select 1; call p()"));
    expect(g).toMatchObject({ action: "confirm", reason: "unknown" });
    expect(texts(g)).toEqual(["call p()"]);
  });

  it("read-only runs reads and session statements", () => {
    expect(gate("read-only", split("set x = 1; select 1; commit"))).toEqual({ action: "run" });
  });
});
