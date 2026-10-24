import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import type { CompletionSchema, Engine } from "@/lib/types";

// Bare column names from the tables of the statement under the cursor.
// lang-sql completes along paths only: schema and table names, and a
// table's or alias's columns after a dot (`c.▮`). This source adds the
// columns of the tables a statement reads from (FROM, JOIN, UPDATE, INSERT
// INTO) wherever a bare column can go (`select em▮ from customers`), from
// the same completion-schema. CodeMirror merges both sources' options.
//
// lang-sql's tree is flat: a statement's tokens are its direct children,
// and a parenthesised group (a subquery, an argument or column list) is a
// Parens node holding its own tokens.

type Node = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

// Nodes a name can be: lang-sql parses many everyday names as keywords
// (`name`, `user`, `data`) or types (`text`, `date`).
const WORD = new Set(["Identifier", "QuotedIdentifier", "Keyword", "Type"]);
const NAME = new Set([...WORD, "CompositeIdentifier"]);
const COMMENT = new Set(["LineComment", "BlockComment"]);
// A table name follows these; FROM and JOIN start a comma-separated list
// that the others end. A join's ON or USING does not end it
// (`from a join b on ..., c`).
const TABLE_AFTER = new Set(["from", "join", "update", "into", "table"]);
const END_FROM = new Set(
  "where group having order union intersect except limit offset fetch for set values".split(" "),
);
// Between a table keyword and its table (`from only t`, `join lateral`).
const TABLE_MODIFIER = new Set(["only", "lateral"]);
// Each SELECT sees its own tables only: a compound query's SELECTs, and
// the SELECT of an INSERT ... SELECT apart from the target's column list.
const BRANCH = new Set(["select", "union", "intersect", "except"]);
// An INSERT's clauses after its SELECT, back on the target's table.
const TARGET_AGAIN = new Set(["returning", "conflict"]);

// Reserved words, applied quoted. From PostgreSQL 17's Appendix C, SQL Key
// Words: the words marked "reserved" and "reserved (can be function or
// type)".
const POSTGRES = [
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "authorization",
  "binary", "both", "case", "cast", "check", "collate", "collation", "column", "concurrently",
  "constraint", "create", "cross", "current_catalog", "current_date", "current_role",
  "current_schema", "current_time", "current_timestamp", "current_user", "default", "deferrable",
  "desc", "distinct", "do", "else", "end", "except", "false", "fetch", "for", "foreign", "freeze",
  "from", "full", "grant", "group", "having", "ilike", "in", "initially", "inner", "intersect",
  "into", "is", "isnull", "join", "lateral", "leading", "left", "like", "limit", "localtime",
  "localtimestamp", "natural", "not", "notnull", "null", "offset", "on", "only", "or", "order",
  "outer", "overlaps", "placing", "primary", "references", "returning", "right", "select",
  "session_user", "similar", "some", "symmetric", "system_user", "table", "tablesample", "then",
  "to", "trailing", "true", "union", "unique", "user", "using", "variadic", "verbose", "when",
  "where", "window", "with",
];

// Amazon Redshift's Reserved words page, less the words above.
const REDSHIFT_EXTRA = [
  "aes128", "aes256", "allowoverwrite", "az64", "backup", "between", "blanksasnull", "bytedict",
  "bzip2", "credentials", "current_user_id", "deflate", "defrag", "delta", "delta32k", "disable",
  "emptyasnull", "enable", "encode", "encrypt", "encryption", "explicit", "globaldict256",
  "globaldict64k", "gzip", "identity", "ignore", "interval", "lun", "luns", "lzo", "lzop", "minus",
  "mostly16", "mostly32", "mostly8", "new", "nulls", "off", "offline", "oid", "old", "open",
  "parallel", "partition", "percent", "permissions", "pivot", "raw", "readratio", "recover",
  "rejectlog", "resort", "respect", "restore", "snapshot", "sysdate", "system", "tag", "tdes",
  "text255", "text32k", "timestamp", "top", "truncatecolumns", "unnest", "unpivot", "wallet",
  "without",
];

// sqlite.org's SQLite Keywords page (lang_keywords.html), all 147.
const SQLITE = [
  "abort", "action", "add", "after", "all", "alter", "always", "analyze", "and", "as", "asc",
  "attach", "autoincrement", "before", "begin", "between", "by", "cascade", "case", "cast", "check",
  "collate", "column", "commit", "conflict", "constraint", "create", "cross", "current",
  "current_date", "current_time", "current_timestamp", "database", "default", "deferrable",
  "deferred", "delete", "desc", "detach", "distinct", "do", "drop", "each", "else", "end", "escape",
  "except", "exclude", "exclusive", "exists", "explain", "fail", "filter", "first", "following",
  "for", "foreign", "from", "full", "generated", "glob", "group", "groups", "having", "if",
  "ignore", "immediate", "in", "index", "indexed", "initially", "inner", "insert", "instead",
  "intersect", "into", "is", "isnull", "join", "key", "last", "left", "like", "limit", "match",
  "materialized", "natural", "no", "not", "nothing", "notnull", "null", "nulls", "of", "offset",
  "on", "or", "order", "others", "outer", "over", "partition", "plan", "pragma", "preceding",
  "primary", "query", "raise", "range", "recursive", "references", "regexp", "reindex", "release",
  "rename", "replace", "restrict", "returning", "right", "rollback", "row", "rows", "savepoint",
  "select", "set", "table", "temp", "temporary", "then", "ties", "to", "transaction", "trigger",
  "unbounded", "union", "unique", "update", "using", "vacuum", "values", "view", "virtual", "when",
  "where", "window", "with", "without",
];

