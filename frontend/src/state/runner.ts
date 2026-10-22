import * as api from "@/lib/api";
import { currentInput, dropState } from "@/editor/states";
import type { Statement } from "@/sql/split";
import { type RunMode, toRun } from "@/sql/target";
import {
  type EditorTab,
  MESSAGES,
  addMessage,
  closeAllCursors,
  findTab,
  newTabState,
  store,
  updateResult,
  updateTab,
} from "./store";

// What the user does, as plain async functions over the store and the
// backend. Each editor tab is a backend session (its id is the
// session-id), and one statement or page is in flight per tab at a time
// (runningQueryId): a second run while one is in flight is dropped, which
// also makes a shortcut that fires twice (the native menu and the
// editor's keymap) harmless.
//
// Every await is followed by a check that the tab still exists. A closed
// tab's late reply is dropped, and its script sends nothing more: another
// run would only be refused (the backend retires a closed tab's session).

// The most rows a result loads; past it, the cursor is closed.
export const MAX_ROWS = 100_000;

const newId = () => crypto.randomUUID();

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Run statements one after another in the tab's session. Each one that
// returns rows gets its own result tab; the run first drops the tab's
// unpinned results, and the open cursors of the pinned ones are closed by
// the backend as soon as the session runs again. The first error or a
// cancel stops the script.
export async function runStatements(tabId: string, statements: Statement[]): Promise<void> {
  const { conn, switching } = store.getState();
  const tab = findTab(tabId);
  if (!conn || switching || !tab || tab.runningQueryId || statements.length === 0) return;

  const firstId = newId();
  for (const r of tab.results) {
    if (!r.pinned && r.cursor === "open") void api.closeResult(r.id).catch(() => {});
  }
  updateTab(tabId, (t) => ({
    ...t,
    runningQueryId: firstId,
    stopping: false,
    results: t.results
      .filter((r) => r.pinned)
      .map((r) => (r.cursor === "open" ? { ...r, cursor: "closed", fetching: false } : r)),
    active: t.results.some((r) => r.pinned && r.id === t.active) ? t.active : MESSAGES,
  }));

  let lastResult: string | null = null;
  let failed = false;
  try {
    for (const [i, stmt] of statements.entries()) {
      const current = findTab(tabId);
      if (!current) return;
      if (i > 0 && (current.stopping || store.getState().conn?.connId !== conn.connId)) break;
      const queryId = i === 0 ? firstId : newId();
      updateTab(tabId, (t) => ({ ...t, runningQueryId: queryId }));
      try {
        const r = await api.run(conn.connId, tabId, queryId, stmt.text);
        if (!findTab(tabId)) return;
        if (r.columns.length > 0) {
          lastResult = queryId;
          updateTab(tabId, (t) => ({
            ...t,
            results: [
              ...t.results,
              {
                id: queryId,
                sql: stmt.text,
                columns: r.columns,
                rows: r.rows,
                cursor: r["has-more"] ? "open" : "done",
                fetching: false,
                pinned: false,
                elapsedMs: r["elapsed-ms"],
              },
            ],
          }));
          addMessage(tabId, {
            sql: stmt.text,
            kind: "rows",
            text: plural(r.rows.length, "row", "rows") + (r["has-more"] ? ", more available" : ""),
            elapsedMs: r["elapsed-ms"],
          });
        } else {
          const n = r["update-count"];
          addMessage(tabId, {
            sql: stmt.text,
            kind: "update",
            text: n === null ? "Done" : plural(n, "row affected", "rows affected"),
            elapsedMs: r["elapsed-ms"],
          });
        }
      } catch (e) {
        if (!findTab(tabId)) return;
        const text = errorText(e);
        addMessage(tabId, {
          sql: stmt.text,
          kind: text.startsWith("Query canceled.") ? "canceled" : "error",
          text,
          elapsedMs: null,
        });
        failed = true;
        break;
      }
    }
  } finally {
    if (findTab(tabId)) {
      updateTab(tabId, (t) => ({
        ...t,
        runningQueryId: null,
        stopping: false,
        active: failed || !lastResult ? MESSAGES : lastResult,
      }));
    }
  }
}

// Run from the active tab's editor: the statement under the cursor (or the
// selection's statements), or the whole script.
export async function runCurrent(mode: RunMode): Promise<void> {
  const tabId = store.getState().activeTab;
  const { text, selection } = currentInput(tabId);
  await runStatements(tabId, toRun(text, selection, mode));
}

