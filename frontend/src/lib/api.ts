import { call } from "@/lib/bridge";
import type { FetchResult, OpenResult, Profile, ProfileInput, RunResult } from "@/lib/types";

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

export const closeSession = (connId: string, sessionId: string) =>
  call<void>("close-session", connId, sessionId);

// Profiles. A password goes in (save, test) and never comes back.

export const listProfiles = () => call<Profile[]>("list-profiles");

export const saveProfile = (input: ProfileInput) => call<Profile>("save-profile", input);

export const deleteProfile = (id: string) => call<void>("delete-profile", id);

// Connects with the form as it stands and closes again; saves nothing.
export const testConnection = (input: ProfileInput) =>
  call<{ ok: boolean; label: string }>("test-connection", input);

export const connect = (profileId: string) => call<OpenResult>("connect", profileId);

// The SQLite file the user picks in a native dialog, or null.
export const chooseFile = () => call<string | null>("choose-file");