const RESERVED: Record<Engine, Set<string>> = {
  postgres: new Set(POSTGRES),
  redshift: new Set([...POSTGRES, ...REDSHIFT_EXTRA]),
  sqlite: new Set(SQLITE),
};
// No profile, no engine: quote what any of them reserves.
const ANY_RESERVED = new Set([...POSTGRES, ...REDSHIFT_EXTRA, ...SQLITE]);

const textOf = (doc: Text, n: Node) => doc.sliceString(n.from, n.to);
const keyword = (doc: Text, n: Node) => (n.name === "Keyword" ? textOf(doc, n).toLowerCase() : null);
const closing = (open: string) => (open === "[" ? "]" : open);

// Walks a scope's direct children up to `upTo`, handing `table` each one
// in a table position. Returns whether the position after the last one is
// a table position. A derived table (a Parens there) is skipped.
function walk(doc: Text, scope: Node, upTo: number, table?: (n: Node) => void): boolean {
  let inFrom = false;
  let expect = false;
  for (let n = scope.firstChild; n && n.to <= upTo; n = n.nextSibling) {
    if (COMMENT.has(n.name)) continue;
    const kw = keyword(doc, n);
    if (kw && TABLE_AFTER.has(kw)) {
      expect = true;
      if (kw === "from" || kw === "join") inFrom = true;
      continue;
    }
    if (kw && END_FROM.has(kw)) {
      inFrom = expect = false;
      continue;
    }
    if (expect && kw && TABLE_MODIFIER.has(kw)) continue;
    if (expect && NAME.has(n.name)) table?.(n);
    expect = inFrom && n.name === "Punctuation" && textOf(doc, n) === ",";
  }
  return expect;
}

interface Slot {
  from: number;
  to?: number; // the end of a closed quoted name the cursor is inside
  quote: string | null; // the opening quote when inside a quoted name
  container: Node; // the Statement or Parens holding the cursor
}

// The node directly holding an empty cursor position: the Statement or
// Parens it is inside. A closed Parens ending at the cursor is behind it,
// and so is a statement ended with `;`.
function containerAt(node: Node, pos: number): Node | null {
  for (let n: Node | null = node; n; n = n.parent) {
    if (n.name === "Parens" && (n.to > pos || n.lastChild?.name !== ")")) return n;
    if (n.name === "Statement") return n.lastChild?.name === ";" && n.to <= pos ? null : n;
    if (n.name === "Script") {
      const before = n.childBefore(pos);
      return before?.name === "Statement" ? containerAt(before, pos) : null;
    }
    if (n.name === "CompositeIdentifier" || n.name === "." || n.name === "String" || COMMENT.has(n.name)) return null;
  }
  return null;
}

// Where the completion goes, or null when a bare column does not belong
// there: a qualified name (lang-sql's), a string, a comment, a table
// position, or an empty position without an explicit request.
function shouldAnswer(context: CompletionContext): Slot | null {
  const { state, pos, explicit } = context;
  const node = syntaxTree(state).resolveInner(pos, -1);
  let slot: Slot;
  if (WORD.has(node.name) && node.parent) {
    if (node.parent.name === "CompositeIdentifier") return null;
    const quote = node.name === "QuotedIdentifier" ? state.doc.sliceString(node.from, node.from + 1) : null;
    const closed = quote !== null && node.to - node.from > 1 && state.doc.sliceString(node.to - 1, node.to) === closing(quote);
    slot = { from: node.from, to: closed ? node.to : undefined, quote, container: node.parent };
  } else {
    const container = explicit ? containerAt(node, pos) : null;
    if (!container) return null;
    slot = { from: pos, quote: null, container };
  }
  return walk(state.doc, slot.container, slot.from) ? null : slot;
}

// The innermost subquery (a Parens with a SELECT) or else the statement.
function scopeOf(doc: Text, container: Node): Node | null {
  for (let n: Node | null = container; n; n = n.parent) {
    if (n.name === "Statement") return n;
    if (n.name === "Parens") {
      for (let c = n.firstChild; c; c = c.nextSibling) if (keyword(doc, c) === "select") return n;
    }
  }
  return null;
}

interface Part {
  name: string;
  quoted: boolean;
}

