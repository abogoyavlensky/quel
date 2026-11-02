import { describe, expect, it } from "vitest";
import { classify } from "./classify";

const cases = (expected: string, sqls: string[]) => {
  for (const sql of sqls) it(`${sql} → ${expected}`, () => expect(classify(sql)).toBe(expected));
};

describe("classify", () => {
  describe("reads", () => {
    cases("read", [
      "select 1",
      "SELECT * FROM t WHERE a = 'delete'",
      "select * from (select a into x) s",
      "select * from t for update",
      "values (1), (2)",
      "table t",
      "show search_path",
      "describe t",
      "fetch 10 from c",
      "with x as (select 1) select * from t for update",
      "with x as (select 1) select * from t for no key update",
      "with x as (select 1) select * from x",
      "with x as (select 1) values (1)",
      "explain select 1",
      "explain analyze select 1",
      "explain query plan delete from t",
      "explain delete from t",
      "explain (analyze false) delete from t",
      "explain (analyze off, costs) update t set a = 1",
      "pragma table_info(t)",
      "pragma main.index_list(t)",
      'pragma "table_info"(t)',
      "pragma user_version",
      "-- just a comment",
      "select $$ drop table t $$",
    ]);
  });

  describe("writes", () => {
    cases("write", [
      "select * into t2 from t",
      "with d as (delete from t returning *) select * from d",
      "with x as (select 1) insert into t select * from x",
      "with x as (select 1) select * into t2 from x",
      "with x as (select 1) update t set a = 1",
      "explain analyze delete from t",
      "explain (analyze, buffers) update t set a = 1",
      "explain (analyze true) delete from t",
      "explain analyse verbose insert into t values (1)",
      "pragma foreign_keys = on",
      "pragma optimize",
      "pragma user_version(5)",
      'pragma "optimize"',
      'pragma "wal_checkpoint"',
      "insert into t values (1)",
      "update t set a = 1",
      "delete from t",
      "merge into t using s on t.id = s.id when matched then delete",
      "replace into t values (1)",
      "create table t (a int)",
      "alter table t add b int",
      "drop table t",
      "truncate t",
      "grant select on t to u",
      "vacuum",
      "analyze t",
      "refresh materialized view v",
      "lock table t",
      "attach database 'x.db' as x",
    ]);
  });

  describe("session", () => {
    cases("session", [
      "SET search_path = x",
      "reset all",
      "begin",
      "start transaction",
      "commit",
      "end",
      "rollback to s",
      "savepoint s",
      "release s",
      "discard all",
    ]);
  });

  describe("unknown", () => {
    cases("unknown", [
      "call p()",
      "do $$ begin delete from t; end $$",
      "copy t from stdin",
      "execute q",
      "unload ('select 1') to 's3://b'",
      "with x as (select 1)",
      "pragma",
    ]);
  });
});
