import * as api from "@/lib/api";
import type { WorkspaceInput } from "@/lib/types";
import { currentInput } from "@/editor/states";
import { type Workspace, store, workspaceOfTab } from "./store";

// Saving each profile's editor tabs to the app database. Every profile has
// one queue, and its operations (save, close, reopen) run in order, one at
// a time: a close and a reopen right after it reach the backend in that
// order, and two saves never race. A change schedules a save 800 ms later;
// more changes meanwhile push it back. The save is built when it runs, not
// when it is scheduled, so a queued save always sends the latest tabs.
//
// A workspace whose load failed is never saved (see Workspace.loadError).

export const SAVE_DELAY_MS = 800;

const queues = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const SAVE_FAILED = "Could not save tabs: ";

// Run op after the profile's queued operations. Its result (or failure)
// is the caller's; a failure does not stop the queue.
export function enqueue<T>(profileId: string, op: () => Promise<T>): Promise<T> {
  const prev = queues.get(profileId) ?? Promise.resolve();
  const run = prev.then(op);
  const tail = run.then(
    () => {},
    () => {},
  );
  queues.set(profileId, tail);
  void tail.then(() => {
    if (queues.get(profileId) === tail) queues.delete(profileId);
  });
  return run;
}

// What save-workspace sends for w: each tab with its text and selection
// as the editor has them now.
export function snapshot(w: Workspace): WorkspaceInput {
  return {
    tabs: w.tabs.map((t) => {
      const { text, selection } = currentInput(t.id);
      return {
        id: t.id,
        title: t.title,
        body: text,
        pinned: t.pinned,
        "sel-from": selection.from,
        "sel-to": selection.to,
      };
    }),
    "active-tab": w.activeTab,
    "next-tab-number": w.nextTabNumber,
  };
}

function enqueueSave(profileId: string): Promise<void> {
  return enqueue(profileId, async () => {
    const w = store.getState().workspaces[profileId];
    if (!w || w.loadError) return;
    try {
      await api.saveWorkspace(profileId, snapshot(w));
      if (store.getState().notice?.startsWith(SAVE_FAILED)) store.setState({ notice: null });
    } catch (e) {
      // Shown in the status bar; the next change tries again.
      store.setState({ notice: SAVE_FAILED + errorText(e) });
    }
  });
}

// Save the profile's tabs SAVE_DELAY_MS after the last change.
export function scheduleSave(profileId: string): void {
  const w = store.getState().workspaces[profileId];
  if (!w || w.loadError) return;
  clearTimeout(timers.get(profileId));
  timers.set(
    profileId,
    setTimeout(() => {
      timers.delete(profileId);
      void enqueueSave(profileId);
    }, SAVE_DELAY_MS),
  );
}

// Queue the profile's pending save now, if one is scheduled.
export function flushSave(profileId: string): void {
  const timer = timers.get(profileId);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(profileId);
  void enqueueSave(profileId);
}

// Every pending save, now: the window is hiding or the page going away.
export function flushAll(): void {
  for (const profileId of [...timers.keys()]) flushSave(profileId);
}

// Forget the profile's pending save (it was deleted).
export function cancelSave(profileId: string): void {
  clearTimeout(timers.get(profileId));
  timers.delete(profileId);
}

// An edit or a selection change in a tab's editor.
export function onEdit(tabId: string): void {
  const w = workspaceOfTab(tabId);
  if (w) scheduleSave(w.profileId);
}
