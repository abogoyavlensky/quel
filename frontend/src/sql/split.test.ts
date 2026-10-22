import { describe, expect, it } from "vitest";
import { split } from "./split";

const texts = (sql: string) => split(sql).map((s) => s.text);

describe("split", () => {
  it("splits on semicolons and keeps document offsets", () => {
    const sql = "select 1;\n  select 2 ;\nselect 3";
    const stmts = split(sql);
    expect(stmts.map((s) => s.text)).toEqual(["select 1", "select 2", "select 3"]);
    for (const s of stmts) expect(sql.slice(s.from, s.to)).toBe(s.text);
    expect(stmts[1].from).toBe(sql.indexOf("select 2"));
  });

  it("takes a last statement without a semicolon", () => {
    expect(texts("select 1; select 2")).toEqual(["select 1", "select 2"]);
  });

  it("drops empty and comment-only statements", () => {
    expect(texts(";;  ; -- nothing\n; /* nor this */ ;")).toEqual([]);
    expect(texts("select 1; -- trailing note")).toEqual(["select 1"]);
  });

  it("keeps a leading comment with its statement", () => {
    expect(texts("-- the count\nselect count(*) from t;")).toEqual(["-- the count\nselect count(*) from t"]);
  });

  it.each([
    ["single quotes", "select 'a;b'"],
    ["doubled quotes", "select 'it''s;'"],
    ["E-strings with backslash escapes", "select E'a\\';b'"],
    ["lower-case e-strings", "select e'a\\';b'"],
    ["double-quoted identifiers", 'select 1 as "a;b"'],
    ["backticks", "select 1 as `a;b`"],
    ["brackets", "select 1 as [a;b]"],
    ["dollar quotes", "select $$a;b$$"],
    ["tagged dollar quotes", "select $fn$ a; $$ ; $fn$"],
    ["line comments", "select 1 -- a;b\n+ 1"],
    ["nested block comments", "select /* a; /* b; */ c; */ 1"],
  ])("does not split inside %s", (_, stmt) => {
    expect(texts(`${stmt}; select 2`)).toEqual([stmt, "select 2"]);
  });

  it("treats a backslash in a plain string as a character", () => {
    expect(texts("select 'a\\'; select 2")).toEqual(["select 'a\\'", "select 2"]);
  });

  it("does not take $1 or a$b$ for dollar quotes", () => {
    expect(texts("select $1; select a$b$c; select 3")).toEqual(["select $1", "select a$b$c", "select 3"]);
  });

  it("splits transaction control like any statement", () => {
    expect(texts("begin; insert into t values (1); commit;")).toEqual([
      "begin",
      "insert into t values (1)",
      "commit",
    ]);
  });

  it("keeps a SQLite trigger body whole", () => {
    const trigger =
      "CREATE TRIGGER t_ins AFTER INSERT ON t BEGIN\n" +
      "  UPDATE c SET n = n + 1;\n" +
      "  INSERT INTO log VALUES (CASE WHEN new.x > 0 THEN 'pos' ELSE 'neg' END);\n" +
      "END";
    expect(texts(`${trigger}; select 2`)).toEqual([trigger, "select 2"]);
  });

  it("keeps a temporary trigger whole too", () => {
    const trigger = "create temp trigger t2 after delete on t begin delete from u; end";
    expect(texts(`${trigger};select 1`)).toEqual([trigger, "select 1"]);
  });

  it("keeps a BEGIN ATOMIC body whole", () => {
    const fn =
      "create function f() returns int language sql begin atomic select 1; select 2; end";
    expect(texts(`${fn}; select 3`)).toEqual([fn, "select 3"]);
  });

  it("does not treat CASE ... END outside a block as one", () => {
    expect(texts("select case when 1 then 2 end; select 3")).toEqual([
      "select case when 1 then 2 end",
      "select 3",
    ]);
  });

  it("runs an unterminated quote or comment to the end", () => {
    expect(texts("select 'open; select 2")).toEqual(["select 'open; select 2"]);
    expect(texts("select 1 /* open; select 2")).toEqual(["select 1 /* open; select 2"]);
    expect(texts("select $x$ open; select 2")).toEqual(["select $x$ open; select 2"]);
  });

  it("handles empty input", () => {
    expect(split("")).toEqual([]);
    expect(split("   \n")).toEqual([]);
  });
});
