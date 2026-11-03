import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { CsvSeparator, ExportFormat } from "@/grid/export";
import type { Cell, ClosedTab, Column, Profile, UpdateState } from "@/lib/types";
import type { ConfirmReason } from "@/sql/guard";

// The app's state: the saved profiles and a workspace per profile (its
// connection, its editor tabs, and each tab's results and messages).
// Plain data in a zustand store: the runner (state/runner.ts) changes it
// from async code and menu events through store.getState()/setState(), and
// components read it with useApp and a selector, so the grid re-renders
// only when its own result changes.
//
// Editor documents are not here: editor/states.ts keeps a CodeMirror
// EditorState per tab. Each workspace's tabs are saved to the app database
// as they change (state/persist.ts) and loaded the first time the profile
// is selected (ensureWorkspace in state/runner.ts).

// open: more rows on the server; done: all read; closed: the server
// closed it (a newer run in its tab, idle, an error, a disconnect);
// capped: MAX_ROWS loaded, closed by us.
export type CursorState = "open" | "done" | "closed" | "capped";

interface ResultBase {
  id: string; // the query-id, which is also the backend's result id
  sql: string;
  pinned: boolean;
}

// A statement's rows.
export interface RowsResult extends ResultBase {
  kind: "rows";
  columns: Column[];
  rows: Cell[][];
  cursor: CursorState;
  fetching: boolean;
  elapsedMs: number;
  // The row the details panel shows, by index; in memory only. A new run
  // makes new results, so it starts over.
  selectedRow: number | null;
}

// One statement of a run: running until its reply comes, then what it
// returned. All kinds are tabs alike (pin, close, replaced by the next run).
export type ResultTab =
  | RowsResult
  | (ResultBase & { kind: "running" })
  | (ResultBase & { kind: "update"; text: string; elapsedMs: number })
  | (ResultBase & { kind: "error" | "canceled"; text: string });

export interface Message {
  id: string;
  sql: string; // the statement, as sent
  kind: "rows" | "update" | "error" | "canceled";
  text: string; // "500 rows", "3 rows affected", the error message
  elapsedMs: number | null;
  at: number; // Date.now()
}

export interface EditorTab {
  id: string; // = the backend session-id
  title: string; // "Query 1", "Query 2", ..., or the user's name for it
  pinned: boolean; // first in the bar, and cannot be closed
  runningQueryId: string | null; // the statement or page in flight
  stopping: boolean; // cancel asked: the script stops after this one
  runStartedAt: number | null; // when the running statement or script began (Date.now())
  results: ResultTab[];
  active: string; // "messages" or a result id
  messages: Message[]; // newest last, capped at MAX_MESSAGES
}

// A statement or script is running, not just a page loading.
export const isRunning = (t: EditorTab) => t.runningQueryId !== null && !t.results.some((r) => r.kind === "rows" && r.fetching);

// A workspace's connection: connecting and disconnecting are in flight
// while the backend opens or closes the database.
export type ConnStatus = "disconnected" | "connecting" | "connected" | "disconnecting";

// One profile's editor tabs and its connection. Loaded from the app
// database the first time the profile is selected; it lives as long as the
// app runs, connected or not. When the load fails, loadError says why and
// the workspace is never saved: a failed read must not overwrite the saved
// tabs.
export interface Workspace {
  profileId: string;
  status: ConnStatus;
  connId: string | null; // set while connected (and while disconnecting)
  error: string | null; // the last connect error, shown under the profile
  tabs: EditorTab[]; // never empty
  activeTab: string;
  nextTabNumber: number;
  closed: ClosedTab[]; // recently closed, newest first, at most MAX_CLOSED
  loadError: string | null;
  // The structure tree's open nodes (state/tree.ts keys), in memory only;
  // null until the tree first opens the default schema. Names, not ids, so
  // they hold across a reconnect.
  treeExpanded: string[] | null;
  // A run was refused while disconnected: the results say so until a
  // connect. In memory only.
  runRefused: boolean;
}

// The profile dialog: closed, a new profile, or editing one.
// confirmDelete opens the edit dialog with its delete confirmation up (the
// sidebar's Delete… item).
export type ProfileDialog =
  { mode: "new" } | { mode: "edit"; id: string; confirmDelete?: boolean } | null;

// A run waiting for the user's answer, as runner.ts asks it under the
// profile's run policy (sql/guard.ts): the statements to show and how
// many the run has. In memory only.
export interface RunConfirm {
  profileId: string;
  reason: ConfirmReason;
  statements: string[];
  total: number;
}

