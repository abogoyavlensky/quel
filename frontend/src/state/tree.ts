import type { ColumnInfo, ObjectInfo, ObjectKind, SchemaInfo } from "@/lib/types";
import { metaKeys } from "@/lib/query";

// The structure tree as a flat list of rows, built from what has loaded
// and which nodes are expanded. Pure: StructureTree feeds it the query
// results and renders the rows; the list is virtualized and walked by the
// keyboard, which a flat list makes simple.
//
//   schema               ["s", schema]
//     Tables / Views     ["g", schema, "tables" | "views"]
//       object           ["o", schema, name]
//         column         ["c", schema, name, column]
//
// Keys are JSON arrays, so a name with any characters stays apart from
// any other.

export type Loaded<T> = { status: "pending" } | { status: "error"; message: string } | { status: "success"; data: T };

export interface TreeData {
  connId: string;
  schemas: SchemaInfo[];
  objects: Record<string, Loaded<ObjectInfo[]>>; // by schema
  columns: Record<string, Loaded<ColumnInfo[]>>; // by object key
}

type Group = "tables" | "views";

interface Base {
  key: string;
  depth: number;
  parentKey: string | null;
}

export type TreeRow =
  | (Base & { kind: "schema"; label: string; expanded: boolean; schema: string })
  | (Base & { kind: "group"; label: string; detail: string; expanded: boolean; schema: string; group: Group })
  | (Base & { kind: "object"; label: string; objectKind: ObjectKind; expanded: boolean; schema: string })
  | (Base & { kind: "column"; label: string; detail: string })
  | (Base & { kind: "loading" })
  | (Base & { kind: "empty"; text: string })
  | (Base & { kind: "error"; message: string; retryKey: readonly unknown[] });

export type ExpandableRow = Extract<TreeRow, { expanded: boolean }>;

export const schemaKey = (schema: string) => JSON.stringify(["s", schema]);
export const groupKey = (schema: string, group: Group) => JSON.stringify(["g", schema, group]);
export const objectKey = (schema: string, name: string) => JSON.stringify(["o", schema, name]);
const columnKey = (schema: string, name: string, column: string) => JSON.stringify(["c", schema, name, column]);

export function isExpandable(row: TreeRow): row is ExpandableRow {
  return row.kind === "schema" || row.kind === "group" || row.kind === "object";
}

const groupOf = (kind: ObjectKind): Group => (kind === "table" ? "tables" : "views");

// The rows a loading, failed or empty node shows under itself.
function statusRows<T>(
  loaded: Loaded<T[]> | undefined,
  parentKey: string,
  depth: number,
  empty: string,
  retryKey: readonly unknown[],
): TreeRow[] | null {
  if (!loaded || loaded.status === "pending") return [{ kind: "loading", key: `${parentKey}:loading`, depth, parentKey }];
  if (loaded.status === "error")
    return [{ kind: "error", key: `${parentKey}:error`, depth, parentKey, message: loaded.message, retryKey }];
  if (loaded.data.length === 0) return [{ kind: "empty", key: `${parentKey}:empty`, depth, parentKey, text: empty }];
  return null;
}

export function treeRows(data: TreeData, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const { name: schema } of data.schemas) {
    const sKey = schemaKey(schema);
    const sOpen = expanded.has(sKey);
    rows.push({ kind: "schema", key: sKey, depth: 0, parentKey: null, label: schema, expanded: sOpen, schema });
    if (!sOpen) continue;

    const loaded = data.objects[schema];
    const status = statusRows(loaded, sKey, 1, "No tables or views", metaKeys.objects(data.connId, schema));
    if (status) {
      rows.push(...status);
      continue;
    }
    const objects = (loaded as { data: ObjectInfo[] }).data;
    for (const [group, label] of [
      ["tables", "Tables"],
      ["views", "Views"],
    ] as const) {
      const members = objects.filter((o) => groupOf(o.kind) === group);
      if (members.length === 0) continue;
      const gKey = groupKey(schema, group);
      const gOpen = expanded.has(gKey);
      rows.push({
        kind: "group",
        key: gKey,
        depth: 1,
        parentKey: sKey,
        label,
        detail: String(members.length),
        expanded: gOpen,
        schema,
        group,
      });
      if (!gOpen) continue;

      for (const o of members) {
        const oKey = objectKey(schema, o.name);
        const oOpen = expanded.has(oKey);
        rows.push({
          kind: "object",
          key: oKey,
          depth: 2,
          parentKey: gKey,
          label: o.name,
          objectKind: o.kind,
          expanded: oOpen,
          schema,
        });
        if (!oOpen) continue;

        const cols = data.columns[oKey];
        const cStatus = statusRows(cols, oKey, 3, "No columns", metaKeys.columns(data.connId, schema, o.name));
        if (cStatus) {
          rows.push(...cStatus);
          continue;
        }
        for (const c of (cols as { data: ColumnInfo[] }).data) {
          rows.push({
            kind: "column",
            key: columnKey(schema, o.name, c.name),
            depth: 3,
            parentKey: oKey,
            label: c.name,
            detail: c.type,
          });
        }
      }
    }
  }
  return rows;
}

// Expand or collapse the row. Opening a schema opens its two groups too;
// closing anything closes only that row, so it reopens as it was.
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
// its only one, with both groups.
export function initialExpanded(schemas: SchemaInfo[]): Set<string> {
  const pick = schemas.find((s) => s.default) ?? (schemas.length === 1 ? schemas[0] : undefined);
  if (!pick) return new Set();
  return new Set([schemaKey(pick.name), groupKey(pick.name, "tables"), groupKey(pick.name, "views")]);
}

// What to load: the open schemas' objects, and the columns of the open
// objects among rows (treeRows over the objects loaded so far: an object
// counts only while its schema and group are open too).
export function openSchemas(schemas: SchemaInfo[], expanded: ReadonlySet<string>): string[] {
  return schemas.map((s) => s.name).filter((s) => expanded.has(schemaKey(s)));
}

export function openObjects(rows: TreeRow[]): { schema: string; name: string; key: string }[] {
  return rows.flatMap((r) => (r.kind === "object" && r.expanded ? [{ schema: r.schema, name: r.label, key: r.key }] : []));
}
