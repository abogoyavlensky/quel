import * as api from "@/lib/api";
import { currentInput, dropState } from "@/editor/states";
import type { Statement } from "@/sql/split";
import { type RunMode, toRun } from "@/sql/target";
import {
  type EditorTab,
  MESSAGES,
  activeTabOf,
  addMessage,
  closeCursors,
  ensureWorkspace,
  findTab,
  newTabState,
  selectedWorkspace,
  store,
  updateResult,
  updateTab,
  updateWorkspace,
  workspaceOfTab,
} from "./store";

// What the user does, as plain async functions over the store and the
// backend. Each profile has a workspace with its own connection and tabs;
// several can be connected at once, and nothing here touches another
// profile's workspace. Each editor tab is a backend session (its id is the
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

// Whether the profile is still connected on connId: a run started there
// and a disconnect (or a reconnect) meanwhile closed its cursors.
function stillOn(profileId: string, connId: string): boolean {
  const w = store.getState().workspaces[profileId];
  return w?.status === "connected" && w.connId === connId;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Run statements one after another in the tab's session. Each one that
// returns rows gets its own result tab; the run first drops the tab's
// unpinned results, and the open cursors of the pinned ones are closed by
// the backend as soon as the session runs again. The first error or a
// cancel stops the script.
export async function runStatements(tabId: string, statements: Statement[]): Promise<void> {
  const w = workspaceOfTab(tabId);
  const tab = findTab(tabId);
  if (!w || w.status !== "connected" || !w.connId || !tab || tab.runningQueryId || statements.length === 0) return;
  const { profileId, connId } = w;

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
      if (i > 0 && (current.stopping || !stillOn(profileId, connId))) break;
      const queryId = i === 0 ? firstId : newId();
      // This run closes the session's open cursor on the backend: an
      // earlier statement's result in this script has no more rows to give.
      updateTab(tabId, (t) => ({
        ...t,
        runningQueryId: queryId,
        results: t.results.map((r) => (r.cursor === "open" ? { ...r, cursor: "closed", fetching: false } : r)),
      }));
      try {
        const r = await api.run(connId, tabId, queryId, stmt.text);
        if (!findTab(tabId)) return;
        // The profile disconnected while this ran: its cursor is gone.
        const live = stillOn(profileId, connId);
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
                cursor: !r["has-more"] ? "done" : live ? "open" : "closed",
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
        // The last result may have been closed while the script ran on.
        active: !failed && lastResult && t.results.some((r) => r.id === lastResult) ? lastResult : MESSAGES,
      }));
    }
  }
}

