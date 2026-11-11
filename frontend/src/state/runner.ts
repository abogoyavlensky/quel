import { type CsvSeparator, EXTENSIONS, type ExportFormat, collectChunks, formatChunks } from "@/grid/export";
import { isNumericType } from "@/grid/format";
import { nextSort, sortRows } from "@/grid/sort";
import * as api from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { type Lost, lostOf } from "@/lib/lost";
import { notify } from "@/lib/notify";
import { metaKeys, queryClient } from "@/lib/query";
import { moveItem } from "@/lib/reorder";
import { saveChunks } from "@/lib/save";
import type { SavedWorkspace } from "@/lib/types";
import { currentInput, dropState, seed } from "@/editor/states";
import { gate } from "@/sql/guard";
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
import { showResults } from "./layout";
import {
  type EditorTab,
  type ExportProgress,
  type GridFind,
  MAX_CLOSED,
  MESSAGES,
  type ResultTab,
  type RowsResult,
  type RunConfirm,
  type Workspace,
  activeTabOf,
  addMessage,
  closeCursors,
  closedCursor,
  findRows,
  findTab,
  newTabState,
  newWorkspace,
  selectedWorkspace,
  store,
  updateResult,
  updateRows,
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

// What every kind of result has, to make a result of another kind.
const resultBase = ({ id, sql, pinned, title }: ResultTab) => ({ id, sql, pinned, title });

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

// Whether the tab can start a run: its workspace connected and no run in
// flight there. Its profile and connection, or null.
function readyToRun(tabId: string): { profileId: string; connId: string; tab: EditorTab } | null {
  const w = workspaceOfTab(tabId);
  const tab = findTab(tabId);
  if (!w || w.status !== "connected" || !w.connId || !tab || tab.runningQueryId) return null;
  return { profileId: w.profileId, connId: w.connId, tab };
}

// The answer a run waits for (store's runConfirm), while one does.
let pendingAnswer: ((ok: boolean) => void) | null = null;

function askToRun(question: RunConfirm): Promise<boolean> {
  return new Promise((resolve) => {
    pendingAnswer = resolve;
    store.setState({ runConfirm: question });
  });
}

// The run confirmation dialog's answer: run (true) or not.
export function answerRunConfirm(ok: boolean): void {
  const answer = pendingAnswer;
  pendingAnswer = null;
  store.setState({ runConfirm: null });
  answer?.(ok);
}

// Run statements one after another in the tab's session. Each one gets its
// own result tab when it starts, which its reply fills in: rows, a count,
// or the error. The run first drops the tab's unpinned results, and the
// open cursors of the pinned ones are closed by the backend as soon as the
// session runs again. The first error or a cancel stops the script.
//
// The first statement's tab takes focus. A later one's does only from the
// statement before it, so a user reading another tab mid-script stays
// there, until an error or a cancel takes focus.
//
// First the profile's run policy judges the run as a whole (sql/guard.ts):
// a refused run sends nothing, changes no result, and says why in a toast
// and the messages; a run that asks waits for the dialog, and runs only if
// the tab is still ready on the same connection. While a question is open every other run is
// dropped, as a second run in flight is.
export async function runStatements(tabId: string, statements: Statement[]): Promise<void> {
  if (pendingAnswer || statements.length === 0) return;
  const ready = readyToRun(tabId);
  if (!ready) return;
  const { profileId, connId } = ready;
  const profile = store.getState().profiles.find((p) => p.id === profileId);
  const decision = gate(profile?.["run-policy"] ?? "never", statements);
  if (decision.action === "refuse") {
    const text = `Not run: ${profile?.name ?? "this connection"} is read-only, and this statement changes data or structure.`;
    addMessage(tabId, { sql: decision.statement.text, kind: "error", text, elapsedMs: null });
    notify.error(text, { id: "run-refused" });
    showResults();
    return;
  }
  if (decision.action === "confirm") {
    const ok = await askToRun({
      profileId,
      reason: decision.reason,
      statements: decision.statements.map((s) => s.text),
      total: statements.length,
    });
    if (!ok || readyToRun(tabId)?.connId !== connId) return;
  }
  showResults();
  const tab = findTab(tabId);
  if (!tab) return;
  const alive = aliveFn(tabId);
  notify.dismiss(lostToastId(tabId));

  const firstId = newId();
  for (const r of tab.results) {
    if (!r.pinned && r.kind === "rows" && r.cursor === "open") void api.closeResult(r.id).catch(() => {});
  }
  updateTab(tabId, (t) => ({
    ...t,
    runningQueryId: firstId,
    stopping: false,
    runStartedAt: Date.now(),
    results: t.results.filter((r) => r.pinned).map(closedCursor),
  }));

  let previous: string | null = null;
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
        results: [...t.results.map(closedCursor), { kind: "running", id: queryId, sql: stmt.text, pinned: false }],
        active: previous === null || t.active === previous ? queryId : t.active,
      }));
      const hasTab = () => findTab(tabId)?.results.some((r) => r.id === queryId) ?? false;
      try {
        const r = await api.run(connId, tabId, queryId, stmt.text);
        if (!alive()) return;
        // The profile disconnected while this ran: its cursor is gone.
        const live = stillOn(profileId, connId);
        if (r.columns.length > 0) {
          updateResult(tabId, queryId, (p) => ({
            ...resultBase(p),
            kind: "rows",
            columns: r.columns,
            rows: r.rows,
            cursor: !r["has-more"] ? "done" : live ? "open" : "closed",
            fetching: false,
            elapsedMs: r["elapsed-ms"],
            selectedRow: null,
            sort: null,
            unsorted: null,
            find: null,
          }));
          // Its tab closed while it ran, and the cancel came too late.
          if (r["has-more"] && live && !hasTab()) void api.closeResult(queryId).catch(() => {});
          addMessage(tabId, {
            sql: stmt.text,
            kind: "rows",
            text: plural(r.rows.length, "row", "rows") + (r["has-more"] ? ", more available" : ""),
            elapsedMs: r["elapsed-ms"],
          });
        } else {
          const n = r["update-count"];
          const text = n === null ? "Done" : plural(n, "row affected", "rows affected");
          updateResult(tabId, queryId, (p) => ({ ...resultBase(p), kind: "update", text, elapsedMs: r["elapsed-ms"] }));
          addMessage(tabId, { sql: stmt.text, kind: "update", text, elapsedMs: r["elapsed-ms"] });
        }
      } catch (e) {
        if (!alive()) return;
        const text = errorText(e);
        const lost = lostOf(e);
        if (lost?.reconnected && !lost.canceled) {
          const messageId = addLost(tabId, stmt.text, text, lost, lost.notRun ? statements.slice(i) : undefined);
          updateResult(tabId, queryId, (p) => ({ ...resultBase(p), kind: "lost", text, lost, messageId }));
        } else {
          const kind = text.startsWith("Query canceled.") ? "canceled" : "error";
          updateResult(tabId, queryId, (p) => ({ ...resultBase(p), kind, text }));
          addMessage(tabId, { sql: stmt.text, kind, text, elapsedMs: null });
        }
        if (hasTab()) updateTab(tabId, (t) => ({ ...t, active: queryId }));
        break;
      }
      previous = queryId;
    }
  } finally {
    if (alive()) updateTab(tabId, (t) => ({ ...t, runningQueryId: null, stopping: false, runStartedAt: null }));
  }
}