// A name as written: one pair of quotes stripped, a doubled closing quote
// inside them undoubled.
function partOf(doc: Text, n: Node): Part {
  const text = textOf(doc, n);
  const m = /^(["`[])([\s\S]*)(["`\]])$/.exec(text);
  if (!m || closing(m[1]) !== m[3]) return { name: text, quoted: false };
  return { name: m[2].split(m[3] + m[3]).join(m[3]), quoted: true };
}

// The scope's tables as paths: `[table]` or `[schema, table]`, only those
// of the branch around `pos` (BRANCH). After RETURNING or ON CONFLICT, the
// branch is the one before the first SELECT: an INSERT's target.
function tablesIn(doc: Text, scope: Node, pos: number): Part[][] {
  let from = scope.from;
  let to = scope.to;
  let firstBranch = scope.to;
  let target = false;
  for (let n = scope.firstChild; n; n = n.nextSibling) {
    const kw = keyword(doc, n) ?? "";
    if (TARGET_AGAIN.has(kw)) {
      if (n.to <= pos) target = true;
      else to = Math.min(to, n.from);
    }
    if (!BRANCH.has(kw)) continue;
    firstBranch = Math.min(firstBranch, n.from);
    if (n.to <= pos) from = n.to;
    else if (n.from >= pos) to = Math.min(to, n.from);
  }
  if (target) [from, to] = [scope.from, firstBranch];
  const paths: Part[][] = [];
  walk(doc, scope, to, (n) => {
    if (n.from < from) return;
    if (n.name !== "CompositeIdentifier") return paths.push([partOf(doc, n)]);
    const path: Part[] = [];
    for (let c = n.firstChild; c; c = c.nextSibling) if (WORD.has(c.name)) path.push(partOf(doc, c));
    if (path.length) paths.push(path.slice(-2));
  });
  return paths;
}

// One name among `names` by the engine's rules. On Postgres and Redshift
// a quoted name matches exactly and an unquoted one folded to lower case;
// SQLite matches either case-insensitively (an exact match first).
function pick(names: string[], part: Part, engine: Engine | null): string | undefined {
  if (engine === "postgres" || engine === "redshift") {
    const name = part.quoted ? part.name : part.name.toLowerCase();
    return names.find((n) => n === name);
  }
  const lower = part.name.toLowerCase();
  return names.find((n) => n === part.name) ?? names.find((n) => n.toLowerCase() === lower);
}

interface Table {
  name: string;
  columns: string[];
}

// A path's table in the schema. A bare name is looked up in the default
// schema, else in the one other schema that has it; several is a guess,
// and skipped.
function resolve(c: CompletionSchema, path: Part[], engine: Engine | null): Table | null {
  const table = (schema: string, part: Part): Table | null => {
    const name = pick(Object.keys(c.schemas[schema]), part, engine);
    return name === undefined ? null : { name, columns: c.schemas[schema][name] };
  };
  if (path.length === 2) {
    const schema = pick(Object.keys(c.schemas), path[0], engine);
    return schema === undefined ? null : table(schema, path[1]);
  }
  const def = c["default-schema"];
  const inDefault = def !== null && Object.hasOwn(c.schemas, def) ? table(def, path[0]) : null;
  if (inDefault) return inDefault;
  const found = Object.keys(c.schemas)
    .filter((s) => s !== def)
    .map((s) => table(s, path[0]))
    .filter((t) => t !== null);
  return found.length === 1 ? found[0] : null;
}

const plain = /^[a-z_][a-z_\d]*$/;

function quoted(name: string, open = '"') {
  const close = closing(open);
  return open + name.split(close).join(close + close) + close;
}

// The tables' columns, each once, in statement order. Inside a quoted name
// the labels carry the quotes; otherwise only `apply` does, when the name
// needs them.
function options(tables: Table[], engine: Engine | null, quote: string | null): Completion[] {
  const reserved = engine ? RESERVED[engine] : ANY_RESERVED;
  const byName = new Map<string, string[]>();
  for (const t of tables) {
    for (const col of t.columns) {
      const names = byName.get(col) ?? [];
      if (!names.includes(t.name)) names.push(t.name);
      byName.set(col, names);
    }
  }
  return [...byName].map(([name, names]) => {
    const base = { type: "property", detail: names.join(", "), boost: 5 };
    if (quote) return { label: quoted(name, quote), ...base };
    if (!plain.test(name) || reserved.has(name)) return { label: name, apply: quoted(name), ...base };
    return { label: name, ...base };
  });
}

export function columnCompletionSource(schema: CompletionSchema, engine: Engine | null): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const slot = shouldAnswer(context);
    if (!slot) return null;
    const { doc } = context.state;
    const scope = scopeOf(doc, slot.container);
    if (!scope) return null;
    const tables = tablesIn(doc, scope, slot.from)
      .map((path) => resolve(schema, path, engine))
      .filter((t) => t !== null);
    const opts = options(tables, engine, slot.quote);
    if (!opts.length) return null;
    return { from: slot.from, to: slot.to, options: opts, validFor: /^[\w"]*$/ };
  };
}
