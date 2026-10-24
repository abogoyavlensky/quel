import type { Cell, Column, Engine } from "@/lib/types";

// JSON values for the row details panel: which values read as JSON, and
// their formatted text.
//
// Formatting re-indents the value's own text and never goes through
// JSON.stringify(JSON.parse(v)): that rounds big integers
// (12345678901234567890) and rewrites numbers (1.10 becomes 1.1), and the
// panel must show what is stored. JSON.parse only checks that the text is
// valid.

// Past this, a value shows as plain text: formatting and highlighting a
// huge document would freeze the panel.
export const MAX_JSON_CHARS = 256 * 1024;
// Indentation grows with depth, so a small value nested deep enough
// formats to gigabytes; past this much output the formatting gives up.
export const MAX_FORMATTED_CHARS = 1024 * 1024;

const jsonTypes = /^(JSONB?|SUPER)$/i;

export function isJsonType(type: string): boolean {
  return jsonTypes.test(type);
}

const INDENT = "  ";

// A valid JSON text, re-indented by two spaces; null once the output
// passes limit. Strings and literals are copied as written.
export function reindent(json: string, limit = MAX_FORMATTED_CHARS): string | null {
  const out: string[] = [];
  let size = 0;
  let depth = 0;
  const put = (s: string) => {
    out.push(s);
    size += s.length;
  };
  const newline = () => put(`\n${INDENT.repeat(depth)}`);
  const n = json.length;
  let i = 0;
  while (i < n) {
    if (size > limit) return null;
    const c = json[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && json[j] !== '"') j += json[j] === "\\" ? 2 : 1;
      put(json.slice(i, j + 1));
      i = j + 1;
    } else if (c === "{" || c === "[") {
      const close = c === "{" ? "}" : "]";
      let j = i + 1;
      while (j < n && /\s/.test(json[j])) j++;
      if (json[j] === close) {
        put(c + close);
        i = j + 1;
      } else {
        put(c);
        depth++;
        newline();
        i++;
      }
    } else if (c === "}" || c === "]") {
      depth--;
      newline();
      put(c);
      i++;
    } else if (c === ",") {
      put(",");
      newline();
      i++;
    } else if (c === ":") {
      put(": ");
      i++;
    } else {
      // A number, true, false or null: up to the next structural
      // character or whitespace.
      let j = i + 1;
      while (j < n && !/[\s,:{}[\]"]/.test(json[j])) j++;
      put(json.slice(i, j));
      i = j;
    }
  }
  return size > limit ? null : out.join("");
}

// The cell's text formatted as JSON, or null when it shows as plain text:
// not a string, not JSON by its type (or, in SQLite, by its look), too big,
// or not valid JSON.
export function jsonText(cell: Cell, type: string, engine: Engine | null): string | null {
  if (typeof cell !== "string") return null;
  const looksJson = isJsonType(type) || (engine === "sqlite" && /^\s*[[{]/.test(cell));
  if (!looksJson || cell.length > MAX_JSON_CHARS) return null;
  try {
    JSON.parse(cell);
  } catch {
    return null;
  }
  return reindent(cell);
}

// The row as a JSON object, column name to cell, for "Copy row as JSON".
// Cells go in as they are: big integers and decimals are already strings,
// JSON values stay strings. A repeated name gets a suffix (id, id_2).
export function rowAsJson(columns: Column[], row: Cell[]): string {
  // Every real name is taken up front, so a suffix never steals a later
  // column's name.
  const taken = new Set(columns.map((c) => c.name));
  const seen = new Set<string>();
  // No prototype: a column named __proto__ must stay a column.
  const obj: Record<string, Cell> = Object.create(null);
  columns.forEach((c, i) => {
    let key = c.name;
    if (seen.has(key)) {
      let k = 2;
      while (taken.has(`${c.name}_${k}`)) k++;
      key = `${c.name}_${k}`;
      taken.add(key);
    }
    seen.add(c.name);
    obj[key] = row[i];
  });
  return JSON.stringify(obj, null, 2);
}
