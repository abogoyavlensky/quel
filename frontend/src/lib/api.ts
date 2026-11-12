import type { ExportFormat } from "@/grid/export";
import { call } from "@/lib/bridge";
import type {
  ClosedTab,
  CompletionSchema,
  Engine,
  FetchResult,
  ObjectDetails,
  OpenResult,
  Profile,
  ProfileInput,
  RunResult,
  SavedTab,
  SavedWorkspace,
  SchemaContents,
  SchemaInfo,
  UpdateCheck,
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

// The bridge lowers a nil reply to {} or null, so a call that may answer
// nil (a canceled dialog) has an answer only when it is a string.
const answerOrNull = async (p: Promise<unknown>) => {
  const r = await p;
  return typeof r === "string" && r !== "" ? r : null;
};

// Saving a result. A runtime call is capped at 64 MiB, so a file goes in
// chunks: begin asks where to save and gives an id, or null when the user
// canceled the dialog; finish gives the path it was saved to.
export const exportBegin = (format: ExportFormat, filename: string) =>
  answerOrNull(call("export-begin", format, filename));
export const exportAppend = (id: string, text: string) => call<void>("export-append", id, text);
export const exportFinish = (id: string) => call<string>("export-finish", id);
export const exportAbort = (id: string) => call<void>("export-abort", id);

export const closeSession = (connId: string, sessionId: string) => call<void>("close-session", connId, sessionId);

// The structure of an open database. The bridge lowers an empty list to
// {} or null, at any depth, and may drop a nil value, so the replies are
// normalized here.

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
type Raw = Record<string, unknown> | null | undefined;

export const listSchemas = async (connId: string) => arr<SchemaInfo>(await call("list-schemas", connId));

export const describeSchema = async (connId: string, schema: string): Promise<SchemaContents> => {
  const r = (await call<Raw>("describe-schema", connId, schema)) ?? {};
  return {
    objects: arr(r.objects),
    functions: arr(r.functions),
    types: arr<Record<string, unknown>>(r.types).map((t) => ({
      ...(t as unknown as SchemaContents["types"][number]),
      detail: strOrNull(t.detail),
      values: arr<string>(t.values),
    })),
    sequences: arr(r.sequences),
  };
};

export const describeObject = async (connId: string, schema: string, name: string): Promise<ObjectDetails> => {
  const r = (await call<Raw>("describe-object", connId, schema, name)) ?? {};
  return {
    columns: arr(r.columns),
    indexes: arr(r.indexes),
    keys: arr<Record<string, unknown>>(r.keys).map((k) => ({
      ...(k as unknown as ObjectDetails["keys"][number]),
      name: strOrNull(k.name),
      columns: arr<string>(k.columns),
    })),
    sequences: arr(r.sequences),
  };
};

export const completionSchema = async (connId: string): Promise<CompletionSchema> => {
  const r = await call<Partial<CompletionSchema> | null>("completion-schema", connId);
  return { "default-schema": r?.["default-schema"] ?? null, schemas: r?.schemas ?? {} };
};

// Profiles. A password goes in (save, test) and never comes back.

export const listProfiles = () => call<Profile[]>("list-profiles");

export const saveProfile = (input: ProfileInput) => call<Profile>("save-profile", input);

export const deleteProfile = (id: string) => call<void>("delete-profile", id);

// Connects with the form as it stands and closes again; saves nothing.
// cancelConnect(attemptId) stops it, as it stops a connect.
export const testConnection = (input: ProfileInput, attemptId: string) =>
  call<{ ok: boolean; label: string }>("test-connection", input, attemptId);

export const connect = (profileId: string, attemptId: string) => call<OpenResult>("connect", profileId, attemptId);

// Stop the connect or test running under attemptId; canceled is false when
// none runs (it ended, or its call has not reached the backend yet).
export const cancelConnect = (attemptId: string) => call<{ canceled: boolean }>("cancel-connect", attemptId);

// The database file the user picks in a native dialog, filtered for the
// profile's engine, or null.
export const chooseFile = (engine?: Engine) =>
  answerOrNull(engine ? call("choose-file", engine) : call("choose-file"));

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

// Whether the user hid the sidebar, saved app-wide like the selection.
export const sidebarHidden = async () => (await call<unknown>("sidebar-hidden")) === true;
export const setSidebarHidden = (hidden: boolean) => call<void>("set-sidebar-hidden", hidden);

// One step on the backend's zoom ladder, or back to 100%. Both answer the
// level now applied.
export type ZoomDirection = "in" | "out" | "reset";
export const zoom = (direction: ZoomDirection) => call<number>("zoom", direction);
export const restoreZoom = () => call<number>("restore-zoom");

// Remember whether the window is maximised or fullscreen.
export const saveWindowState = () => call<void>("save-window-state");

// New versions (quel.updates). download-update resolves once the update is
// downloaded, verified and staged; restart-to-update quits the app.

export const checkUpdate = () => call<UpdateCheck>("check-update");

export const skipUpdate = (version: string) => call<void>("skip-update", version);

export const downloadUpdate = () => call<void>("download-update");

export const restartToUpdate = () => call<void>("restart-to-update");
