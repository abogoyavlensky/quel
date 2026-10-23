import { call } from "@/lib/bridge";
import type {
  ClosedTab,
  FetchResult,
  OpenResult,
  Profile,
  ProfileInput,
  RunResult,
  SavedTab,
  SavedWorkspace,
  WorkspaceInput,
} from "@/lib/types";

// One typed function per backend handler (quel.api). A session-id is an
// editor tab's id; a query-id names one statement's run and, while its
// cursor stays open, its result.

export const openDb = (path: string) => call<OpenResult>("open-db", path);

export const closeDb = (connId: string) => call<void>("close-db", connId);

export const run = (connId: string, sessionId: string, queryId: string, sql: string) =>
  call<RunResult>("run", connId, sessionId, queryId, sql);

export const fetchPage = (queryId: string) => call<FetchResult>("fetch-page", queryId);

export const cancel = (queryId: string) => call<{ canceled: boolean }>("cancel", queryId);

export const closeResult = (queryId: string) => call<void>("close-result", queryId);

export const closeSession = (connId: string, sessionId: string) => call<void>("close-session", connId, sessionId);

// Profiles. A password goes in (save, test) and never comes back.

export const listProfiles = () => call<Profile[]>("list-profiles");

export const saveProfile = (input: ProfileInput) => call<Profile>("save-profile", input);

export const deleteProfile = (id: string) => call<void>("delete-profile", id);

// Connects with the form as it stands and closes again; saves nothing.
export const testConnection = (input: ProfileInput) => call<{ ok: boolean; label: string }>("test-connection", input);

export const connect = (profileId: string) => call<OpenResult>("connect", profileId);

// The SQLite file the user picks in a native dialog, or null.
export const chooseFile = () => call<string | null>("choose-file");

// Each profile's saved editor tabs, and the selected profile. The bridge
// lowers a nil reply to {} or null, so the calls that may answer nil
// check the shape.

export const loadWorkspace = (profileId: string) => call<SavedWorkspace>("load-workspace", profileId);

export const saveWorkspace = (profileId: string, w: WorkspaceInput) => call<void>("save-workspace", profileId, w);

// The closed entry, or null when the tab was blank (deleted, not kept).
export const closeTab = async (profileId: string, tab: { id: string; title: string; body: string }) => {
  const r = await call<ClosedTab | Record<string, never> | null>("close-tab", profileId, tab);
  return r && "id" in r ? (r as ClosedTab) : null;
};

// The closed tab, open again under a new id.
export const reopenTab = (profileId: string, closedId: string) => call<SavedTab>("reopen-tab", profileId, closedId);

export const selectedProfile = async () => {
  const r = await call<unknown>("selected-profile");
  return typeof r === "string" ? r : null;
};

export const selectProfile = (profileId: string | null) => call<void>("select-profile", profileId);
