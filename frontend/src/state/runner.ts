import * as api from "@/lib/api";
import { metaKeys, queryClient } from "@/lib/query";
import type { SavedWorkspace } from "@/lib/types";
import { currentInput, dropState, seed } from "@/editor/states";
import type { Statement } from "@/sql/split";
import { type RunMode, toRun } from "@/sql/target";
import {
  cancelSave,
  enqueue,
  flushSave,
  markClosing,
  rememberSelection,
  scheduleSave,
  unmarkClosing,
} from "./persist";
import {
  type EditorTab,
  MAX_CLOSED,
  MESSAGES,
  type Workspace,
  activeTabOf,
  addMessage,
  closeCursors,
  findTab,
  newTabState,
  newWorkspace,
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
//
// Every change to a workspace's tabs schedules a save (state/persist.ts).

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

// A tab's run epoch: closing the tab ends the runs and page loads it had
// in flight, even when a failed close then brings the tab back.
const epochs = new Map<string, number>();
const epochOf = (tabId: string) => epochs.get(tabId) ?? 0;

// Whether a run or page load started at epoch in the tab may go on.
function aliveFn(tabId: string): () => boolean {
  const epoch = epochOf(tabId);
  return () => epochOf(tabId) === epoch && findTab(tabId) !== undefined;
}

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
  const alive = aliveFn(tabId);

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
      const current = alive() ? findTab(tabId) : undefined;
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
        if (!alive()) return;
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
                selectedRow: null,
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
        if (!alive()) return;
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
    if (alive()) {
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
  const alive = aliveFn(tabId);
  updateResult(tabId, resultId, (r) => ({ ...r, fetching: true }));
  updateTab(tabId, (t) => ({ ...t, runningQueryId: resultId }));
  try {
    const p = await api.fetchPage(resultId);
    if (!alive()) return;
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
    if (!alive()) return;
    const text = errorText(e);
    updateResult(tabId, resultId, (r) => (r.cursor === "open" ? { ...r, cursor: "closed" } : r));
    addMessage(tabId, {
      sql: result.sql,
      kind: text.startsWith("Query canceled.") ? "canceled" : "error",
      text,
      elapsedMs: null,
    });
  } finally {
    if (alive()) {
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
  const w = profileId === null ? undefined : store.getState().workspaces[profileId];
  if (!w || w.loadError) return;
  updateWorkspace(w.profileId, (w) => {
    const tab = newTabState(w.nextTabNumber);
    return { ...w, tabs: [...w.tabs, tab], activeTab: tab.id, nextTabNumber: w.nextTabNumber + 1 };
  });
  scheduleSave(w.profileId);
}

export function selectTab(tabId: string): void {
  const w = workspaceOfTab(tabId);
  if (!w || w.activeTab === tabId) return;
  updateWorkspace(w.profileId, (w) => ({ ...w, activeTab: tabId }));
  scheduleSave(w.profileId);
}

// Rename a tab. A blank name keeps the old one; names need not be unique.
export function renameTab(tabId: string, title: string): void {
  const w = workspaceOfTab(tabId);
  const name = title.trim();
  if (!w || w.loadError || !name || findTab(tabId)?.title === name) return;
  updateTab(tabId, (t) => ({ ...t, title: name }));
  scheduleSave(w.profileId);
}

// Pin or unpin a tab. Pinned tabs come first and cannot be closed: a tab
// pinned goes last among them, one unpinned first among the others (the
// same place, between the two groups).
export function togglePin(tabId: string): void {
  const w = workspaceOfTab(tabId);
  const tab = w?.tabs.find((t) => t.id === tabId);
  if (!w || !tab || w.loadError) return;
  updateWorkspace(w.profileId, (w) => {
    const others = w.tabs.filter((t) => t.id !== tabId);
    return {
      ...w,
      tabs: [...others.filter((t) => t.pinned), { ...tab, pinned: !tab.pinned }, ...others.filter((t) => !t.pinned)],
    };
  });
  if (tab.pinned && store.getState().notice === "Unpin the tab to close it.") store.setState({ notice: null });
  scheduleSave(w.profileId);
}

// Close an editor tab. A pinned one stays (the status bar says so). Its
// title and text are taken first, then it leaves the store, so its runner
// stops; a workspace's last tab is replaced by a fresh one. Then, on the
// profile's queue after any pending save, the backend keeps it in the
// recently closed list with that text (a blank one is deleted instead).
// A run in flight there is cancelled: the user is done with it. Only once
// the close has worked does the backend session close: if it fails, the
// tab comes back where it was, with its text, results and session.
export async function closeTab(tabId: string): Promise<void> {
  const w = workspaceOfTab(tabId);
  const tab = w?.tabs.find((t) => t.id === tabId);
  if (!w || !tab || w.loadError) return;
  if (tab.pinned) {
    store.setState({ notice: "Unpin the tab to close it." });
    return;
  }
  const { profileId } = w;
  const i = w.tabs.findIndex((t) => t.id === tabId);
  const { text, selection } = currentInput(tabId);
  const title = tab.title;
  const wasActive = w.activeTab === tabId;
  let replacement: string | null = null;
  if (tab.runningQueryId) void api.cancel(tab.runningQueryId).catch(() => {});
  epochs.set(tabId, epochOf(tabId) + 1);
  updateWorkspace(profileId, (w) => {
    let rest = w.tabs.filter((t) => t.id !== tabId);
    let nextTabNumber = w.nextTabNumber;
    if (rest.length === 0) {
      rest = [newTabState(nextTabNumber)];
      replacement = rest[0].id;
      nextTabNumber += 1;
    }
    const activeTab = w.activeTab === tabId ? rest[Math.min(i, rest.length - 1)].id : w.activeTab;
    return { ...w, tabs: rest, activeTab, nextTabNumber };
  });
  dropState(tabId);
  // Saves until the close has run still list the tab, with this text: a
  // save that found it gone would close it itself, with older text.
  markClosing(profileId, {
    id: tabId,
    title,
    body: text,
    pinned: false,
    "sel-from": selection.from,
    "sel-to": selection.to,
  });
  flushSave(profileId);
  const closing = enqueue(profileId, () =>
    api.closeTab(profileId, { id: tabId, title, body: text }).finally(() => unmarkClosing(profileId, tabId)),
  );
  scheduleSave(profileId);
  try {
    const entry = await closing;
    if (entry) {
      updateWorkspace(profileId, (w) => ({
        ...w,
        closed: [entry, ...w.closed.filter((c) => c.id !== entry.id)].slice(0, MAX_CLOSED),
      }));
    }
  } catch (e) {
    if (!store.getState().workspaces[profileId]) return;
    seed(tabId, text, selection);
    // As it was, less the run: cancelled above, and ended by the epoch. A
    // result whose page was in flight is closed: that page is dropped, so
    // reading on would skip its rows.
    for (const r of tab.results) if (r.fetching && r.cursor === "open") void api.closeResult(r.id).catch(() => {});
    const back: EditorTab = {
      ...tab,
      runningQueryId: null,
      stopping: false,
      results: tab.results.map((r) =>
        r.fetching ? { ...r, fetching: false, cursor: r.cursor === "open" ? "closed" : r.cursor } : r,
      ),
    };
    // The fresh tab that stood in for it goes, unless typed in since.
    const stale = replacement !== null && currentInput(replacement).text === "" ? replacement : null;
    if (stale) dropState(stale);
    updateWorkspace(profileId, (w) => {
      const tabs = w.tabs.filter((t) => t.id !== stale);
      tabs.splice(Math.min(i, tabs.length), 0, back);
      const activeTab = wasActive || !tabs.some((t) => t.id === w.activeTab) ? tabId : w.activeTab;
      return { ...w, tabs, activeTab };
    });
    store.setState({ notice: `Could not close the tab: ${errorText(e)}` });
    scheduleSave(profileId);
    return;
  }
  const now = store.getState().workspaces[profileId];
  if (now?.status === "connected" && now.connId) await api.closeSession(now.connId, tabId).catch(() => {});
}

// Open a recently closed tab of the selected workspace again: the one
// with closedId, or the most recent. It waits on the profile's queue, so a
// close just before it lands first ("the most recent" is chosen then). It
// comes back last and active, under a new id from the backend.
export async function reopenTab(closedId?: string): Promise<void> {
  const profileId = store.getState().selected;
  const w = profileId === null ? undefined : store.getState().workspaces[profileId];
  if (!w || w.loadError) return;
  let entry: Workspace["closed"][number] | undefined;
  try {
    const t = await enqueue(w.profileId, async () => {
      const closed = store.getState().workspaces[w.profileId]?.closed ?? [];
      entry = closedId === undefined ? closed[0] : closed.find((c) => c.id === closedId);
      if (!entry) return null;
      const id = entry.id;
      updateWorkspace(w.profileId, (w) => ({ ...w, closed: w.closed.filter((c) => c.id !== id) }));
      return api.reopenTab(w.profileId, id);
    });
    if (!t || !store.getState().workspaces[w.profileId]) return;
    seed(t.id, t.body, { from: t["sel-from"], to: t["sel-to"] });
    updateWorkspace(w.profileId, (w) => ({
      ...w,
      tabs: [...w.tabs, { ...newTabState(0), id: t.id, title: t.title }],
      activeTab: t.id,
    }));
    scheduleSave(w.profileId);
  } catch (e) {
    const lost = entry;
    if (lost && store.getState().workspaces[w.profileId]) {
      updateWorkspace(w.profileId, (w) => ({
        ...w,
        closed: [lost, ...w.closed].sort((a, b) => b["closed-at"] - a["closed-at"]).slice(0, MAX_CLOSED),
      }));
    }
    store.setState({ notice: `Could not reopen the tab: ${errorText(e)}` });
  }
}

export function selectResult(tabId: string, id: string): void {
  updateTab(tabId, (t) => ({ ...t, active: id }));
}

export function selectRow(tabId: string, resultId: string, index: number | null): void {
  updateResult(tabId, resultId, (r) => ({ ...r, selectedRow: index }));
}

export function toggleRowDetails(): void {
  store.setState((s) => ({ rowDetails: !s.rowDetails }));
}

export function openRowDetails(): void {
  store.setState({ rowDetails: true });
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

// A workspace from what the backend saved: its tabs seeded with their
// text and selection, or one fresh tab when none was saved.
function fromSaved(profileId: string, saved: SavedWorkspace): Workspace {
  const n = Math.max(1, saved["next-tab-number"] ?? 1);
  if (saved.tabs.length === 0) {
    const first = newTabState(n);
    return { ...newWorkspace(profileId), tabs: [first], activeTab: first.id, nextTabNumber: n + 1, closed: saved.closed };
  }
  const tabs = saved.tabs.map((t) => {
    seed(t.id, t.body, { from: t["sel-from"], to: t["sel-to"] });
    return { ...newTabState(0), id: t.id, title: t.title, pinned: t.pinned };
  });
  const active = tabs.some((t) => t.id === saved["active-tab"]) ? saved["active-tab"]! : tabs[0].id;
  return { ...newWorkspace(profileId), tabs, activeTab: active, nextTabNumber: n, closed: saved.closed };
}

const loading = new Map<string, Promise<Workspace>>();

// The profile's workspace, loaded from the backend on first use (once,
// however many ask meanwhile). A failed load gives a workspace marked with
// loadError, which is never saved.
export function ensureWorkspace(profileId: string): Promise<Workspace> {
  const w = store.getState().workspaces[profileId];
  if (w) return Promise.resolve(w);
  let p = loading.get(profileId);
  if (!p) {
    p = loadWorkspace(profileId).finally(() => loading.delete(profileId));
    loading.set(profileId, p);
  }
  return p;
}

// The profile's saved workspace, or one marked with the load error.
async function readWorkspace(profileId: string): Promise<Workspace> {
  try {
    return fromSaved(profileId, await api.loadWorkspace(profileId));
  } catch (e) {
    return { ...newWorkspace(profileId), loadError: errorText(e) };
  }
}

async function loadWorkspace(profileId: string): Promise<Workspace> {
  const made = await readWorkspace(profileId);
  const existing = store.getState().workspaces[profileId];
  if (existing) {
    dropUnused(made, existing);
    return existing;
  }
  store.setState((s) => ({ workspaces: { ...s.workspaces, [profileId]: made } }));
  return made;
}

// A workspace read but not installed (another got there first): the
// editor state of its tabs goes, except where the installed one has the
// same tab (it was seeded from the same rows).
function dropUnused(unused: Workspace, installed: Workspace): void {
  for (const t of unused.tabs) if (!installed.tabs.some((x) => x.id === t.id)) dropState(t.id);
}

// Load a workspace whose load failed again (once, however often Retry is
// pressed meanwhile). Its connection, which may have been opened
// meanwhile, stays as it is.
export async function retryLoad(profileId: string): Promise<void> {
  if (!store.getState().workspaces[profileId]?.loadError) return;
  let p = loading.get(profileId);
  if (!p) {
    p = (async () => {
      const loaded = await readWorkspace(profileId);
      updateWorkspace(profileId, (w) =>
        w.loadError ? { ...loaded, status: w.status, connId: w.connId, error: w.error } : w,
      );
      const now = store.getState().workspaces[profileId];
      if (now && now.tabs !== loaded.tabs) dropUnused(loaded, now);
      return now ?? loaded;
    })().finally(() => loading.delete(profileId));
    loading.set(profileId, p);
  }
  await p;
}

// Show the profile's workspace, loaded on first select. Never connects.
// remember: save it as the selection for the next launch (a user's click;
// not the start-up fallback, which must not overwrite the saved choice).
export async function selectProfile(id: string, { remember = true } = {}): Promise<void> {
  store.setState({ selected: id, notice: null });
  if (remember) rememberSelection(id);
  await ensureWorkspace(id);
}

// The profile was deleted: no save may follow.
export function forgetWorkspace(profileId: string): void {
  cancelSave(profileId);
}

// Connect the profile's workspace; the selection stays where it is. A
// connect while one is in flight, or on a connected profile, is dropped.
export async function connectProfile(id: string): Promise<void> {
  await ensureWorkspace(id);
  if (store.getState().workspaces[id]?.status !== "disconnected") return;
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
  // Its cached structure goes with the connection; a reconnect gets a new
  // conn-id and reads afresh.
  queryClient.removeQueries({ queryKey: metaKeys.all(connId) });
}

// The structure tree's open nodes for the profile.
export function setTreeExpanded(profileId: string, keys: string[]): void {
  updateWorkspace(profileId, (w) => ({ ...w, treeExpanded: keys }));
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