// A tab's lost-connection toast: one per tab, replaced by the next loss and
// dismissed by the next run.
const lostToastId = (tabId: string) => `lost-${tabId}`;

// The connection under a statement or page read was lost, and the backend
// reconnected the tab. A notice in the messages, and a toast; both offer
// Run again when nothing was run (rerun: that statement and the rest of
// its script). Returns the message's id.
function addLost(tabId: string, sql: string, text: string, lost: Lost, rerun?: Statement[]): string {
  const messageId = addMessage(tabId, { sql, kind: "lost", text, elapsedMs: null, lost, rerun });
  const title = findTab(tabId)?.title ?? "Query";
  notify.info(`${title}: connection restored.`, {
    id: lostToastId(tabId),
    action: rerun ? { label: "Run again", onClick: () => void rerunLost(tabId, messageId) } : undefined,
  });
  return messageId;
}

// Whether a lost-connection message can still be run again: it is the
// tab's newest message, it has statements to rerun, and nothing runs.
export function canRerunLost(t: EditorTab, messageId: string): boolean {
  const last = t.messages.at(-1);
  return last?.id === messageId && !!last.rerun?.length && t.runningQueryId === null;
}

// Run again what a lost connection kept from running. A normal run: the
// run policy judges it again. A stale click (a run since, the tab busy)
// does nothing.
export async function rerunLost(tabId: string, messageId: string): Promise<void> {
  const t = findTab(tabId);
  if (!t || !canRerunLost(t, messageId)) return;
  const m = t.messages.at(-1);
  if (m?.rerun) await runStatements(tabId, m.rerun);
}

