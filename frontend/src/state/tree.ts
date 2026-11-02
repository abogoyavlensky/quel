import type { KeyKind, ObjectDetails, ObjectKind, SchemaContents, SchemaInfo } from "@/lib/types";
import { metaKeys } from "@/lib/query";

// The structure tree as a flat list of rows, built from what has loaded
// and which nodes are expanded. Pure: StructureTree feeds it the query
// results and renders the rows; the list is virtualized and walked by the
// keyboard, which a flat list makes simple.
//
//   schema                         ["s", schema]
//     Tables / Views / Functions / Types / Sequences
//                                  ["g", schema, group]
//       object                     ["o", schema, name]
//         column                   ["c", schema, name, column]
//         Indexes / Keys / Sequences
//                                  ["d", schema, name, section]
//           index                  ["ix", schema, name, index]
//           key                    ["k", schema, name, position]
//           owned sequence         ["os", schema, name, sequence]
//       function                   ["fn", schema, name, args]
//       type (an enum expands)     ["ty", schema, name]
//         enum value               ["ev", schema, type, position]
//       sequence                   ["sq", schema, name]
//
// Keys are JSON arrays with a prefix per kind, so a name with any
// characters, a function named like a table, and overloads stay apart.

export type Loaded<T> = { status: "pending" } | { status: "error"; message: string } | { status: "success"; data: T };

export interface TreeData {
  connId: string;
  schemas: SchemaInfo[];
  contents: Record<string, Loaded<SchemaContents>>; // by schema
  details: Record<string, Loaded<ObjectDetails>>; // by object key
}

export type Group = "tables" | "views" | "functions" | "types" | "sequences";
export type Section = "indexes" | "keys" | "sequences";
export type ItemIcon = "function" | "procedure" | "domain" | "composite" | "sequence" | "index" | "key" | "value";
export type Badge = "PK" | "FK";

interface Base {
  key: string;
  depth: number;
  parentKey: string | null;
}

export type TreeRow =
  | (Base & { kind: "schema"; label: string; expanded: boolean; schema: string })
  | (Base & { kind: "group"; label: string; detail: string; expanded: boolean; schema: string; group: Group })
  | (Base & { kind: "object"; label: string; objectKind: ObjectKind; expanded: boolean; schema: string })
  | (Base & { kind: "column"; label: string; detail: string; badges: Badge[] })
  | (Base & { kind: "section"; label: string; detail: string; expanded: boolean })
  | (Base & { kind: "enum"; label: string; expanded: boolean })
  | (Base & { kind: "item"; label: string; detail: string; icon: ItemIcon })
  | (Base & { kind: "loading" })
  | (Base & { kind: "empty"; text: string })
  | (Base & { kind: "error"; message: string; retryKey: readonly unknown[] });

export type ExpandableRow = Extract<TreeRow, { expanded: boolean }>;

const k = (...parts: string[]) => JSON.stringify(parts);
export const schemaKey = (schema: string) => k("s", schema);
export const groupKey = (schema: string, group: Group) => k("g", schema, group);
export const objectKey = (schema: string, name: string) => k("o", schema, name);
export const sectionKey = (schema: string, name: string, section: Section) => k("d", schema, name, section);
export const typeKey = (schema: string, name: string) => k("ty", schema, name);
export const functionKey = (schema: string, name: string, args: string) => k("fn", schema, name, args);

export function isExpandable(row: TreeRow): row is ExpandableRow {
  return (
    row.kind === "schema" || row.kind === "group" || row.kind === "object" || row.kind === "section" || row.kind === "enum"
  );
}

const GROUPS: [Group, string][] = [
  ["tables", "Tables"],
  ["views", "Views"],
  ["functions", "Functions"],
  ["types", "Types"],
  ["sequences", "Sequences"],
];

const KEY_LABELS: Record<KeyKind, string> = {
  "primary-key": "Primary key",
  unique: "Unique",
  "foreign-key": "Foreign key",
  check: "Check",
};

