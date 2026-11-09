import * as api from "@/lib/api";
import type { Profile, ProfileInput } from "@/lib/types";
import { dropState } from "@/editor/states";
import { cancelConnect, disconnectProfile, forgetWorkspace, selectProfile } from "./runner";
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

// The selection at start-up, after the first loadProfiles: the profile
// selected when the app last ran, if it still exists, else the first. The
// fallback is not saved: only a user's choice is, so a failed or early
// read never overwrites it. A selection the user made meanwhile stays.
export async function restoreSelection(): Promise<void> {
  if (store.getState().selected !== null || store.getState().profiles.length === 0) return;
  let saved: string | null = null;
  try {
    saved = await api.selectedProfile();
  } catch {
    // The first profile, then.
  }
  const { selected, profiles } = store.getState();
  if (selected !== null || profiles.length === 0) return;
  const id = profiles.some((p) => p.id === saved) ? saved! : profiles[0].id;
  await selectProfile(id, { remember: false });
}

// Save, then reload the list; a new profile becomes the selected one. A
// rename or a new colour shows at once: the workspace reads both from the
// list. Throws the backend's message (the dialog shows it).
export async function saveProfile(input: ProfileInput): Promise<Profile> {
  const saved = await api.saveProfile(input);
  await loadProfiles();
  if (!input.id) void selectProfile(saved.id);
  return saved;
}

// Delete a profile, disconnecting it first if it is connected, and drop
// its workspace with its tabs. A connect in flight is cancelled first (one
// that lands anyway closes its connection). Refused while it disconnects.
// When it was the selected one, the first remaining profile is selected.
// Its saved tabs go with it (the backend deletes them with the profile).
export async function deleteProfile(id: string): Promise<void> {
  const status = store.getState().workspaces[id]?.status;
  if (status === "connecting") cancelConnect(id);
  if (status === "disconnecting") throw new Error("Wait for the connection to finish closing.");
  if (status === "connected") await disconnectProfile(id);
  await api.deleteProfile(id);
  forgetWorkspace(id);
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
    if (first) await selectProfile(first.id, { remember: false });
    else store.setState({ selected: null });
  }
}

// Connect with the form as it stands and close again; saves nothing.
// Throws the (redacted) error. cancelTest(attemptId) stops it.
export async function testConnection(input: ProfileInput, attemptId: string): Promise<void> {
  await api.testConnection(input, attemptId);
}

export function cancelTest(attemptId: string): void {
  void api.cancelConnect(attemptId).catch(() => {});
}

export function openProfileDialog(dialog: Exclude<ProfileDialog, null>): void {
  store.setState({ profileDialog: dialog });
}

export function closeProfileDialog(): void {
  store.setState({ profileDialog: null });
}