// Run from the selected workspace's active editor: the statement under the
// cursor (or the selection's statements), or the whole script. A
// disconnected workspace sends nothing: a notice says so right away, with a
// Connect button, and the run is marked refused (the results keep saying so
// until a connect); one that is connecting drops the run, as a second run
// in flight is dropped.
export async function runCurrent(mode: RunMode): Promise<void> {
  const w = selectedWorkspace(store.getState());
  if (!w || w.status === "connecting") return;
  if (w.status !== "connected") {
    updateWorkspace(w.profileId, (w) => ({ ...w, runRefused: true }));
    showResults();
    const name = store.getState().profiles.find((p) => p.id === w.profileId)?.name ?? "The profile";
    // One id: a second press replaces the notice rather than stacking.
    notify.error(`${name} isn't connected.`, {
      id: "not-connected",
      action: { label: "Connect", onClick: () => void connectProfile(w.profileId) },
    });
    return;
  }
  const tabId = w.activeTab;
  const { text, selection } = currentInput(tabId);
  await runStatements(tabId, toRun(text, selection, mode));
}

// Load the next page of an open result, up to maxRows in all.
export async function fetchMore(tabId: string, resultId: string, maxRows = MAX_ROWS): Promise<void> {
  const tab = findTab(tabId);
  const result = findRows(tabId, resultId);
  if (!tab || !result || result.cursor !== "open" || result.fetching || tab.runningQueryId) return;
  if (result.rows.length >= maxRows) {
    void api.closeResult(resultId).catch(() => {});
    updateRows(tabId, resultId, (r) => ({ ...r, cursor: "capped" }));
    return;
  }

  const w = workspaceOfTab(tabId);
  if (w?.status !== "connected" || !w.connId) return;
  const { profileId, connId } = w;
  const alive = aliveFn(tabId);
  updateRows(tabId, resultId, (r) => ({ ...r, fetching: true }));
  updateTab(tabId, (t) => ({ ...t, runningQueryId: resultId }));
  try {
    const p = await api.fetchPage(resultId);
    if (!alive()) return;
    const live = stillOn(profileId, connId);
    updateRows(tabId, resultId, (r) => {
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
    updateRows(tabId, resultId, (r) => (r.cursor === "open" ? { ...r, cursor: "closed" } : r));
    const lost = lostOf(e);
    if (lost?.reconnected && !lost.canceled) {
      addLost(tabId, result.sql, text, lost);
    } else {
      addMessage(tabId, {
        sql: result.sql,
        kind: text.startsWith("Query canceled.") ? "canceled" : "error",
        text,
        elapsedMs: null,
      });
    }
  } finally {
    if (alive()) {
      updateRows(tabId, resultId, (r) => ({ ...r, fetching: false }));
      updateTab(tabId, (t) => ({ ...t, runningQueryId: null }));
    }
  }
}

// Load every page of an open result, up to maxRows in all. True once the
// cursor is done or capped; false when the rows cannot all be had: the
// result or tab is gone, another statement is running in the tab, the
// cursor closed (canceled, an error, a disconnect), or the signal fired, which
// stops between pages and leaves the cursor open.
export async function loadAll(
  tabId: string,
  resultId: string,
  maxRows = MAX_ROWS,
  signal?: AbortSignal,
): Promise<boolean> {
  const find = () => findRows(tabId, resultId);
  for (;;) {
    const result = find();
    if (signal?.aborted || !result || result.cursor === "closed") return false;
    if (result.cursor !== "open") return true;
    if (result.fetching) {
      // A page of this result is already coming (the grid asked for it).
      await untilNotFetching(find);
      continue;
    }
    if (findTab(tabId)?.runningQueryId) return false;
    await fetchMore(tabId, resultId, maxRows);
    const after = find();
    // fetchMore returns at once when it cannot go on (a disconnected
    // workspace): no change means no progress.
    if (after?.cursor === "open" && !after.fetching && after.rows.length === result.rows.length) return false;
  }
}

// Resolves once the result is gone or no longer fetching.
function untilNotFetching(find: () => RowsResult | undefined): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe(() => {
      if (find()?.fetching) return;
      unsubscribe();
      resolve();
    });
  });
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
  if (tab.pinned) notify.dismiss("unpin-to-close");
  scheduleSave(w.profileId);
}

