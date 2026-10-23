// The shapes the backend handlers return (quel.api). Keys are let-go
// keywords on the backend; the bridge lowers them to these strings.

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

export type Engine = "sqlite" | "postgres" | "redshift";

export interface OpenResult {
  "conn-id": string;
  engine: Engine;
  // The file path, or the URL without its password and query string; for
  // a profile, its name.
  label: string;
  // Set when a profile was connected (`connect`).
  "profile-id"?: string;
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
  password?: string;
  "forget-password"?: boolean;
}
