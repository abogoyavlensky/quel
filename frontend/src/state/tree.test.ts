import { describe, expect, it } from "vitest";
import { metaKeys } from "@/lib/query";
import type { ObjectDetails, ObjectInfo, SchemaContents } from "@/lib/types";
import {
  type ExpandableRow,
  type TreeData,
  type TreeRow,
  functionKey,
  groupKey,
  initialExpanded,
  objectKey,
  openObjects,
  openSchemas,
  schemaKey,
  sectionKey,
  toggle,
  typeKey,
  treeRows,
} from "./tree";

const objects: ObjectInfo[] = [
  { name: "orders", kind: "table" },
  { name: "recent", kind: "materialized-view" },
  { name: "users", kind: "table" },
  { name: "active", kind: "view" },
];

function data(over: Partial<TreeData> = {}): TreeData {
  return {
    connId: "c1",
    schemas: [
      { name: "public", default: true },
      { name: "sales", default: false },
    ],
    contents: {},
    details: {},
    ...over,
  };
}

const contents = (over: Partial<SchemaContents> = {}): SchemaContents => ({
  objects: [],
  functions: [],
  types: [],
  sequences: [],
  ...over,
});
const details = (over: Partial<ObjectDetails> = {}): ObjectDetails => ({
  columns: [],
  indexes: [],
  keys: [],
  sequences: [],
  ...over,
});
const ok = <T>(d: T) => ({ status: "success" as const, data: d });

const open = (...keys: string[]) => new Set(keys);
const summary = (rows: TreeRow[]) =>
  rows.map((r) => `${r.depth}:${r.kind}:${"label" in r ? r.label : "text" in r ? r.text : ""}`);

