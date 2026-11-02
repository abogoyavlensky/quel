import { tokens } from "./split";

// What a statement does, for the run policies (guard.ts):
//   read     returns data and changes nothing
//   session  changes only the session (SET, BEGIN, COMMIT, ...)
//   write    changes data or structure
//   unknown  might: Quel can't tell (CALL, DO, COPY, ...)
// It reads the statement's words (split.ts' tokens), never the database.
// A seatbelt, not a lock: `select f()` where f writes reads as read.

export type StatementClass = "read" | "session" | "write" | "unknown";

const READS = new Set(["values", "table", "show", "describe", "fetch"]);

const SESSION = new Set([
  "set", "reset", "begin", "start", "commit", "end", "rollback", "abort", "savepoint", "release",
  "discard", "deallocate", "prepare", "move", "listen", "unlisten",
]);

const WRITES = new Set([
  "insert", "update", "delete", "merge", "replace", "upsert", "create", "alter", "drop", "truncate",
  "grant", "revoke", "comment", "rename", "vacuum", "analyze", "analyse", "reindex", "cluster",
  "refresh", "lock", "attach", "detach", "checkpoint", "security", "import", "reassign",
]);

// Pragmas that act even without an argument.
const ACTING_PRAGMAS = new Set(["optimize", "wal_checkpoint", "incremental_vacuum"]);

// Pragmas whose parenthesised argument names what to read, not a value to set.
const READING_PRAGMAS = new Set([
  "table_info", "table_xinfo", "table_list", "index_info", "index_xinfo", "index_list",
  "foreign_key_list", "foreign_key_check", "integrity_check", "quick_check",
]);

const isName = (t: string) => t !== "(" && t !== ")" && t !== "=";

// SELECT ... INTO creates a table: `into` at depth 0 makes it a write.
function selectClass(ts: string[]): StatementClass {
  let depth = 0;
  for (const t of ts) {
    if (t === "(") depth++;
    else if (t === ")") depth--;
    else if (depth === 0 && t === "into") return "write";
  }
  return "read";
}

function withClass(ts: string[]): StatementClass {
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (t === "insert" || t === "delete" || t === "merge") return "write";
    if (t === "update" && ts[i - 1] !== "for" && ts[i - 1] !== "key") return "write";
  }
  let depth = 0;
  for (let i = 1; i < ts.length; i++) {
    const t = ts[i];
    if (t === "(") depth++;
    else if (t === ")") depth--;
    else if (depth === 0 && t === "select") return selectClass(ts.slice(i));
    else if (depth === 0 && t === "values") return "read";
  }
  return "unknown";
}

function explainClass(ts: string[]): StatementClass {
  let i = 1;
  let analyze = false;
  if (ts[i] === "(") {
    let depth = 0;
    for (; i < ts.length; i++) {
      if (ts[i] === "(") depth++;
      else if (ts[i] === ")") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      } else if (ts[i] === "analyze" || ts[i] === "analyse") analyze = true;
    }
  } else {
    while (ts[i] === "analyze" || ts[i] === "analyse" || ts[i] === "verbose") {
      if (ts[i] !== "verbose") analyze = true;
      i++;
    }
  }
  return analyze ? classifyTokens(ts.slice(i)) : "read";
}

function pragmaClass(ts: string[]): StatementClass {
  const stop = ts.findIndex((t, i) => i > 0 && !isName(t));
  const names = ts.slice(1, stop < 0 ? ts.length : stop);
  if (names.length === 0) return "unknown";
  const name = names[names.length - 1].replace(/^"/, "");
  if (ts.includes("=") || ACTING_PRAGMAS.has(name)) return "write";
  if (ts.includes("(") && !READING_PRAGMAS.has(name)) return "write";
  return "read";
}

function classifyTokens(ts: string[]): StatementClass {
  const head = ts[0];
  if (head === undefined) return "read";
  if (head === "select") return selectClass(ts);
  if (head === "with") return withClass(ts);
  if (head === "explain") return explainClass(ts);
  if (head === "pragma") return pragmaClass(ts);
  if (READS.has(head)) return "read";
  if (SESSION.has(head)) return "session";
  if (WRITES.has(head)) return "write";
  return "unknown";
}

export function classify(text: string): StatementClass {
  return classifyTokens(tokens(text));
}
