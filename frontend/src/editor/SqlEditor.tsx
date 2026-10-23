import { useEffect, useRef } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { PostgreSQL, SQLite, StandardSQL, sql } from "@codemirror/lang-sql";
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Engine } from "@/lib/types";
import { clearNotice, runCurrent } from "@/state/runner";
import { mountView, savedState, unmountView } from "./states";

// The SQL editor: one EditorView, showing the active tab's EditorState.
// Switching tabs swaps the state in (document, selection and undo history
// come along) and keeps the outgoing one in editor/states.ts.

// The dialect follows the open database. lang-sql completes its keywords;
// schema completion comes with the structure browser.
const language = new Compartment();

function dialectFor(engine: Engine | null) {
  if (engine === "sqlite") return SQLite;
  if (engine === "postgres" || engine === "redshift") return PostgreSQL;
  return StandardSQL;
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
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklch, var(--muted) 45%, transparent)",
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
});

const runKeys = Prec.highest(
  keymap.of([
    { key: "Mod-Enter", run: () => (void runCurrent("statement"), true) },
    { key: "Shift-Mod-Enter", run: () => (void runCurrent("script"), true) },
  ]),
);

function newState(engine: Engine | null): EditorState {
  return EditorState.create({
    doc: "",
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
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap]),
      language.of(sql({ dialect: dialectFor(engine) })),
      EditorView.contentAttributes.of({ "aria-label": "SQL editor" }),
      // An edit clears the status bar's "Not connected." notice.
      EditorView.updateListener.of((u) => {
        if (u.docChanged) clearNotice();
      }),
    ],
  });
}

export function SqlEditor({ tabId, engine }: { tabId: string; engine: Engine | null }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const shown = useRef<string | null>(null);

  // One view for the component's life.
  useEffect(() => {
    const v = new EditorView({ parent: host.current! });
    view.current = v;
    return () => {
      if (shown.current) unmountView(shown.current);
      shown.current = null;
      v.destroy();
      view.current = null;
    };
  }, []);

  // Swap in the tab's state, keeping the previous tab's.
  useEffect(() => {
    const v = view.current;
    if (!v || shown.current === tabId) return;
    if (shown.current) unmountView(shown.current);
    v.setState(savedState(tabId) ?? newState(engine));
    v.dispatch({ effects: language.reconfigure(sql({ dialect: dialectFor(engine) })) });
    mountView(tabId, v);
    shown.current = tabId;
    v.focus();
    // engine is applied by the next effect; a tab switch alone must not
    // re-run this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // A different profile's engine: re-highlight for its dialect.
  useEffect(() => {
    view.current?.dispatch({ effects: language.reconfigure(sql({ dialect: dialectFor(engine) })) });
  }, [engine]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}
