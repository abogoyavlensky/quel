import type { Cell, Column } from "@/lib/types";
import { isNumericType } from "./format";
import { isJsonType, jsonKeys, reindent } from "./json";

// A result as text, for copying and saving: CSV (RFC 4180), JSON and a
// GitHub-flavoured Markdown table. Pure functions over the columns and the
// rows as the grid holds them.

export type ExportFormat = "csv" | "json" | "markdown";
export type CsvSeparator = "," | ";" | "\t";

export const EXTENSIONS: Record<ExportFormat, string> = { csv: "csv", json: "json", markdown: "md" };

// The most UTF-16 code units in one chunk. A code unit takes at most 6 bytes
// on the wire (a control character is \uXXXX), so a chunk is at most 24 MiB
// in one bridge call, well under Wails' 64 MiB cap.
export const CHUNK_UNITS = 4 * 1024 * 1024;

export interface ExportChunk {
  text: string;
  rows: number; // rows formatted so far
}

// A format's text: head, then row for each row, then tail.
interface Parts {
  head: string;
  row: (cells: Cell[], index: number) => string;
  tail: string;
}

function csvParts(columns: Column[], separator: CsvSeparator): Parts {
  const field = (cell: Cell) => {
    const text = cell === null ? "" : String(cell);
    return text.includes(separator) || /["\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const record = (cells: Cell[]) => `${cells.map(field).join(separator)}\r\n`;
  return { head: record(columns.map((c) => c.name)), row: record, tail: "" };
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

function jsonParts(columns: Column[], empty: boolean): Parts {
  if (empty) return { head: "[]", row: () => "", tail: "" };
  const keys = jsonKeys(columns).map((k) => JSON.stringify(k));
  const object = (row: Cell[]) => {
    if (keys.length === 0) return "  {}";
    const members = keys.map((key, i) => `    ${key}: ${rawJson(row[i], columns[i].type) ?? JSON.stringify(row[i])}`);
    return `  {\n${members.join(",\n")}\n  }`;
  };
  return { head: "[\n", row: (row, i) => `${i === 0 ? "" : ",\n"}${object(row)}`, tail: "\n]" };
}

function markdownParts(columns: Column[]): Parts {
  const escape = (text: string) => text.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\r\n|\r|\n/g, "<br>");
  const line = (cells: string[]) => `| ${cells.join(" | ")} |\n`;
  const cell = (c: Cell) => (c === null ? "*NULL*" : escape(String(c)));
  return {
    head:
      line(columns.map((c) => escape(c.name))) +
      line(columns.map((c) => (isNumericType(c.type) ? "---:" : "---"))),
    row: (row) => line(row.map(cell)),
    tail: "",
  };
}

const whole = ({ head, row, tail }: Parts, rows: Cell[][]) => head + rows.map((r, i) => row(r, i)).join("") + tail;

export function toCsv(columns: Column[], rows: Cell[][], separator: CsvSeparator): string {
  return whole(csvParts(columns, separator), rows);
}

export function toJson(columns: Column[], rows: Cell[][]): string {
  return whole(jsonParts(columns, rows.length === 0), rows);
}

export function toMarkdown(columns: Column[], rows: Cell[][]): string {
  return whole(markdownParts(columns), rows);
}

function partsOf(format: ExportFormat, columns: Column[], rows: Cell[][], separator: CsvSeparator): Parts {
  switch (format) {
    case "csv":
      return csvParts(columns, separator);
    case "json":
      return jsonParts(columns, rows.length === 0);
    case "markdown":
      return markdownParts(columns);
  }
}

// text in pieces of at most size code units, size >= 2. A surrogate pair
// stays whole: cut, it would reach JSON.stringify as two lone surrogates,
// which Go decodes to U+FFFD.
function* cut(text: string, rows: number, size: number): Generator<ExportChunk> {
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + size, text.length);
    const high = text.charCodeAt(end - 1);
    if (end < text.length && high >= 0xd800 && high <= 0xdbff) end--;
    yield { text: text.slice(start, end), rows };
    start = end;
  }
}

// A result as text a chunk at a time, made as it is read, so an export never
// holds the main thread for long or the whole file in memory. There is always
// a chunk, and the last one's rows is rows.length.
export function* formatChunks(
  format: ExportFormat,
  columns: Column[],
  rows: Cell[][],
  separator: CsvSeparator,
  size = CHUNK_UNITS,
): Generator<ExportChunk> {
  const { head, row, tail } = partsOf(format, columns, rows, separator);
  let pending = [head];
  let units = head.length;
  for (let i = 0; i < rows.length; i++) {
    const text = row(rows[i], i);
    pending.push(text);
    units += text.length;
    if (units >= size) {
      yield* cut(pending.join(""), i + 1, size);
      pending = [];
      units = 0;
    }
  }
  yield* cut(pending.join("") + tail, rows.length, size);
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

// The chunks' texts, for what has no bridge call to wait on between chunks:
// each is followed by a task, so the UI can draw the rows reported.
export async function collectChunks(
  chunks: Iterable<ExportChunk>,
  onRows: (rows: number) => void,
): Promise<string[]> {
  const texts: string[] = [];
  onRows(0);
  for (const chunk of chunks) {
    texts.push(chunk.text);
    onRows(chunk.rows);
    await nextTask();
  }
  return texts;
}
