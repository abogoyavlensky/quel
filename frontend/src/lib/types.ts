// The shapes the backend handlers return (quel.api). Keys are let-go
// keywords on the backend; the bridge lowers them to these strings.

export type Cell = string | number | boolean | null;

export interface Column {
  name: string;
  type: string;
}

export interface RunResult {
  columns: Column[];
  rows: Cell[][];
  "has-more": boolean;
  "update-count": number | null;
  "elapsed-ms": number;
}

export interface OpenResult {
  "conn-id": string;
  path: string;
}
