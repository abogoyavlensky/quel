import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Cell, Color, Column, Engine, Profile } from "@/lib/types";

// The app's state: the open database, the saved profiles, the editor tabs, and each tab's
// results and messages. Plain data in a zustand store: the runner
// (state/runner.ts) changes it from async code and menu events through
// store.getState()/setState(), and components read it with useApp and a
// selector, so the grid re-renders only when its own result changes.
//
// Editor documents are not here: editor/states.ts keeps a CodeMirror
// EditorState per tab.

// open: more rows on the server; done: all read; closed: the server
// closed it (a newer run in its tab, idle, an error, the database closed);
// capped: MAX_ROWS loaded, closed by us.
export type CursorState = "open" | "done" | "closed" | "capped";

export interface ResultTab {
  id: string; // the query-id, which is also the backend's result id
  sql: string;
  columns: Column[];
  rows: Cell[][];
  cursor: CursorState;
  fetching: boolean;
  pinned: boolean;
  elapsedMs: number;
}

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
  title: string; // "Query 1", "Query 2", ...
  runningQueryId: string | null; // the statement or page in flight
  stopping: boolean; // cancel asked: the script stops after this one
  results: ResultTab[];
  active: string; // "messages" or a result id
  messages: Message[]; // newest last, capped at MAX_MESSAGES
}

export interface Conn {
  connId: string;
  engine: Engine;
  label: string; // the profile's name, or the path / URL opened
  profileId: string | null; // null for a quick open
  color: Color; // the profile's colour tag; "none" for a quick open
}

// The profile dialog: closed, a new profile, or editing one.
export type ProfileDialog = { mode: "new" } | { mode: "edit"; id: string } | null;

export interface AppState {
  conn: Conn | null;
  switching: boolean; // opening or closing a database
  dbError: string | null;
  profiles: Profile[]; // by name, as the backend lists them
  profilesError: string | null;
  profileDialog: ProfileDialog;
  tabs: EditorTab[];
  activeTab: string;
  nextTabNumber: number;
}

export const MESSAGES = "messages";
export const MAX_MESSAGES = 500;

export function newTabState(n: number): EditorTab {
  return {
    id: crypto.randomUUID(),
    title: `Query ${n}`,
    runningQueryId: null,
    stopping: false,
    results: [],
    active: MESSAGES,
    messages: [],
  };
}

export function initialState(): AppState {
  const first = newTabState(1);
  return {
    conn: null,
    switching: false,
    dbError: null,
    profiles: [],
    profilesError: null,
    profileDialog: null,
    tabs: [first],
    activeTab: first.id,
    nextTabNumber: 2,
  };
}

export const store = createStore<AppState>()(() => initialState());

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(store, selector);
}

export function findTab(id: string): EditorTab | undefined {
  return store.getState().tabs.find((t) => t.id === id);
}

export function updateTab(id: string, f: (t: EditorTab) => EditorTab): void {
  store.setState((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? f(t) : t)) }));
}

export function updateResult(tabId: string, resultId: string, f: (r: ResultTab) => ResultTab): void {
  updateTab(tabId, (t) => ({ ...t, results: t.results.map((r) => (r.id === resultId ? f(r) : r)) }));
}

export function addMessage(tabId: string, m: Omit<Message, "id" | "at">): void {
  updateTab(tabId, (t) => ({
    ...t,
    messages: [...t.messages, { ...m, id: crypto.randomUUID(), at: Date.now() }].slice(-MAX_MESSAGES),
  }));
}

// Every open result in every tab becomes closed: the backend closed the
// cursors (the database changed).
export function closeAllCursors(): void {
  store.setState((s) => ({
    tabs: s.tabs.map((t) => ({
      ...t,
      results: t.results.map((r) => (r.cursor === "open" ? { ...r, cursor: "closed", fetching: false } : r)),
    })),
  }));
}
