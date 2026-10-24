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
});