// The rows a loading, failed or empty node shows under itself.
function statusRows(
  loaded: Loaded<unknown> | undefined,
  isEmpty: boolean,
  parentKey: string,
  depth: number,
  empty: string,
  retryKey: readonly unknown[],
): TreeRow[] | null {
  if (!loaded || loaded.status === "pending") return [{ kind: "loading", key: `${parentKey}:loading`, depth, parentKey }];
  if (loaded.status === "error")
    return [{ kind: "error", key: `${parentKey}:error`, depth, parentKey, message: loaded.message, retryKey }];
  if (isEmpty) return [{ kind: "empty", key: `${parentKey}:empty`, depth, parentKey, text: empty }];
  return null;
}

type Item = { key: string; label: string; detail: string; icon: ItemIcon };

// An expandable row with a count, and its items under it when open.
function folder(
  rows: TreeRow[],
  row: Omit<Extract<TreeRow, { kind: "group" } | { kind: "section" }>, "expanded" | "detail">,
  items: Item[],
  expanded: ReadonlySet<string>,
) {
  if (items.length === 0) return;
  const open = expanded.has(row.key);
  rows.push({ ...row, detail: String(items.length), expanded: open } as TreeRow);
  if (!open) return;
  for (const it of items) rows.push({ kind: "item", depth: row.depth + 1, parentKey: row.key, ...it });
}

function objectRows(rows: TreeRow[], data: TreeData, schema: string, name: string, oKey: string, expanded: ReadonlySet<string>) {
  const loaded = data.details[oKey];
  const d = loaded?.status === "success" ? loaded.data : null;
  const isEmpty = !!d && d.columns.length + d.indexes.length + d.keys.length + d.sequences.length === 0;
  const status = statusRows(loaded, isEmpty, oKey, 3, "No columns", metaKeys.object(data.connId, schema, name));
  if (status || !d) {
    rows.push(...(status ?? []));
    return;
  }
  for (const c of d.columns) {
    const badges: Badge[] = [];
    if (c.pk) badges.push("PK");
    if (c.fk) badges.push("FK");
    rows.push({ kind: "column", key: k("c", schema, name, c.name), depth: 3, parentKey: oKey, label: c.name, detail: c.type, badges });
  }
  const section = (s: Section, label: string, items: Item[]) =>
    folder(rows, { kind: "section", key: sectionKey(schema, name, s), depth: 3, parentKey: oKey, label }, items, expanded);
  section(
    "indexes",
    "Indexes",
    d.indexes.map((ix) => ({
      key: k("ix", schema, name, ix.name),
      label: ix.name,
      detail: ix.unique ? `unique ${ix.definition}` : ix.definition,
      icon: "index",
    })),
  );
  section(
    "keys",
    "Keys",
    d.keys.map((key, i) => ({
      key: k("k", schema, name, String(i)),
      label: key.name ?? KEY_LABELS[key.kind],
      detail: key.definition,
      icon: "key",
    })),
  );
  section(
    "sequences",
    "Sequences",
    d.sequences.map((sq) => ({ key: k("os", schema, name, sq.name), label: sq.name, detail: sq.column, icon: "sequence" })),
  );
}