// Close an editor tab. A pinned one stays (a toast says so). Its
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
    notify.info("Unpin the tab to close it.", { id: "unpin-to-close" });
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
    // As it was, less the run: cancelled above, and ended by the epoch, so
    // its statement shows as canceled. A result whose page was in flight is
    // closed: that page is dropped, so reading on would skip its rows. Less
    // the export too: while the tab was gone it could not clear its own mark.
    for (const r of tab.results) {
      if (r.kind === "rows" && r.fetching && r.cursor === "open") void api.closeResult(r.id).catch(() => {});
    }
    const back: EditorTab = {
      ...tab,
      runningQueryId: null,
      stopping: false,
      runStartedAt: null,
      exporting: null,
      results: tab.results.map((r): ResultTab => {
        if (r.kind === "running") return { ...resultBase(r), kind: "canceled", text: "Query canceled." };
        return r.kind === "rows" && r.fetching
          ? { ...r, fetching: false, cursor: r.cursor === "open" ? "closed" : r.cursor }
          : r;
      }),
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
    notify.error(`Could not close the tab: ${errorText(e)}`);
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
    notify.error(`Could not reopen the tab: ${errorText(e)}`);
  }
}

export function selectResult(tabId: string, id: string): void {
  updateTab(tabId, (t) => ({ ...t, active: id }));
}

export function selectRow(tabId: string, resultId: string, index: number | null): void {
  updateRows(tabId, resultId, (r) => ({ ...r, selectedRow: index }));
}

// The find bar over a result's grid. Its state lives on the result, so it
// survives tab switches and hidden results; closing keeps the query.
const NEW_FIND: GridFind = { open: true, search: "", caseSensitive: false, wholeWord: false, regexp: false, current: null };

export function openFind(tabId: string, resultId: string): void {
  updateRows(tabId, resultId, (r) => ({ ...r, find: r.find ? { ...r.find, open: true } : NEW_FIND }));
}

// A change to the query or a toggle forgets the current match.
export function setFind(tabId: string, resultId: string, patch: Partial<Omit<GridFind, "open">>): void {
  updateRows(tabId, resultId, (r) => {
    if (!r.find) return r;
    const query = Object.keys(patch).some((k) => k !== "current");
    return { ...r, find: { ...r.find, ...(query ? { current: null } : {}), ...patch } };
  });
}

export function closeFind(tabId: string, resultId: string): void {
  updateRows(tabId, resultId, (r) => (r.find ? { ...r, find: { ...r.find, open: false } } : r));
}

export function toggleRowDetails(): void {
  store.setState((s) => ({ rowDetails: !s.rowDetails }));
}

export function openRowDetails(): void {
  store.setState({ rowDetails: true });
}

export function setExport(choice: Partial<{ format: ExportFormat; separator: CsvSeparator }>): void {
  store.setState((s) => ({ export: { ...s.export, ...choice } }));
}

const pad = (n: number) => String(n).padStart(2, "0");

// The suggested file name: result-YYYY-MM-DD-HHMM.<ext>, in local time.
export function exportFilename(format: ExportFormat, now = new Date()): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `result-${date}-${pad(now.getHours())}${pad(now.getMinutes())}.${EXTENSIONS[format]}`;
}

const FORMAT_NAMES: Record<ExportFormat, string> = { csv: "CSV", json: "JSON", markdown: "Markdown" };

// What cancels the tab's export. In a map, not the store: it is no state to draw.
const exportCancels = new Map<string, AbortController>();

// Cancel the tab's export. It stops at the next page or chunk, and nothing
// goes out: a file being saved is dropped, leaving the target as it was.
export function cancelExport(tabId: string): void {
  exportCancels.get(tabId)?.abort();
}

// Copy or save a result in the format the store holds. An open result is
// loaded to the end first; if that cannot be done nothing goes out. A tab
// exports one result at a time, from the click on: a second click, on any of
// its results, does nothing.
export async function exportResult(
  tabId: string,
  resultId: string,
  action: "copy" | "save",
  maxRows = MAX_ROWS,
): Promise<void> {
  if (findTab(tabId)?.exporting) return;
  await withLoadLock(tabId, action, (signal, setExporting) => {
    const progress = (rows: number, total: number) => setExporting({ action, rows, total });
    return exportRows(tabId, resultId, action, maxRows, progress, signal);
  });
}