// Load the next page of an open result, up to maxRows in all.
export async function fetchMore(tabId: string, resultId: string, maxRows = MAX_ROWS): Promise<void> {
  const tab = findTab(tabId);
  const result = tab?.results.find((r) => r.id === resultId);
  if (!tab || !result || result.cursor !== "open" || result.fetching || tab.runningQueryId) return;
  if (result.rows.length >= maxRows) {
    void api.closeResult(resultId).catch(() => {});
    updateResult(tabId, resultId, (r) => ({ ...r, cursor: "capped" }));
    return;
  }

  updateResult(tabId, resultId, (r) => ({ ...r, fetching: true }));
  updateTab(tabId, (t) => ({ ...t, runningQueryId: resultId }));
  try {
    const p = await api.fetchPage(resultId);
    if (!findTab(tabId)) return;
    updateResult(tabId, resultId, (r) => {
      const rows = r.rows.concat(p.rows);
      if (p.closed) return { ...r, rows, cursor: "closed" };
      if (!p["has-more"]) return { ...r, rows, cursor: "done" };
      if (rows.length >= maxRows) {
        void api.closeResult(resultId).catch(() => {});
        return { ...r, rows: rows.slice(0, maxRows), cursor: "capped" };
      }
      return { ...r, rows };
    });
  } catch (e) {
    if (!findTab(tabId)) return;
    const text = errorText(e);
    updateResult(tabId, resultId, (r) => ({ ...r, cursor: "closed" }));
    addMessage(tabId, {
      sql: result.sql,
      kind: text.startsWith("Query canceled.") ? "canceled" : "error",
      text,
      elapsedMs: null,
    });
  } finally {
    if (findTab(tabId)) {
      updateResult(tabId, resultId, (r) => ({ ...r, fetching: false }));
      updateTab(tabId, (t) => ({ ...t, runningQueryId: null }));
    }
  }
}

// Cancel what the tab has in flight; a script stops after it.
export function cancel(tabId: string): void {
  const tab = findTab(tabId);
  if (!tab?.runningQueryId) return;
  updateTab(tabId, (t) => ({ ...t, stopping: true }));
  void api.cancel(tab.runningQueryId).catch(() => {});
}

export function newTab(): void {
  store.setState((s) => {
    const tab = newTabState(s.nextTabNumber);
    return { tabs: [...s.tabs, tab], activeTab: tab.id, nextTabNumber: s.nextTabNumber + 1 };
  });
}

export function selectTab(tabId: string): void {
  if (findTab(tabId)) store.setState({ activeTab: tabId });
}

// Close an editor tab: it leaves the store first, so its runner stops,
// then its backend session closes (cancelling what runs there). The last
// tab is replaced by a fresh one.
export async function closeTab(tabId: string): Promise<void> {
  const { conn, tabs } = store.getState();
  const i = tabs.findIndex((t) => t.id === tabId);
  if (i < 0) return;
  store.setState((s) => {
    let rest = s.tabs.filter((t) => t.id !== tabId);
    let nextTabNumber = s.nextTabNumber;
    if (rest.length === 0) {
      rest = [newTabState(nextTabNumber)];
      nextTabNumber += 1;
    }
    const activeTab = s.activeTab === tabId ? rest[Math.min(i, rest.length - 1)].id : s.activeTab;
    return { tabs: rest, activeTab, nextTabNumber };
  });
  dropState(tabId);
  if (conn) await api.closeSession(conn.connId, tabId).catch(() => {});
}

export function selectResult(tabId: string, id: string): void {
  updateTab(tabId, (t) => ({ ...t, active: id }));
}

export function pin(tabId: string, resultId: string): void {
  updateResult(tabId, resultId, (r) => ({ ...r, pinned: !r.pinned }));
}

export function closeResult(tabId: string, resultId: string): void {
  const r = findTab(tabId)?.results.find((x) => x.id === resultId);
  if (!r) return;
  if (r.cursor === "open") void api.closeResult(resultId).catch(() => {});
  updateTab(tabId, (t: EditorTab) => {
    const results = t.results.filter((x) => x.id !== resultId);
    const active = t.active === resultId ? (results.at(-1)?.id ?? MESSAGES) : t.active;
    return { ...t, results, active };
  });
}

// Open a database (a file path or a postgres:// URL) in place of the
// current one. Opening and closing are serialized: a request while one is
// in flight is dropped.
export async function openDb(target: string): Promise<void> {
  await switchDb(target);
}

export async function closeDb(): Promise<void> {
  await switchDb(null);
}

async function switchDb(next: string | null): Promise<void> {
  if (store.getState().switching) return;
  store.setState({ switching: true, dbError: null });
  try {
    const current = store.getState().conn;
    if (current) {
      store.setState({ conn: null });
      closeAllCursors();
      await api.closeDb(current.connId);
    }
    if (next !== null) {
      const opened = await api.openDb(next);
      store.setState({ conn: { connId: opened["conn-id"], engine: opened.engine, label: opened.label } });
    }
  } catch (e) {
    store.setState({ dbError: errorText(e) });
  } finally {
    store.setState({ switching: false });
  }
}
