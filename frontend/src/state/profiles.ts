import * as api from "@/lib/api";
import type { Profile, ProfileInput } from "@/lib/types";
import { dropState } from "@/editor/states";
import { disconnectProfile, selectProfile } from "./runner";
import { type ProfileDialog, store } from "./store";

// Saved connection profiles: loading, saving and deleting them, which one
// is selected, and the dialog that edits them. Connecting one is the
// runner's connectProfile.

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function loadProfiles(): Promise<void> {
  try {
    const profiles = await api.listProfiles();
    store.setState({ profiles, profilesError: null });
  } catch (e) {
    store.setState({ profilesError: errorText(e) });
  }
}

// The selection at start-up, after the first loadProfiles: the first
// profile, when nothing is selected yet.
export function restoreSelection(): void {
  const { selected, profiles } = store.getState();
  if (selected === null && profiles.length > 0) selectProfile(profiles[0].id);
}

// Save, then reload the list; a new profile becomes the selected one. A
// rename or a new colour shows at once: the workspace reads both from the
// list. Throws the backend's message (the dialog shows it).
export async function saveProfile(input: ProfileInput): Promise<Profile> {
  const saved = await api.saveProfile(input);
  await loadProfiles();
  if (!input.id) selectProfile(saved.id);
  return saved;
}

// Delete a profile, disconnecting it first if it is connected, and drop
// its workspace with its tabs. Refused while it connects or disconnects:
// a connect in flight would land after the delete. When it was the
// selected one, the first remaining profile is selected.
export async function deleteProfile(id: string): Promise<void> {
  const status = store.getState().workspaces[id]?.status;
  if (status === "connecting") throw new Error("Wait for the connection to finish opening.");
  if (status === "disconnecting") throw new Error("Wait for the connection to finish closing.");
  if (status === "connected") await disconnectProfile(id);
  await api.deleteProfile(id);
  const dropped = store.getState().workspaces[id];
  if (dropped) {
    // Connected again while the delete ran: nothing will use it now. (A
    // connect still in flight closes its own once it finds no workspace.)
    if (dropped.connId) void api.closeDb(dropped.connId).catch(() => {});
    for (const t of dropped.tabs) dropState(t.id);
    store.setState((s) => {
      const { [id]: _, ...workspaces } = s.workspaces;
      return { workspaces };
    });
  }
  await loadProfiles();
  if (store.getState().selected === id) {
    const first = store.getState().profiles.find((p) => p.id !== id);
    if (first) selectProfile(first.id);
    else store.setState({ selected: null, notice: null });
  }
}

// Connect with the form as it stands and close again; saves nothing.
// Throws the (redacted) error.
export async function testConnection(input: ProfileInput): Promise<void> {
  await api.testConnection(input);
}

export function openProfileDialog(dialog: Exclude<ProfileDialog, null>): void {
  store.setState({ profileDialog: dialog });
}

export function closeProfileDialog(): void {
  store.setState({ profileDialog: null });
}