export function treeRows(data: TreeData, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const { name: schema } of data.schemas) {
    const sKey = schemaKey(schema);
    const sOpen = expanded.has(sKey);
    rows.push({ kind: "schema", key: sKey, depth: 0, parentKey: null, label: schema, expanded: sOpen, schema });
    if (!sOpen) continue;

    const loaded = data.contents[schema];
    const c = loaded?.status === "success" ? loaded.data : null;
    const isEmpty = !!c && c.objects.length + c.functions.length + c.types.length + c.sequences.length === 0;
    const status = statusRows(loaded, isEmpty, sKey, 1, "Empty schema", metaKeys.schema(data.connId, schema));
    if (status || !c) {
      rows.push(...(status ?? []));
      continue;
    }

    for (const [group, label] of GROUPS) {
      const gKey = groupKey(schema, group);
      const base = { kind: "group" as const, key: gKey, depth: 1, parentKey: sKey, label, schema, group };
      if (group === "tables" || group === "views") {
        // A materialized view goes with the views.
        const members = c.objects.filter((o) => (o.kind === "table") === (group === "tables"));
        if (members.length === 0) continue;
        const gOpen = expanded.has(gKey);
        rows.push({ ...base, detail: String(members.length), expanded: gOpen });
        if (!gOpen) continue;
        for (const o of members) {
          const oKey = objectKey(schema, o.name);
          const oOpen = expanded.has(oKey);
          rows.push({ kind: "object", key: oKey, depth: 2, parentKey: gKey, label: o.name, objectKind: o.kind, expanded: oOpen, schema });
          if (oOpen) objectRows(rows, data, schema, o.name, oKey, expanded);
        }
      } else if (group === "types") {
        if (c.types.length === 0) continue;
        const gOpen = expanded.has(gKey);
        rows.push({ ...base, detail: String(c.types.length), expanded: gOpen });
        if (!gOpen) continue;
        for (const t of c.types) {
          const tKey = typeKey(schema, t.name);
          if (t.kind === "enum") {
            const tOpen = expanded.has(tKey);
            rows.push({ kind: "enum", key: tKey, depth: 2, parentKey: gKey, label: t.name, expanded: tOpen });
            if (!tOpen) continue;
            if (t.values.length === 0)
              rows.push({ kind: "empty", key: `${tKey}:empty`, depth: 3, parentKey: tKey, text: "No values" });
            t.values.forEach((v, i) =>
              rows.push({ kind: "item", key: k("ev", schema, t.name, String(i)), depth: 3, parentKey: tKey, label: v, detail: "", icon: "value" }),
            );
          } else {
            rows.push({
              kind: "item",
              key: tKey,
              depth: 2,
              parentKey: gKey,
              label: t.name,
              detail: t.kind === "domain" ? (t.detail ?? "") : "composite",
              icon: t.kind,
            });
          }
        }
      } else {
        const items: Item[] =
          group === "functions"
            ? c.functions.map((f) => ({ key: functionKey(schema, f.name, f.args), label: f.name, detail: `(${f.args})`, icon: f.kind }))
            : c.sequences.map((sq) => ({ key: k("sq", schema, sq.name), label: sq.name, detail: "", icon: "sequence" }));
        folder(rows, base, items, expanded);
      }
    }
  }
  return rows;
}

// Expand or collapse the row. Opening a schema opens its Tables and Views
// too; closing anything closes only that row, so it reopens as it was.
export function toggle(expanded: ReadonlySet<string>, row: TreeRow): Set<string> {
  const next = new Set(expanded);
  if (!isExpandable(row)) return next;
  if (next.has(row.key)) {
    next.delete(row.key);
  } else {
    next.add(row.key);
    if (row.kind === "schema") {
      next.add(groupKey(row.schema, "tables"));
      next.add(groupKey(row.schema, "views"));
    }
  }
  return next;
}

// What is open on the first look at a database: its default schema, or
// its only one, with its Tables and Views.
export function initialExpanded(schemas: SchemaInfo[]): Set<string> {
  const pick = schemas.find((s) => s.default) ?? (schemas.length === 1 ? schemas[0] : undefined);
  if (!pick) return new Set();
  return new Set([schemaKey(pick.name), groupKey(pick.name, "tables"), groupKey(pick.name, "views")]);
}

// What to load: the open schemas' contents, and the details of the open
// objects among rows (treeRows over the contents loaded so far: an object
// counts only while its schema and group are open too).
export function openSchemas(schemas: SchemaInfo[], expanded: ReadonlySet<string>): string[] {
  return schemas.map((s) => s.name).filter((s) => expanded.has(schemaKey(s)));
}

export function openObjects(rows: TreeRow[]): { schema: string; name: string; key: string }[] {
  return rows.flatMap((r) => (r.kind === "object" && r.expanded ? [{ schema: r.schema, name: r.label, key: r.key }] : []));
}
