import type { Cell, Column } from "@/lib/types";
import { isNumericType } from "./format";
import { isJsonType, jsonKeys, reindent } from "./json";

// A result as text, for copying and saving: CSV (RFC 4180), JSON and a
// GitHub-flavoured Markdown table. Pure functions over the columns and the
// rows as the grid holds them.

export type ExportFormat = "csv" | "json" | "markdown";
export type CsvSeparator = "," | ";" | "\t";

export const EXTENSIONS: Record<ExportFormat, string> = { csv: "csv", json: "json", markdown: "md" };

export function toCsv(columns: Column[], rows: Cell[][], separator: CsvSeparator): string {
  const field = (cell: Cell) => {
    const text = cell === null ? "" : String(cell);
    return text.includes(separator) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const record = (cells: Cell[]) => `${cells.map(field).join(separator)}\r\n`;
  return record(columns.map((c) => c.name)) + rows.map(record).join("");
}

// A JSON-typed cell as its own text, re-indented to sit at depth 2 (under
// a key of an object in the array), or null when the cell is not valid
// JSON and goes in as a string. The text is copied, never parsed and
// stringified: that would round big numbers. A document too big to
// re-indent goes in as written, so a value's type never depends on its size.
function rawJson(cell: Cell, type: string): string | null {
  if (typeof cell !== "string" || !isJsonType(type)) return null;
  try {
    JSON.parse(cell);
  } catch {
    return null;
  }
  const text = reindent(cell);
  return text === null ? cell : text.replaceAll("\n", "\n    ");
}

export function toJson(columns: Column[], rows: Cell[][]): string {
  if (rows.length === 0) return "[]";
  const keys = jsonKeys(columns).map((k) => JSON.stringify(k));
  const object = (row: Cell[]) => {
    if (keys.length === 0) return "  {}";
    const members = keys.map((key, i) => `    ${key}: ${rawJson(row[i], columns[i].type) ?? JSON.stringify(row[i])}`);
    return `  {\n${members.join(",\n")}\n  }`;
  };
  return `[\n${rows.map(object).join(",\n")}\n]`;
}

export function toMarkdown(columns: Column[], rows: Cell[][]): string {
  const escape = (text: string) => text.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\r\n|\r|\n/g, "<br>");
  const line = (cells: string[]) => `| ${cells.join(" | ")} |\n`;
  const cell = (c: Cell) => (c === null ? "*NULL*" : escape(String(c)));
  return (
    line(columns.map((c) => escape(c.name))) +
    line(columns.map((c) => (isNumericType(c.type) ? "---:" : "---"))) +
    rows.map((row) => line(row.map(cell))).join("")
  );
}

export function formatResult(
  format: ExportFormat,
  columns: Column[],
  rows: Cell[][],
  separator: CsvSeparator,
): string {
  switch (format) {
    case "csv":
      return toCsv(columns, rows, separator);
    case "json":
      return toJson(columns, rows);
    case "markdown":
      return toMarkdown(columns, rows);
  }
}
