import type { SQLNamespace } from "@codemirror/lang-sql";
import type { CompletionSchema } from "@/lib/types";

// completion-schema's reply as lang-sql's namespace. lang-sql reads a dot
// in a key as a path separator (`a.b` is table b in schema a), so a dot
// that is part of a schema or table name is escaped as `\.`.
const escape = (name: string) => name.replace(/\./g, "\\.");

export function namespaceOf(c: CompletionSchema): SQLNamespace {
  // fromEntries defines own properties, so a table named __proto__ stays
  // a table rather than setting the object's prototype.
  return Object.fromEntries(
    Object.entries(c.schemas).map(([schema, tables]) => [
      escape(schema),
      Object.fromEntries(Object.entries(tables).map(([table, columns]) => [escape(table), columns])),
    ]),
  );
}