// Run f as the tab's one export or sort: tab.exporting is set meanwhile
// (Copy, Save and the headers do nothing, the footer has Cancel), and
// cancelExport fires the signal f gets.
async function withLoadLock(
  tabId: string,
  action: ExportProgress["action"],
  f: (signal: AbortSignal, setExporting: (p: ExportProgress | null) => void) => Promise<void>,
): Promise<void> {
  const setExporting = (exporting: ExportProgress | null) => updateTab(tabId, (t) => ({ ...t, exporting }));
  setExporting({ action, rows: null, total: 0 });
  const controller = new AbortController();
  exportCancels.set(tabId, controller);
  try {
    await f(controller.signal, setExporting);
  } finally {
    // A tab back from a failed close may have started another by now.
    if (exportCancels.get(tabId) === controller) exportCancels.delete(tabId);
    setExporting(null);
  }
}

// A click on a result's column header: ascending, descending, then the
// order the rows came in (grid/sort.ts). An open result loads the rest
// first, as an export does, under the same lock; if it cannot all be had,
// nothing is sorted. The statement never runs again.
export async function sortResult(tabId: string, resultId: string, column: number, maxRows = MAX_ROWS): Promise<void> {
  const result = findRows(tabId, resultId);
  if (!result || findTab(tabId)?.exporting) return;
  const next = nextSort(result.sort, column);
  if (result.cursor === "open") {
    let ok = false;
    let aborted = false;
    await withLoadLock(tabId, "sort", async (signal) => {
      ok = await loadAll(tabId, resultId, maxRows, signal);
      aborted = signal.aborted;
    });
    if (!ok) {
      if (aborted) notify.info("Sort canceled.");
      else notify.error("Sort stopped: not all rows could be loaded.");
      return;
    }
  }
  updateRows(tabId, resultId, (r) => {
    const base = r.unsorted ?? r.rows;
    const rows = next ? sortRows(base, next, isNumericType(r.columns[next.column]?.type ?? "")) : base;
    const selected = r.selectedRow === null ? null : rows.indexOf(r.rows[r.selectedRow]);
    return {
      ...r,
      rows,
      sort: next,
      unsorted: next ? base : null,
      selectedRow: selected === null || selected < 0 ? null : selected,
      find: r.find && { ...r.find, current: null },
    };
  });
}