export interface AppState {
  profiles: Profile[]; // by name, as the backend lists them
  profilesError: string | null;
  profileDialog: ProfileDialog;
  selected: string | null; // the profile whose workspace shows
  workspaces: Record<string, Workspace>; // by profile id
  rowDetails: boolean; // the row details panel is open; in memory only
  // The user hid the sidebar (saved in the app database); null until it is
  // read at start-up, which shows it. state/layout.ts.
  sidebarHidden: boolean | null;
  export: { format: ExportFormat; separator: CsvSeparator }; // the Export popover's choice; in memory only
  update: UpdateState; // a newer version, if found (state/updates.ts)
  updateDialogOpen: boolean;
  // The open palette: the command list or Go to Connection. At most one
  // (state/palette.ts); in memory only.
  palette: "commands" | "connections" | null;
  runConfirm: RunConfirm | null; // RunConfirmDialog
}

export const MESSAGES = "messages";
export const MAX_MESSAGES = 500;
export const MAX_CLOSED = 20;

export function newTabState(n: number): EditorTab {
  return {
    id: crypto.randomUUID(),
    title: `Query ${n}`,
    pinned: false,
    runningQueryId: null,
    stopping: false,
    runStartedAt: null,
    results: [],
    active: MESSAGES,
    messages: [],
  };
}

export function newWorkspace(profileId: string): Workspace {
  const first = newTabState(1);
  return {
    profileId,
    status: "disconnected",
    connId: null,
    error: null,
    tabs: [first],
    activeTab: first.id,
    nextTabNumber: 2,
    closed: [],
    loadError: null,
    treeExpanded: null,
    runRefused: false,
  };
}

export function initialState(): AppState {
  return {
    profiles: [],
    profilesError: null,
    profileDialog: null,
    selected: null,
    workspaces: {},
    rowDetails: false,
    sidebarHidden: null,
    export: { format: "csv", separator: "," },
    update: { phase: "idle" },
    updateDialogOpen: false,
    palette: null,
    runConfirm: null,
  };
}

export const store = createStore<AppState>()(() => initialState());

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(store, selector);
}

export function selectedWorkspace(s: AppState): Workspace | undefined {
  return s.selected === null ? undefined : s.workspaces[s.selected];
}

export function activeTabOf(w: Workspace): EditorTab {
  return w.tabs.find((t) => t.id === w.activeTab) ?? w.tabs[0];
}

// The selected workspace's current tab shows a result with rows: a grid,
// not its messages or a statement's outcome.
export function showsResult(s: AppState): boolean {
  const w = selectedWorkspace(s);
  if (!w || w.loadError) return false;
  const tab = activeTabOf(w);
  return tab.results.some((r) => r.id === tab.active && r.kind === "rows");
}

export function updateWorkspace(profileId: string, f: (w: Workspace) => Workspace): void {
  store.setState((s) => {
    const w = s.workspaces[profileId];
    return w ? { workspaces: { ...s.workspaces, [profileId]: f(w) } } : {};
  });
}

// Tab ids are unique across workspaces (they are backend session ids), so
// a tab is found by its id alone.
export function workspaceOfTab(tabId: string): Workspace | undefined {
  return Object.values(store.getState().workspaces).find((w) => w.tabs.some((t) => t.id === tabId));
}

export function findTab(tabId: string): EditorTab | undefined {
  return workspaceOfTab(tabId)?.tabs.find((t) => t.id === tabId);
}

export function updateTab(tabId: string, f: (t: EditorTab) => EditorTab): void {
  const w = workspaceOfTab(tabId);
  if (w) updateWorkspace(w.profileId, (w) => ({ ...w, tabs: w.tabs.map((t) => (t.id === tabId ? f(t) : t)) }));
}

export function updateResult(tabId: string, resultId: string, f: (r: ResultTab) => ResultTab): void {
  updateTab(tabId, (t) => ({ ...t, results: t.results.map((r) => (r.id === resultId ? f(r) : r)) }));
}

// The tab's result by id, when it has rows.
export function findRows(tabId: string, resultId: string): RowsResult | undefined {
  const r = findTab(tabId)?.results.find((x) => x.id === resultId);
  return r?.kind === "rows" ? r : undefined;
}

export function updateRows(tabId: string, resultId: string, f: (r: RowsResult) => RowsResult): void {
  updateResult(tabId, resultId, (r) => (r.kind === "rows" ? f(r) : r));
}

// The result with its cursor closed, if it had one open.
export function closedCursor(r: ResultTab): ResultTab {
  return r.kind === "rows" && r.cursor === "open" ? { ...r, cursor: "closed", fetching: false } : r;
}

export function addMessage(tabId: string, m: Omit<Message, "id" | "at">): void {
  updateTab(tabId, (t) => ({
    ...t,
    messages: [...t.messages, { ...m, id: crypto.randomUUID(), at: Date.now() }].slice(-MAX_MESSAGES),
  }));
}

// Every open result in the profile's tabs becomes closed: the backend
// closed its cursors (the profile disconnected).
export function closeCursors(profileId: string): void {
  updateWorkspace(profileId, (w) => ({
    ...w,
    tabs: w.tabs.map((t) => ({
      ...t,
      results: t.results.map(closedCursor),
    })),
  }));
}
