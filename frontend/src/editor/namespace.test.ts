import { describe, expect, it } from "vitest";
import { namespaceOf } from "./namespace";

describe("namespaceOf", () => {
  it("keeps plain names as they are", () => {
    expect(namespaceOf({ "default-schema": "main", schemas: { main: { t: ["id", "name"] } } })).toEqual({
      main: { t: ["id", "name"] },
    });
  });

  it("escapes dots in schema and table names, not in columns", () => {
    expect(namespaceOf({ "default-schema": null, schemas: { "a.b": { "order.items": ["x.y"] } } })).toEqual({
      "a\\.b": { "order\\.items": ["x.y"] },
    });
  });

  it("keeps a table named __proto__", () => {
    const schemas = JSON.parse('{"main": {"__proto__": ["x"]}}') as Record<string, Record<string, string[]>>;
    const ns = namespaceOf({ "default-schema": "main", schemas }) as Record<string, Record<string, string[]>>;
    expect(Object.keys(ns.main)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(ns.main, "__proto__")?.value).toEqual(["x"]);
  });
});
