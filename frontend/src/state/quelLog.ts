import * as api from "@/lib/api";
import { MAX_MESSAGES, type Message, type QuelQuery, type Workspace, store, updateWorkspace } from "./store";

// The queries Quel itself sends (catalog reads for the structure tree and
// completion, the ping on connect), shown in Messages for transparency.
// The backend records them (quel.meta/execute!) and returns them with each
// catalog reply (lib/api.ts hands them to the sink startQuelLog sets) and with
// connect (runner.ts). Each workspace keeps its own log, in memory, at
// most MAX_MESSAGES; every tab's Messages merges it in by time.
//
// Shown by default: someone who never finds the toggle should still see
// what Quel sends. The choice is saved app-wide, as a row while hidden.

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

// The backend's entries, normalized (the bridge may send {} for an empty
// vector, and leaves out a nil).
export function toQuelQueries(raw: unknown, at = Date.now()): QuelQuery[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((q: Record<string, unknown> | null) => {
    const sql = str(q?.sql);
    if (sql === null) return [];
    const error = str(q?.error);
    return [
      {
        id: crypto.randomUUID(),
        sql,
        params: Array.isArray(q?.params) ? q.params.map((p) => String(p)) : [],
        ms: num(q?.ms),
        rows: error === null ? num(q?.rows) : null,
        error,
        at,
      },
    ];
  });
}

export function appendQuelQueries(profileId: string, raw: unknown): void {
  const qs = toQuelQueries(raw);
  if (qs.length === 0) return;
  updateWorkspace(profileId, (w) => ({ ...w, quelLog: [...w.quelLog, ...qs].slice(-MAX_MESSAGES) }));
}

// A catalog reply's queries, by conn-id: the workspace connected with it.
// None (it disconnected meanwhile): dropped.
export function appendForConn(connId: string, raw: unknown): void {
  const w = Object.values(store.getState().workspaces).find((x) => x.connId === connId);
  if (w) appendQuelQueries(w.profileId, raw);
}

// At start-up (App.tsx): catalog replies' queries come here.
export function startQuelLog(): void {
  api.setQuelQueriesSink(appendForConn);
}

export const quelQueriesShown = (hidden: boolean | null) => hidden !== true;

// The saved choice, at start-up. A toggle made before the answer arrives
// wins; a failed read leaves them shown.
export async function loadQuelQueriesHidden(): Promise<void> {
  let hidden: boolean;
  try {
    hidden = await api.quelQueriesHidden();
  } catch {
    return;
  }
  if (store.getState().quelQueriesHidden === null) store.setState({ quelQueriesHidden: hidden });
}

// Saves go one after another, so two quick toggles land in order; a failed
// save is dropped (the next start shows the old choice).
let saving: Promise<void> = Promise.resolve();

export function toggleQuelQueries(): void {
  const hidden = quelQueriesShown(store.getState().quelQueriesHidden);
  store.setState({ quelQueriesHidden: hidden });
  saving = saving.then(() => api.setQuelQueriesHidden(hidden)).catch(() => {});
}

export type MessageEntry = { kind: "tab"; m: Message } | { kind: "quel"; q: QuelQuery };

// A tab's messages with the workspace's Quel queries, by time; both lists
// are oldest first, and on a tie the tab's message comes first. Without
// shown, the tab's alone.
export function messagesWithQuel(messages: Message[], w: Workspace | undefined, shown: boolean): MessageEntry[] {
  const log = shown && w ? w.quelLog : [];
  const out: MessageEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < messages.length || j < log.length) {
    if (j >= log.length || (i < messages.length && messages[i].at <= log[j].at)) out.push({ kind: "tab", m: messages[i++] });
    else out.push({ kind: "quel", q: log[j++] });
  }
  return out;
}
