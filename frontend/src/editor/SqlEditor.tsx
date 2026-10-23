import { useEffect, useRef } from "react";
import { sql } from "@codemirror/lang-sql";
import { EditorView } from "@codemirror/view";
import type { Engine } from "@/lib/types";
import { dialectFor, language, newState } from "./setup";
import { mountView, savedState, seedOf, unmountView } from "./states";

// The SQL editor: one EditorView, showing the active tab's EditorState.
// Switching tabs swaps the state in (document, selection and undo history
// come along) and keeps the outgoing one in editor/states.ts. A restored
// tab, never shown yet, starts from its seed.

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
    v.setState(savedState(tabId) ?? newState(engine, seedOf(tabId), tabId));
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
