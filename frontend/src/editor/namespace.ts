import type { SQLNamespace } from "@codemirror/lang-sql";
import type { CompletionSchema } from "@/lib/types";

// completion-schema's reply as lang-sql's namespace. lang-sql reads a dot
// in a key as a path separator (`a.b` is table b in schema a), so a dot
// that is part of a schema or table name is escaped as `\.`.
const escape = (name: string) => name.replace(/\./g, "\\.");

export function namespaceOf(c: CompletionSchema): SQLNamespace {
  const ns: { [schema: string]: { [table: string]: string[] } } = {};
  for (const [schema, tables] of Object.entries(c.schemas)) {
    const t: { [table: string]: string[] } = {};
    for (const [table, columns] of Object.entries(tables)) t[escape(table)] = columns;
    ns[escape(schema)] = t;
  }
  return ns;
}
