import { type ReactNode, useMemo } from "react";
import { highlightCode, tagHighlighter, tags as t } from "@lezer/highlight";
import { parser } from "@lezer/json";
import { markPieces } from "./markPieces";

// Formatted JSON (grid/json.ts), highlighted with the SQL editor's colour
// variables (index.css), so it follows light and dark the same way. Spans,
// not a CodeMirror view: the panel can hold many values and only reads.
// ranges (grid/marks.ts) are the filter's matches, highlighted inside the
// colored tokens; they are offsets into text, a line break counting one.

const highlighter = tagHighlighter([
  { tag: t.propertyName, class: "text-(--sql-keyword)" },
  { tag: t.string, class: "text-(--sql-string)" },
  { tag: [t.number, t.bool, t.null], class: "text-(--sql-number)" },
  { tag: [t.brace, t.squareBracket, t.separator], class: "text-muted-foreground" },
]);

const NO_RANGES: ReadonlyArray<[number, number]> = [];

export function JsonCode({ text, ranges = NO_RANGES }: { text: string; ranges?: ReadonlyArray<[number, number]> }) {
  const nodes = useMemo(() => {
    const out: ReactNode[] = [];
    let at = 0;
    highlightCode(
      text,
      parser.parse(text),
      highlighter,
      (code, classes) => {
        const key = String(out.length);
        const pieces = ranges.length === 0 ? [code] : markPieces(code, at, ranges, key);
        at += code.length;
        out.push(
          classes ? (
            <span key={key} className={classes}>
              {pieces}
            </span>
          ) : pieces.length === 1 && typeof pieces[0] === "string" ? (
            pieces[0]
          ) : (
            <span key={key}>{pieces}</span>
          ),
        );
      },
      () => {
        out.push("\n");
        at += 1;
      },
    );
    return out;
  }, [text, ranges]);
  return <code className="block font-mono break-words whitespace-pre-wrap">{nodes}</code>;
}
