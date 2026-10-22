// Splits a SQL script into statements, so the editor can run the one under
// the cursor and the backend always receives single statements.
//
// One pass over the text. A `;` ends a statement unless it sits inside a
// string ('...', with '' and, after E, backslash escapes), a quoted
// identifier ("...", `...`, [...]), a dollar-quoted body ($tag$...$tag$),
// a comment (-- to the end of the line, /* */ nested as Postgres allows),
// or a block body. A `[` quotes an identifier (SQLite) only where one can
// start, not straight after a word or a `]` or `)`, where it is a
// Postgres array subscript or type (`a[1]`, `int[]`, `ARRAY[...]`).
//
// Block bodies are SQLite's CREATE TRIGGER ... BEGIN ... END and the
// SQL-standard BEGIN ATOMIC ... END (Postgres 14+). In those statements
// only, BEGIN and CASE open a level. END closes a CASE level, or a BEGIN
// level where a statement can start (after `;` or BEGIN), so a table named
// `end` inside the body does not. Anywhere else BEGIN is a plain word, so
// `begin; ...; commit;` splits as it should. An unterminated quote or
// comment runs to the end of the text.

export interface Statement {
  from: number; // offset of its first character (a leading comment included)
  to: number; // offset just past its last character, before the `;`
  text: string;
}

// Unquoted identifiers, Postgres' rules: letters (any script), digits, _
// and $, not starting with a digit or $.
const isIdentStart = (c: string) => /[\p{L}_]/u.test(c);
const isIdentChar = (c: string) => /[\p{L}\p{N}_$]/u.test(c);
const isSpace = (c: string) => /\s/.test(c);

// create [or replace] [temp|temporary] trigger
function isTriggerHead(words: string[]): boolean {
  let i = 0;
  if (words[i++] !== "create") return false;
  if (words[i] === "or" && words[i + 1] === "replace") i += 2;
  if (words[i] === "temp" || words[i] === "temporary") i++;
  return words[i] === "trigger";
}

// The end of a quoted run starting at i (the opening quote), past the
// closing one; text.length if it never closes.
function skipQuoted(text: string, i: number, close: string, backslash: boolean): number {
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (backslash && c === "\\") {
      j += 2;
    } else if (c === close) {
      if (text[j + 1] === close && close !== "]") j += 2; // a doubled quote
      else return j + 1;
    } else {
      j++;
    }
  }
  return text.length;
}

function skipBlockComment(text: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < text.length) {
    if (text.startsWith("/*", j)) {
      depth++;
      j += 2;
    } else if (text.startsWith("*/", j)) {
      depth--;
      j += 2;
      if (depth === 0) return j;
    } else {
      j++;
    }
  }
  return text.length;
}

const dollarTag = /\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/uy;

export function split(text: string): Statement[] {
  const out: Statement[] = [];
  let start = -1; // first non-space character of the current statement
  let end = -1; // just past its last non-space character
  let hasCode = false; // anything but comments?
  let words: string[] = [];
  let block = false;
  let levels: ("begin" | "case")[] = []; // open BEGIN / CASE levels in a block
  let last = ""; // the previous token: a word (lower-cased) or a character

  const finish = () => {
    if (hasCode) out.push({ from: start, to: end, text: text.slice(start, end) });
    start = -1;
    end = -1;
    hasCode = false;
    words = [];
    block = false;
    levels = [];
    last = "";
  };
  // Mark [from, to) as part of the current statement.
  const take = (from: number, to: number, code: boolean) => {
    if (start < 0) start = from;
    end = to;
    if (code) hasCode = true;
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const prev = i > 0 ? text[i - 1] : "";

    if (isSpace(c)) {
      i++;
    } else if (c === ";" && levels.length === 0) {
      finish();
      i++;
    } else if (c === ";") {
      take(i, i + 1, true);
      last = ";";
      i++;
    } else if (c === "-" && text[i + 1] === "-") {
      const nl = text.indexOf("\n", i);
      const j = nl < 0 ? text.length : nl;
      take(i, j, false);
      i = j;
    } else if (c === "/" && text[i + 1] === "*") {
      const j = skipBlockComment(text, i);
      take(i, j, false);
      i = j;
    } else if (c === "'") {
      // E'...' / e'...': the E was taken as a word just before.
      const escaped = (prev === "E" || prev === "e") && !(i > 1 && isIdentChar(text[i - 2]));
      const j = skipQuoted(text, i, "'", escaped);
      take(i, j, true);
      i = j;
    } else if (c === '"' || c === "`") {
      const j = skipQuoted(text, i, c, false);
      take(i, j, true);
      i = j;
    } else if (c === "[" && !(isIdentChar(prev) || prev === "]" || prev === ")")) {
      const j = skipQuoted(text, i, "]", false);
      take(i, j, true);
      i = j;
    } else if (c === "$" && !isIdentChar(prev)) {
      dollarTag.lastIndex = i;
      const m = dollarTag.exec(text);
      if (m) {
        const close = text.indexOf(m[0], i + m[0].length);
        const j = close < 0 ? text.length : close + m[0].length;
        take(i, j, true);
        i = j;
      } else {
        take(i, i + 1, true);
        i++;
      }
    } else if (isIdentStart(c)) {
      let j = i + 1;
      while (j < text.length && isIdentChar(text[j])) j++;
      const word = text.slice(i, j).toLowerCase();
      take(i, j, true);
      i = j;
      if (block) {
        const top = levels[levels.length - 1];
        if (word === "begin" || word === "case") levels.push(word);
        else if (word === "end" && (top === "case" || (top === "begin" && (last === ";" || last === "begin"))))
          levels.pop();
      } else if (word === "atomic" && last === "begin") {
        block = true;
        levels = ["begin"];
      }
      words.push(word);
      last = word;
      if (!block && words.length <= 6 && isTriggerHead(words)) block = true;
    } else {
      take(i, i + 1, true);
      last = c;
      i++;
    }
  }
  finish();
  return out;
}