async function exportRows(
  tabId: string,
  resultId: string,
  action: "copy" | "save",
  maxRows: number,
  progress: (rows: number, total: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const find = () => findRows(tabId, resultId);
  const stopped = () => notify.error("Export stopped: not all rows could be loaded.");
  const canceled = () => notify.info("Export canceled.");
  if (find()?.cursor === "open" && !(await loadAll(tabId, resultId, maxRows, signal))) {
    return void (signal.aborted ? canceled() : stopped());
  }
  const result = find();
  if (!result) return void stopped();

  const { format, separator } = store.getState().export;
  const chunks = formatChunks(format, result.columns, result.rows, separator);
  const n = result.rows.length;
  const onRows = (rows: number) => progress(rows, n);
  const rows = n === 1 ? "1 row" : `${n.toLocaleString("en-US")} rows`;
  const which =
    result.cursor === "capped"
      ? `the first ${rows}`
      : result.cursor === "closed"
        ? `the ${n.toLocaleString("en-US")} loaded ${n === 1 ? "row" : "rows"}`
        : rows;
  if (action === "copy") {
    let copied = false;
    try {
      const texts = await collectChunks(chunks, onRows, signal);
      if (signal.aborted) return void canceled();
      copied = await copyText(texts.join(""));
    } catch {
      // Past the engine's longest string: join throws.
    }
    if (copied) notify.success(`Copied ${which} as ${FORMAT_NAMES[format]}`);
    else notify.error("Couldn't copy to the clipboard.");
    return;
  }
  try {
    const saved = await saveChunks(exportFilename(format), format, chunks, onRows, signal);
    if (saved === null) return void (signal.aborted && canceled());
    notify.success(
      saved === "download" ? `Saved ${which} as ${FORMAT_NAMES[format]}` : `Saved ${which} to ${saved}`,
    );
  } catch (e) {
    notify.error(`Couldn't save the export: ${errorText(e)}`);
  }
}

export function pin(tabId: string, resultId: string): void {
  updateResult(tabId, resultId, (r) => ({ ...r, pinned: !r.pinned }));
}

// Move a result tab to toIndex (clamped) in the strip, leaving the shown
// one as it is. Results live in memory only, so nothing is saved. Any
// result can move; the strip only lets kept ones be dragged, and a run
// keeps those in their order. Nothing changes when it is already there or
// gone.
export function moveResult(tabId: string, resultId: string, toIndex: number): void {
  const results = findTab(tabId)?.results;
  const from = results?.findIndex((r) => r.id === resultId) ?? -1;
  if (!results || from < 0) return;
  if (Math.max(0, Math.min(results.length - 1, toIndex)) === from) return;
  updateTab(tabId, (t) => ({ ...t, results: moveItem(t.results, from, toIndex) }));
}

// Name a result tab; a blank name gives it back its statement. Results
// live in memory only, so nothing is saved. A result gone meanwhile (the
// name input can blur after a run replaced it) is left alone.
export function renameResult(tabId: string, resultId: string, name: string): void {
  const r = findTab(tabId)?.results.find((x) => x.id === resultId);
  const title = name.trim();
  if (!r || (r.title ?? "") === title) return;
  updateResult(tabId, resultId, (r) => {
    if (title) return { ...r, title };
    const { title: _, ...rest } = r;
    return rest as ResultTab;
  });
}

export function closeResult(tabId: string, resultId: string): void {
  const r = findTab(tabId)?.results.find((x) => x.id === resultId);
  if (!r) return;
  if (r.kind === "rows" && r.cursor === "open") void api.closeResult(resultId).catch(() => {});
  if (r.kind === "running") cancel(tabId);
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
  store.setState({ selected: id });
  if (remember) rememberSelection(id);
  await ensureWorkspace(id);
}

// The profile was deleted: no save may follow.
export function forgetWorkspace(profileId: string): void {
  cancelSave(profileId);
}

// The connect in flight for each profile, by attempt id: what
// cancelConnect stops. A connect whose id is no longer here was given up.
const connectAttempts = new Map<string, string>();

// Connect the profile's workspace; the selection stays where it is. A
// connect while one is in flight, or on a connected profile, is dropped.
// Its reply counts only while it is the profile's current attempt: one
// cancelled (or whose workspace was dropped) closes a connection that
// lands late and shows no error.
export async function connectProfile(id: string): Promise<void> {
  await ensureWorkspace(id);
  if (store.getState().workspaces[id]?.status !== "disconnected") return;
  const attemptId = newId();
  connectAttempts.set(id, attemptId);
  const current = () => connectAttempts.get(id) === attemptId && !!store.getState().workspaces[id];
  updateWorkspace(id, (w) => ({ ...w, status: "connecting", error: null }));
  try {
    const opened = await api.connect(id, attemptId);
    if (!current()) {
      // Given up meanwhile: nothing will use this connection.
      void api.closeDb(opened["conn-id"]).catch(() => {});
      return;
    }
    updateWorkspace(id, (w) => ({ ...w, status: "connected", connId: opened["conn-id"], runRefused: false }));
    notify.dismiss("not-connected");
  } catch (e) {
    if (!current()) return;
    updateWorkspace(id, (w) => ({ ...w, status: "disconnected", connId: null, error: errorText(e) }));
  } finally {
    if (connectAttempts.get(id) === attemptId) connectAttempts.delete(id);
  }
}

// Give up the profile's connect in flight. The row is not connected at
// once, whatever the backend is doing: the cancel stops its dial, and a
// connection that lands anyway is closed (connectProfile).
export function cancelConnect(id: string): void {
  if (store.getState().workspaces[id]?.status !== "connecting") return;
  const attemptId = connectAttempts.get(id);
  connectAttempts.delete(id);
  updateWorkspace(id, (w) => ({ ...w, status: "disconnected", connId: null, error: null }));
  if (attemptId) void api.cancelConnect(attemptId).catch(() => {});
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


// The selected workspace's active tab, for the menu actions.
export function selectedTabId(): string | null {
  const w = selectedWorkspace(store.getState());
  return w ? activeTabOf(w).id : null;
}
