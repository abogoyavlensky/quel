import { useMemo } from "react";
import { highlightCode, tagHighlighter, tags as t } from "@lezer/highlight";
import { parser } from "@lezer/json";

// Formatted JSON (grid/json.ts), highlighted with the SQL editor's colour
// variables (index.css), so it follows light and dark the same way. Spans,
// not a CodeMirror view: the panel can hold many values and only reads.

const highlighter = tagHighlighter([
  { tag: t.propertyName, class: "text-(--sql-keyword)" },
  { tag: t.string, class: "text-(--sql-string)" },
  { tag: [t.number, t.bool, t.null], class: "text-(--sql-number)" },
  { tag: [t.brace, t.squareBracket, t.separator], class: "text-muted-foreground" },
]);

export function JsonCode({ text }: { text: string }) {
  const nodes = useMemo(() => {
    const out: React.ReactNode[] = [];
    highlightCode(
      text,
      parser.parse(text),
      highlighter,
      (code, classes) => {
        out.push(
          classes ? (
            <span key={out.length} className={classes}>
              {code}
            </span>
          ) : (
            code
          ),
        );
      },
      () => {
        out.push("\n");
      },
    );
    return out;
  }, [text]);
  return <code className="block font-mono break-words whitespace-pre-wrap">{nodes}</code>;
}
