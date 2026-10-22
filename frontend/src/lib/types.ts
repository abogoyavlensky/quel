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
  // The file path, or the URL without its password and query string.
  label: string;
}
