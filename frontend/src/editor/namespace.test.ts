import { PostgreSQL, SQLite } from "@codemirror/lang-sql";
import { describe, expect, it } from "vitest";
import { namespaceOf } from "./namespace";

type Level = { self: { label: string; type: string; apply?: string }; children: unknown };

describe("namespaceOf", () => {
  it("keeps plain names and tags schemas and tables with their kind", () => {
    expect(namespaceOf({ "default-schema": "main", schemas: { main: { t: ["id", "name"] } } }, SQLite)).toEqual({
      main: {
        self: { label: "main", type: "schema" },
        children: { t: { self: { label: "t", type: "table" }, children: ["id", "name"] } },
      },
    });
  });

  it("escapes dots in the keys, not in the labels, and quotes the label", () => {
    expect(
      namespaceOf({ "default-schema": null, schemas: { "a.b": { "order.items": ["x.y"] } } }, PostgreSQL),
    ).toEqual({
      "a\\.b": {
        self: { label: "a.b", type: "schema", apply: '"a.b"' },
        children: {
          "order\\.items": {
            self: { label: "order.items", type: "table", apply: '"order.items"' },
            children: ["x.y"],
          },
        },
      },
    });
  });

  it("quotes a name that is not a plain identifier, as lang-sql does", () => {
    const ns = namespaceOf({ "default-schema": "public", schemas: { public: { Users: ["id"] } } }, PostgreSQL) as Record<
      string,
      { children: Record<string, Level> }
    >;
    expect(ns.public.children.Users.self).toEqual({ label: "Users", type: "table", apply: '"Users"' });
  });

  it("quotes with the dialect's first identifier quote", () => {
    const quote = SQLite.spec.identifierQuotes?.[0] ?? '"';
    const ns = namespaceOf({ "default-schema": "main", schemas: { main: { "my table": ["id"] } } }, SQLite) as Record<
      string,
      { children: Record<string, Level> }
    >;
    expect(ns.main.children["my table"].self).toEqual({
      label: "my table",
      type: "table",
      apply: `${quote}my table${quote}`,
    });
  });

  it("keeps a table named __proto__", () => {
    const schemas = JSON.parse('{"main": {"__proto__": ["x"]}}') as Record<string, Record<string, string[]>>;
    const ns = namespaceOf({ "default-schema": "main", schemas }, SQLite) as Record<
      string,
      { children: Record<string, Level> }
    >;
    expect(Object.keys(ns.main.children)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(ns.main.children, "__proto__")?.value.children).toEqual(["x"]);
  });
});
