import type { SQLDialect, SQLNamespace } from "@codemirror/lang-sql";
import type { CompletionSchema } from "@/lib/types";

// completion-schema's reply as lang-sql's namespace. lang-sql reads a dot
// in a key as a path separator (`a.b` is table b in schema a), so a dot
// that is part of a schema or table name is escaped as `\.`. Schemas and
// tables carry their kind (a `self` completion), so the popup can mark
// database objects with an icon and leave keywords and SQL types bare;
// lang-sql would type both as `type`.
const escape = (name: string) => name.replace(/\./g, "\\.");

export function namespaceOf(c: CompletionSchema, dialect: SQLDialect): SQLNamespace {
  // As lang-sql's nameCompletion: a name that is not a plain identifier
  // gets `apply` with the dialect's identifier quotes.
  const quote = dialect.spec.identifierQuotes?.[0] || '"';
  const plain = new RegExp("^[a-z_][a-z_\\d]*$", dialect.spec.caseInsensitiveIdentifiers ? "i" : "");
  const name = (label: string, type: string) =>
    plain.test(label) ? { label, type } : { label, type, apply: quote + label + (quote === "[" ? "]" : quote) };

  // fromEntries defines own properties, so a table named __proto__ stays
  // a table rather than setting the object's prototype.
  return Object.fromEntries(
    Object.entries(c.schemas).map(([schema, tables]) => [
      escape(schema),
      {
        self: name(schema, "schema"),
        children: Object.fromEntries(
          Object.entries(tables).map(([table, columns]) => [
            escape(table),
            { self: name(table, "table"), children: columns },
          ]),
        ),
      },
    ]),
  );
}
