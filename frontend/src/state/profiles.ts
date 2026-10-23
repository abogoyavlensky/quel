import * as api from "@/lib/api";
import type { Profile, ProfileInput } from "@/lib/types";
import { closeDb } from "./runner";
import { type ProfileDialog, store } from "./store";

// Saved connection profiles: loading, saving and deleting them, and the
// dialog that edits them. Connecting one is the runner's connectProfile.

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

// Save, then reload the list. A rename or a new colour shows on the open
// connection at once if it is this profile's. Throws the backend's
// message (the dialog shows it).
export async function saveProfile(input: ProfileInput): Promise<Profile> {
  const saved = await api.saveProfile(input);
  const conn = store.getState().conn;
  if (conn?.profileId === saved.id) {
    store.setState({ conn: { ...conn, label: saved.name, color: saved.color } });
  }
  await loadProfiles();
  return saved;
}

// Delete a profile, disconnecting first if it is the open one. Refused
// while a database is opening: the one opening may be this profile, and
// it would land connected after the delete.
export async function deleteProfile(id: string): Promise<void> {
  if (store.getState().switching) throw new Error("Wait for the connection to finish opening.");
  if (store.getState().conn?.profileId === id) await closeDb();
  await api.deleteProfile(id);
  await loadProfiles();
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