// Run from the selected workspace's active editor: the statement under the
// cursor (or the selection's statements), or the whole script. A
// disconnected workspace sends nothing and says so in the status bar; one
// that is connecting drops the run, as a second run in flight is dropped.
export async function runCurrent(mode: RunMode): Promise<void> {
  const w = selectedWorkspace(store.getState());
  if (!w || w.status === "connecting") return;
  if (w.status !== "connected") {
    store.setState({ notice: "Not connected." });
    return;
  }
  const tabId = w.activeTab;
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

  const w = workspaceOfTab(tabId);
  if (w?.status !== "connected" || !w.connId) return;
  const { profileId, connId } = w;
  updateResult(tabId, resultId, (r) => ({ ...r, fetching: true }));
  updateTab(tabId, (t) => ({ ...t, runningQueryId: resultId }));
  try {
    const p = await api.fetchPage(resultId);
    if (!findTab(tabId)) return;
    const live = stillOn(profileId, connId);
    updateResult(tabId, resultId, (r) => {
      // Closed meanwhile (a disconnect, the result was replaced).
      if (r.cursor !== "open") return r;
      const rows = r.rows.concat(p.rows);
      if (rows.length >= maxRows && (p["has-more"] || rows.length > maxRows)) {
        if (p["has-more"] && !p.closed && live) void api.closeResult(resultId).catch(() => {});
        return { ...r, rows: rows.slice(0, maxRows), cursor: "capped" };
      }
      if (p.closed || !live) return { ...r, rows, cursor: p["has-more"] || p.closed ? "closed" : "done" };
      if (!p["has-more"]) return { ...r, rows, cursor: "done" };
      return { ...r, rows };
    });
  } catch (e) {
    if (!findTab(tabId)) return;
    const text = errorText(e);
    updateResult(tabId, resultId, (r) => (r.cursor === "open" ? { ...r, cursor: "closed" } : r));
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

// A new tab in the selected workspace.
export function newTab(): void {
  const profileId = store.getState().selected;
  if (profileId === null) return;
  updateWorkspace(profileId, (w) => {
    const tab = newTabState(w.nextTabNumber);
    return { ...w, tabs: [...w.tabs, tab], activeTab: tab.id, nextTabNumber: w.nextTabNumber + 1 };
  });
}

export function selectTab(tabId: string): void {
  const w = workspaceOfTab(tabId);
  if (w) updateWorkspace(w.profileId, (w) => ({ ...w, activeTab: tabId }));
}

// Close an editor tab: it leaves the store first, so its runner stops,
// then its backend session closes (cancelling what runs there) if its
// profile is connected. A workspace's last tab is replaced by a fresh one.
export async function closeTab(tabId: string): Promise<void> {
  const w = workspaceOfTab(tabId);
  if (!w) return;
  const i = w.tabs.findIndex((t) => t.id === tabId);
  updateWorkspace(w.profileId, (w) => {
    let rest = w.tabs.filter((t) => t.id !== tabId);
    let nextTabNumber = w.nextTabNumber;
    if (rest.length === 0) {
      rest = [newTabState(nextTabNumber)];
      nextTabNumber += 1;
    }
    const activeTab = w.activeTab === tabId ? rest[Math.min(i, rest.length - 1)].id : w.activeTab;
    return { ...w, tabs: rest, activeTab, nextTabNumber };
  });
  dropState(tabId);
  if (w.status === "connected" && w.connId) await api.closeSession(w.connId, tabId).catch(() => {});
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

// Show the profile's workspace, made on first select. Never connects.
export function selectProfile(id: string): void {
  ensureWorkspace(id);
  store.setState({ selected: id, notice: null });
}

// Connect the profile's workspace; the selection stays where it is. A
// connect while one is in flight, or on a connected profile, is dropped.
export async function connectProfile(id: string): Promise<void> {
  if (ensureWorkspace(id).status !== "disconnected") return;
  updateWorkspace(id, (w) => ({ ...w, status: "connecting", error: null }));
  store.setState({ notice: null });
  try {
    const opened = await api.connect(id);
    if (!store.getState().workspaces[id]) {
      // Dropped meanwhile: nothing will use this connection.
      void api.closeDb(opened["conn-id"]).catch(() => {});
      return;
    }
    updateWorkspace(id, (w) => ({ ...w, status: "connected", connId: opened["conn-id"] }));
  } catch (e) {
    updateWorkspace(id, (w) => ({ ...w, status: "disconnected", connId: null, error: errorText(e) }));
  }
}

// Disconnect the profile: its open results close, a run in flight there
// ends, and the backend closes the database with its sessions and cursors.
// The tabs and their text stay.
export async function disconnectProfile(id: string): Promise<void> {
  const w = store.getState().workspaces[id];
  if (w?.status !== "connected" || !w.connId) return;
  const connId = w.connId;
  updateWorkspace(id, (w) => ({ ...w, status: "disconnecting", error: null }));
  closeCursors(id);
  let error: string | null = null;
  try {
    await api.closeDb(connId);
  } catch (e) {
    error = errorText(e);
  }
  updateWorkspace(id, (w) => ({ ...w, status: "disconnected", connId: null, error }));
}

// The status bar's notice goes away on the next edit.
export function clearNotice(): void {
  if (store.getState().notice !== null) store.setState({ notice: null });
}

// The selected workspace's active tab, for the menu actions.
export function selectedTabId(): string | null {
  const w = selectedWorkspace(store.getState());
  return w ? activeTabOf(w).id : null;
}
