import { describe, expect, it } from "vitest";
import { metaKeys } from "@/lib/query";
import type { ObjectInfo } from "@/lib/types";
import {
  type ExpandableRow,
  type TreeData,
  type TreeRow,
  groupKey,
  initialExpanded,
  objectKey,
  openObjects,
  openSchemas,
  schemaKey,
  toggle,
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
    objects: {},
    columns: {},
    ...over,
  };
}

const open = (...keys: string[]) => new Set(keys);
const summary = (rows: TreeRow[]) =>
  rows.map((r) => `${r.depth}:${r.kind}:${"label" in r ? r.label : "text" in r ? r.text : ""}`);

describe("treeRows", () => {
  it("lists collapsed schemas at depth 0", () => {
    expect(summary(treeRows(data(), open()))).toEqual(["0:schema:public", "0:schema:sales"]);
  });

  it("shows loading and errors under the schema being loaded", () => {
    const rows = treeRows(
      data({ objects: { public: { status: "pending" }, sales: { status: "error", message: "denied" } } }),
      open(schemaKey("public"), schemaKey("sales")),
    );
    expect(summary(rows)).toEqual(["0:schema:public", "1:loading:", "0:schema:sales", "1:error:"]);
    const err = rows[3];
    expect(err.kind === "error" && err.message).toBe("denied");
    expect(err.kind === "error" && err.retryKey).toEqual(metaKeys.objects("c1", "sales"));
    expect(err.parentKey).toBe(schemaKey("sales"));
  });

  it("groups a loaded schema into tables and views, materialized views with the views", () => {
    const rows = treeRows(
      data({ objects: { public: { status: "success", data: objects } } }),
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
      data({ objects: { public: { status: "success", data: [{ name: "t", kind: "table" }] }, sales: { status: "success", data: [] } } }),
      open(schemaKey("public"), groupKey("public", "tables"), groupKey("public", "views"), schemaKey("sales")),
    );
    expect(summary(onlyTables)).toEqual([
      "0:schema:public",
      "1:group:Tables",
      "2:object:t",
      "0:schema:sales",
      "1:empty:No tables or views",
    ]);
  });

  it("shows an open object's columns with their types, or that it has none", () => {
    const users = objectKey("public", "users");
    const orders = objectKey("public", "orders");
    const rows = treeRows(
      data({
        objects: { public: { status: "success", data: objects } },
        columns: {
          [users]: { status: "success", data: [{ name: "id", type: "integer" }] },
          [orders]: { status: "success", data: [] },
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
      data({ objects: { public: { status: "success", data: objects } } }),
      open(groupKey("public", "tables"), objectKey("public", "users")),
    );
    expect(summary(rows)).toEqual(["0:schema:public", "0:schema:sales"]);
    expect(openObjects(rows)).toEqual([]);
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
    const leaf: TreeRow = { kind: "column", key: "k", depth: 3, parentKey: "p", label: "id", detail: "int" };
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
    const rows = treeRows(data({ objects: { public: { status: "success", data: objects } } }), expanded);
    // "active" is open but its Views group is not.
    expect(openObjects(rows)).toEqual([{ schema: "public", name: "users", key: users }]);
  });
});
