import { toast } from "sonner";
import * as api from "@/lib/api";
import { onEvent } from "@/lib/bridge";
import type { UpdateCheck, UpdateInfo, UpdateState } from "@/lib/types";
import { flushAllAndWait } from "./persist";
import { store } from "./store";

// New versions: a check 10 s after the app opens and every 6 hours after,
// and Help → Check for Updates…. A found release shows as a button in the
// status bar, which opens the update dialog: skip it, leave it for later,
// or download, verify and restart into it (quel.updates; Wails' updater
// does the work). Where this copy can't replace itself, the dialog points
// to Homebrew instead.

export const FIRST_CHECK_MS = 10_000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// Wails' progress event while an update downloads.
export const PROGRESS_EVENT = "wails:updater:download-progress";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const set = (update: UpdateState) => store.setState({ update });

// A phase a check must not replace: an update on its way in.
const busy = () => ["downloading", "ready", "restarting"].includes(store.getState().update.phase);

// The bridge may lower a nil release to {} as well as null.
const found = (c: UpdateCheck): c is UpdateInfo => !!c.release?.version;

// Check now. The automatic check is silent, and hides a version the user
// skipped; a manual one opens the dialog for whatever it finds and says
// so when there is nothing.
export async function checkForUpdates({ manual = false } = {}): Promise<void> {
  if (busy()) {
    if (manual) store.setState({ updateDialogOpen: true });
    return;
  }
  let c: UpdateCheck;
  try {
    c = await api.checkUpdate();
  } catch (e) {
    if (manual) toast.error(`Could not check for updates: ${errorText(e)}`, { id: "update-check" });
    else console.warn("update check failed:", e);
    return;
  }
  if (busy()) return;
  if (!c.enabled) {
    if (manual) toast("Update checks are off.", { id: "update-check" });
    return;
  }
  if (!found(c) || (c.skipped && !manual)) {
    if (!found(c)) set({ phase: "idle" });
    if (manual && !found(c)) toast(`Quel ${c.current} is the latest version.`, { id: "update-check" });
    return;
  }
  set({ phase: "available", info: c });
  if (manual) store.setState({ updateDialogOpen: true });
}

// Don't offer this version again (a newer one still shows).
export async function skipVersion(): Promise<void> {
  const u = store.getState().update;
  if (u.phase !== "available" && u.phase !== "error") return;
  set({ phase: "idle" });
  store.setState({ updateDialogOpen: false });
  try {
    await api.skipUpdate(u.info.release.version);
  } catch (e) {
    console.warn("could not save the skipped version:", e);
  }
}

// Download, verify and stage the found release; progress comes as events.
export async function startDownload(): Promise<void> {
  const u = store.getState().update;
  if (u.phase !== "available" && u.phase !== "error") return;
  const info = u.info;
  set({ phase: "downloading", info, written: 0, total: info.release.size || 0 });
  const off = onEvent(PROGRESS_EVENT, (data) => {
    const p = data as { written?: number; total?: number } | null;
    const now = store.getState().update;
    if (now.phase !== "downloading") return;
    set({ ...now, written: p?.written ?? now.written, total: p?.total || now.total });
  });
  try {
    await api.downloadUpdate();
    set({ phase: "ready", info });
  } catch (e) {
    set({ phase: "error", info, message: errorText(e) });
  } finally {
    off();
  }
}

// Save the tabs, then quit into the staged update. A failed save stops it
// unless force: the dialog says so and offers to restart anyway.
export async function restartNow({ force = false } = {}): Promise<void> {
  const u = store.getState().update;
  if (u.phase !== "ready") return;
  const saveError = await flushAllAndWait();
  if (saveError && !force) {
    set({ phase: "ready", info: u.info, saveError });
    return;
  }
  set({ phase: "restarting", info: u.info });
  try {
    await api.restartToUpdate();
  } catch (e) {
    set({ phase: "error", info: u.info, message: errorText(e) });
  }
}

// The checks while the app runs. Returns the fn that stops them.
export function startUpdateChecks(): () => void {
  let every: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    void checkForUpdates();
    every = setInterval(() => void checkForUpdates(), CHECK_EVERY_MS);
  }, FIRST_CHECK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
