import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { PostgreSQL, type SQLNamespace, SQLite, StandardSQL, sql } from "@codemirror/lang-sql";
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { CompletionSchema, Engine } from "@/lib/types";
import { onEdit } from "@/state/persist";
import { clearNotice, runCurrent } from "@/state/runner";
import { columnCompletionSource } from "./columns";
import { statementHighlight } from "./statementHighlight";
import type { Seed } from "./states";

// A tab's editor state: the extensions every tab shares, and the text and
// selection a restored tab starts from (its seed, editor/states.ts). An
// edit or a selection change schedules a save of the tab's workspace.

// The dialect follows the open database, and lang-sql completes its
// keywords plus, while connected, the database's schema, table and column
// names (completion-schema, refreshed with the structure tree). Bare
// columns of the statement's tables come from editor/columns.ts.
export const language = new Compartment();

export function dialectFor(engine: Engine | null) {
  if (engine === "sqlite") return SQLite;
  if (engine === "postgres" || engine === "redshift") return PostgreSQL;
  return StandardSQL;
}

export interface Completion {
  schema: SQLNamespace; // namespaceOf(raw): dots escaped, for lang-sql
  defaultSchema?: string;
  raw: CompletionSchema; // as completion-schema returned it
}

export function languageFor(engine: Engine | null, completion: Completion | null) {
  const dialect = dialectFor(engine);
  if (!completion) return sql({ dialect });
  const support = sql({ dialect, schema: completion.schema, defaultSchema: completion.defaultSchema });
  return [support, support.language.data.of({ autocomplete: columnCompletionSource(completion.raw, engine) })];
}

// SQL colours from CSS variables (index.css), so the editor follows light
// and dark with the rest of the app.
const sqlHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--sql-keyword)" },
  { tag: [t.typeName, t.standard(t.name)], color: "var(--sql-type)" },
  { tag: [t.string, t.special(t.string)], color: "var(--sql-string)" },
  { tag: [t.number, t.bool, t.null], color: "var(--sql-number)" },
  { tag: [t.lineComment, t.blockComment], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "var(--muted-foreground)" },
]);

// The editor's chrome from the app's tokens. As an EditorView theme, not
// global CSS, so it outranks CodeMirror's base theme.
const chrome = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--background)", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklch, var(--muted) 45%, transparent)",
  },
  // The statement Mod-Enter will run, a quiet card behind the text.
  ".cm-currentStatement": {
    borderRadius: "6px",
    backgroundColor: "color-mix(in oklch, var(--muted) 70%, transparent)",
    boxShadow: "0 0 0 1px color-mix(in oklch, var(--border) 80%, transparent), 0 1px 2px rgb(0 0 0 / 0.05)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklch, var(--ring) 35%, transparent)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  // An icon marks a database object: a schema, a table (or an alias, which
  // stands for one) or a column. Keywords, SQL types and builtins get an
  // empty slot, so the labels stay aligned.
  ".cm-completionIcon": {
    width: "1.1em",
    textAlign: "center",
    fontFamily: "var(--font-sans)",
    fontSize: "9px",
    fontWeight: "600",
    color: "var(--muted-foreground)",
    opacity: "1",
  },
  ".cm-completionIcon-keyword:after, .cm-completionIcon-type:after, .cm-completionIcon-variable:after": {
    content: "''",
  },
  ".cm-completionIcon-schema:after": { content: "'S'", fontFamily: "var(--font-sans)" },
  ".cm-completionIcon-table:after, .cm-completionIcon-constant:after": {
    content: "'T'",
    fontFamily: "var(--font-sans)",
  },
  ".cm-completionIcon-property:after": { content: "'C'", fontFamily: "var(--font-sans)" },
});

const runKeys = Prec.highest(
  keymap.of([
    { key: "Mod-Enter", run: () => (void runCurrent("statement"), true) },
    { key: "Shift-Mod-Enter", run: () => (void runCurrent("script"), true) },
  ]),
);

// A seed's selection may point past its text (edited elsewhere since):
// clamped to the document.
function selectionOf(seed: Seed | undefined) {
  if (!seed) return undefined;
  const clamp = (n: number) => Math.max(0, Math.min(n, seed.text.length));
  return EditorSelection.single(clamp(seed.from), clamp(seed.to));
}

export function newState(engine: Engine | null, seed?: Seed, tabId?: string): EditorState {
  return EditorState.create({
    doc: seed?.text ?? "",
    selection: selectionOf(seed),
    extensions: [
      runKeys,
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      indentOnInput(),
      chrome,
      syntaxHighlighting(sqlHighlight),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      statementHighlight,
      highlightSelectionMatches(),
      // Tab accepts an open completion, otherwise it indents (Shift-Tab
      // dedents). Escape then Tab leaves the editor.
      keymap.of([
        { key: "Tab", run: acceptCompletion },
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
      ]),
      language.of(languageFor(engine, null)),
      EditorView.contentAttributes.of({ "aria-label": "SQL editor" }),
      // An edit clears the status bar's notice.
      EditorView.updateListener.of((u) => {
        if (u.docChanged) clearNotice();
        if (tabId && (u.docChanged || u.selectionSet)) onEdit(tabId);
      }),
    ],
  });
}