describe("treeRows", () => {
  it("lists collapsed schemas at depth 0", () => {
    expect(summary(treeRows(data(), open()))).toEqual(["0:schema:public", "0:schema:sales"]);
  });

  it("shows loading and errors under the schema being loaded", () => {
    const rows = treeRows(
      data({ contents: { public: { status: "pending" }, sales: { status: "error", message: "denied" } } }),
      open(schemaKey("public"), schemaKey("sales")),
    );
    expect(summary(rows)).toEqual(["0:schema:public", "1:loading:", "0:schema:sales", "1:error:"]);
    const err = rows[3];
    expect(err.kind === "error" && err.message).toBe("denied");
    expect(err.kind === "error" && err.retryKey).toEqual(metaKeys.schema("c1", "sales"));
    expect(err.parentKey).toBe(schemaKey("sales"));
  });

  it("groups a loaded schema into tables and views, materialized views with the views", () => {
    const rows = treeRows(
      data({ contents: { public: ok(contents({ objects })) } }),
      toggle(open(), treeRows(data(), open())[0]),
    );
    expect(summary(rows)).toEqual([
      "0:schema:public",
      "1:group:Tables",
      "2:object:orders",
      "2:object:users",
      "1:group:Views",
      "2:object:recent",
      "2:object:active",
      "0:schema:sales",
    ]);
    const tables = rows[1];
    expect(tables.kind === "group" && tables.detail).toBe("2");
  });

  it("leaves out a group with no members, and says when a schema is empty", () => {
    const onlyTables = treeRows(
      data({ contents: { public: ok(contents({ objects: [{ name: "t", kind: "table" }] })), sales: ok(contents()) } }),
      open(schemaKey("public"), groupKey("public", "tables"), groupKey("public", "views"), schemaKey("sales")),
    );
    expect(summary(onlyTables)).toEqual([
      "0:schema:public",
      "1:group:Tables",
      "2:object:t",
      "0:schema:sales",
      "1:empty:Empty schema",
    ]);
  });

  it("shows an open object's columns with their types, or that it has none", () => {
    const users = objectKey("public", "users");
    const orders = objectKey("public", "orders");
    const rows = treeRows(
      data({
        contents: { public: ok(contents({ objects })) },
        details: {
          [users]: ok(details({ columns: [{ name: "id", type: "integer", pk: false, fk: false }] })),
          [orders]: ok(details()),
        },
      }),
      open(schemaKey("public"), groupKey("public", "tables"), users, orders),
    );
    expect(summary(rows).slice(0, 6)).toEqual([
      "0:schema:public",
      "1:group:Tables",
      "2:object:orders",
      "3:empty:No columns",
      "2:object:users",
      "3:column:id",
    ]);
    const id = rows[5];
    expect(id.kind === "column" && id.detail).toBe("integer");
    expect(id.parentKey).toBe(users);
  });

  it("hides an open node whose parent is closed", () => {
    const rows = treeRows(
      data({ contents: { public: ok(contents({ objects })) } }),
      open(groupKey("public", "tables"), objectKey("public", "users")),
    );
    expect(summary(rows)).toEqual(["0:schema:public", "0:schema:sales"]);
    expect(openObjects(rows)).toEqual([]);
  });

  it("adds Functions, Types and Sequences after Tables and Views, closed, each only when not empty", () => {
    const c = contents({
      objects: [{ name: "t", kind: "table" }],
      functions: [{ name: "f", kind: "function", args: "integer" }],
      sequences: [{ name: "invoice_no" }],
    });
    const schema = treeRows(data(), open())[0];
    const rows = treeRows(data({ contents: { public: ok(c) } }), toggle(open(), schema));
    expect(summary(rows)).toEqual([
      "0:schema:public",
      "1:group:Tables",
      "2:object:t",
      "1:group:Functions",
      "1:group:Sequences",
      "0:schema:sales",
    ]);
    expect(rows.filter((r) => r.kind === "group").map((r) => r.kind === "group" && r.expanded)).toEqual([true, false, false]);
  });

  it("lists functions with their arguments and sequences under their open groups", () => {
    const c = contents({
      functions: [
        { name: "add", kind: "function", args: "x integer" },
        { name: "add", kind: "function", args: "x integer, y integer" },
        { name: "noop", kind: "procedure", args: "" },
      ],
      sequences: [{ name: "invoice_no" }],
    });
    const rows = treeRows(
      data({ contents: { public: ok(c) } }),
      open(schemaKey("public"), groupKey("public", "functions"), groupKey("public", "sequences")),
    );
    expect(summary(rows)).toEqual([
      "0:schema:public",
      "1:group:Functions",
      "2:item:add",
      "2:item:add",
      "2:item:noop",
      "1:group:Sequences",
      "2:item:invoice_no",
      "0:schema:sales",
    ]);
    const items = rows.filter((r) => r.kind === "item");
    expect(items.map((r) => r.kind === "item" && [r.detail, r.icon])).toEqual([
      ["(x integer)", "function"],
      ["(x integer, y integer)", "function"],
      ["()", "procedure"],
      ["", "sequence"],
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("expands an enum to its values and shows a domain's base type", () => {
    const c = contents({
      types: [
        { name: "amount", kind: "domain", detail: "numeric(12,2)", values: [] },
        { name: "mood", kind: "enum", detail: null, values: ["sad", "ok"] },
        { name: "pair", kind: "composite", detail: null, values: [] },
      ],
    });
    const rows = treeRows(
      data({ contents: { public: ok(c) } }),
      open(schemaKey("public"), groupKey("public", "types"), typeKey("public", "mood")),
    );
    expect(summary(rows)).toEqual([
      "0:schema:public",
      "1:group:Types",
      "2:item:amount",
      "2:enum:mood",
      "3:item:sad",
      "3:item:ok",
      "2:item:pair",
      "0:schema:sales",
    ]);
    const amount = rows[2];
    expect(amount.kind === "item" && [amount.detail, amount.icon]).toEqual(["numeric(12,2)", "domain"]);
    const pair = rows[6];
    expect(pair.kind === "item" && pair.detail).toBe("composite");
    expect(rows[4].parentKey).toBe(typeKey("public", "mood"));
  });

  it("shows an open object's columns with badges, then its non-empty sections, closed", () => {
    const orders = objectKey("public", "orders");
    const d = details({
      columns: [
        { name: "id", type: "bigint", pk: true, fk: false },
        { name: "user_id", type: "bigint", pk: false, fk: true },
      ],
      indexes: [
        { name: "orders_pkey", definition: "btree (id)", unique: true, primary: true },
        { name: "orders_user", definition: "btree (user_id)", unique: false, primary: false },
      ],
      keys: [{ name: null, kind: "foreign-key", columns: ["user_id"], definition: "FOREIGN KEY (user_id) REFERENCES users(id)" }],
    });
    const base = open(schemaKey("public"), groupKey("public", "tables"), orders);
    const closed = treeRows(data({ contents: { public: ok(contents({ objects })) }, details: { [orders]: ok(d) } }), base);
    expect(summary(closed).slice(2, 7)).toEqual(["2:object:orders", "3:column:id", "3:column:user_id", "3:section:Indexes", "3:section:Keys"]);
    const id = closed[3];
    expect(id.kind === "column" && id.badges).toEqual(["PK"]);
    const userId = closed[4];
    expect(userId.kind === "column" && userId.badges).toEqual(["FK"]);
    const indexes = closed[5];
    expect(indexes.kind === "section" && [indexes.detail, indexes.expanded]).toEqual(["2", false]);

    const opened = treeRows(
      data({ contents: { public: ok(contents({ objects })) }, details: { [orders]: ok(d) } }),
      new Set([...base, sectionKey("public", "orders", "indexes"), sectionKey("public", "orders", "keys")]),
    );
    const items = opened.filter((r) => r.kind === "item");
    expect(items.map((r) => r.kind === "item" && [r.depth, r.label, r.detail])).toEqual([
      [4, "orders_pkey", "unique btree (id)"],
      [4, "orders_user", "btree (user_id)"],
      [4, "Foreign key", "FOREIGN KEY (user_id) REFERENCES users(id)"],
    ]);
  });

  it("keeps a function named like a table, and overloads, apart", () => {
    const keys = [objectKey("s", "f"), functionKey("s", "f", ""), functionKey("s", "f", "integer"), typeKey("s", "f")];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps keys apart for like names and odd characters", () => {
    const keys = [schemaKey("x"), objectKey("x", "x"), objectKey('a"b', "c"), objectKey("a", '"b,c'), objectKey("a,b", "c")];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("toggle", () => {
  it("opens a schema with its groups, and closes only the schema", () => {
    const schema = treeRows(data(), open())[0] as ExpandableRow;
    const opened = toggle(open(), schema);
    expect(opened).toEqual(open(schemaKey("public"), groupKey("public", "tables"), groupKey("public", "views")));
    expect(toggle(opened, { ...schema, expanded: true })).toEqual(
      open(groupKey("public", "tables"), groupKey("public", "views")),
    );
  });

  it("leaves leaves alone", () => {
    const leaf: TreeRow = { kind: "column", key: "k", depth: 3, parentKey: "p", label: "id", detail: "int", badges: [] };
    expect(toggle(open("a"), leaf)).toEqual(open("a"));
  });
});

describe("initialExpanded", () => {
  const both = (s: string) => open(schemaKey(s), groupKey(s, "tables"), groupKey(s, "views"));

  it("opens the default schema", () => {
    expect(initialExpanded(data().schemas)).toEqual(both("public"));
  });

  it("opens the only schema, default or not", () => {
    expect(initialExpanded([{ name: "main", default: false }])).toEqual(both("main"));
  });

  it("opens nothing among several without a default", () => {
    expect(initialExpanded([{ name: "a", default: false }, { name: "b", default: false }])).toEqual(open());
  });
});

describe("what to load", () => {
  it("names the open schemas and the visible open objects", () => {
    const users = objectKey("public", "users");
    const expanded = open(schemaKey("public"), groupKey("public", "tables"), users, objectKey("public", "active"));
    expect(openSchemas(data().schemas, expanded)).toEqual(["public"]);
    const rows = treeRows(data({ contents: { public: ok(contents({ objects })) } }), expanded);
    // "active" is open but its Views group is not.
    expect(openObjects(rows)).toEqual([{ schema: "public", name: "users", key: users }]);
  });
});
