// The shapes the backend handlers return (quel.api). Keys are let-go
// keywords on the backend; the bridge lowers them to these strings.

import type { RunPolicy } from "@/sql/guard";

export type Cell = string | number | boolean | null;

export interface Column {
  name: string;
  type: string;
}

// `run`'s reply. With "has-more" true the cursor stays open on the
// backend under the run's query-id, for `fetch-page`.
export interface RunResult {
  columns: Column[];
  rows: Cell[][];
  "has-more": boolean;
  "update-count": number | null;
  "elapsed-ms": number;
}

// `fetch-page`'s reply. "closed" means the cursor is gone (read to the end
// before, closed by a newer run in its tab, by close-result, or when idle).
export interface FetchResult {
  rows: Cell[][];
  "has-more": boolean;
  closed: boolean;
}

export type Engine = "sqlite" | "duckdb" | "postgres" | "redshift";

export interface OpenResult {
  "conn-id": string;
  engine: Engine;
  // The file path, or the URL without its password and query string; for
  // a profile, its name.
  label: string;
  // Set when a profile was connected (`connect`).
  "profile-id"?: string;
}

// The structure of an open database (quel.meta). "default" marks the
// schema unqualified names resolve to.
export interface SchemaInfo {
  name: string;
  default: boolean;
}

export type ObjectKind = "table" | "view" | "materialized-view";

export interface ObjectInfo {
  name: string;
  kind: ObjectKind;
}

// "pk" and "fk": a primary or foreign key lists the column.
export interface ColumnInfo {
  name: string;
  type: string;
  pk: boolean;
  fk: boolean;
}

export interface FunctionInfo {
  name: string;
  kind: "function" | "procedure";
  args: string; // the argument types, "x integer, y text"
}

// "detail" is a domain's base type; "values" an enum's labels, in order.
export interface TypeInfo {
  name: string;
  kind: "enum" | "domain" | "composite";
  detail: string | null;
  values: string[];
}

// A sequence no column owns.
export interface SequenceInfo {
  name: string;
}

// `describe-schema`'s reply: what the tree shows under a schema.
export interface SchemaContents {
  objects: ObjectInfo[];
  functions: FunctionInfo[];
  types: TypeInfo[];
  sequences: SequenceInfo[];
}

// "definition" is the method and columns, "btree (a, b)".
export interface IndexInfo {
  name: string;
  definition: string;
  unique: boolean;
  primary: boolean;
}

export type KeyKind = "primary-key" | "unique" | "foreign-key" | "check";

// "name" is null where the engine has none (SQLite).
export interface KeyInfo {
  name: string | null;
  kind: KeyKind;
  columns: string[];
  definition: string;
}

// A sequence one of the object's columns owns (serial, identity).
export interface OwnedSequence {
  name: string;
  column: string;
}

// `describe-object`'s reply: what the tree shows under a table or view.
export interface ObjectDetails {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  keys: KeyInfo[];
  sequences: OwnedSequence[];
}

// `completion-schema`'s reply: schema -> table -> columns, in order.
export interface CompletionSchema {
  "default-schema": string | null;
  schemas: Record<string, Record<string, string[]>>;
}

export type Color = "none" | "red" | "orange" | "yellow" | "green" | "blue" | "purple";

export type SslMode = "disable" | "allow" | "prefer" | "require" | "verify-ca" | "verify-full";

// A saved connection profile, as `list-profiles` and `save-profile` return
// it. The password is never here: it lives in the Keychain, and
// "has-password" says whether one is saved.
export interface Profile {
  id: string;
  name: string;
  engine: Engine;
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
  "ssl-mode": SslMode | null;
  path: string | null; // SQLite only
  color: Color;
  // What the editor does before a run here: runs, asks, or refuses
  // writes (sql/guard.ts). The backend only stores it.
  "run-policy": RunPolicy;
  "has-password": boolean;
}

// What `save-profile` and `test-connection` take. No id: a new profile.
// password: absent keeps the saved one, a string replaces it.
// "forget-password": deletes the saved one (and wins over password).
export interface ProfileInput {
  id?: string;
  name: string;
  engine: Engine;
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
  "ssl-mode": SslMode | null;
  path: string | null;
  color: Color;
  "run-policy": RunPolicy;
  password?: string;
  "forget-password"?: boolean;
}

// A profile's saved editor tab, as `load-workspace` and `reopen-tab`
// return it and `save-workspace` takes it. "body" is its text; "sel-from"
// and "sel-to" its selection.
export interface SavedTab {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  "sel-from": number;
  "sel-to": number;
}

// A recently closed tab. "closed-at" is ms since the epoch.
export interface ClosedTab {
  id: string;
  title: string;
  body: string;
  "closed-at": number;
}

// `load-workspace`'s reply: the open tabs in order, newest closed first.
export interface SavedWorkspace {
  tabs: SavedTab[];
  "active-tab": string | null;
  "next-tab-number": number;
  closed: ClosedTab[];
}

// What `save-workspace` takes.
export interface WorkspaceInput {
  tabs: SavedTab[];
  "active-tab": string;
  "next-tab-number": number;
}

// A newer release, as `check-update` describes it.
export interface UpdateRelease {
  version: string;
  name: string;
  url: string;
  "published-at": string;
  size: number;
}

// `check-update`'s reply. With checks off (QUEL_UPDATES=off) only
// `current` and `enabled` come back.
export interface UpdateCheck {
  current: string;
  enabled: boolean;
  "can-install"?: boolean;
  reason?: string | null;
  release?: UpdateRelease | null;
  skipped?: boolean;
}

// A check that found a release.
export type UpdateInfo = UpdateCheck & { release: UpdateRelease };

// Where an update stands: found, downloading, staged and waiting for the
// restart, restarting, or failed. Idle shows nothing.
export type UpdateState =
  | { phase: "idle" }
  | { phase: "available"; info: UpdateInfo }
  | { phase: "downloading"; info: UpdateInfo; written: number; total: number }
  | { phase: "ready"; info: UpdateInfo; saveError?: string }
  | { phase: "restarting"; info: UpdateInfo }
  | { phase: "error"; info: UpdateInfo; message: string };
