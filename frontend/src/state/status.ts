import { type ConnStatus, type EditorTab, isRunning } from "./store";

// The words for what is happening, where the window shows it: the
// connection's state in the top strip's pill, a run's and an export's in the
// results footer.

// The connection's state as words for the top strip; none when connected.
export function connectionWords(status: ConnStatus): string | null {
  switch (status) {
    case "disconnected":
      return "Not connected";
    case "connecting":
      return "Connecting…";
    case "disconnecting":
      return "Disconnecting…";
    case "connected":
      return null;
  }
}

// "Canceling…" while a cancel is asked, "Running…" while a statement or
// script runs, else none. A page load is not a run.
export function runWords(tab: EditorTab): string | null {
  if (tab.stopping) return "Canceling…";
  if (isRunning(tab)) return "Running…";
  return null;
}

// How far an export has come, once rows are moving; none before that, while
// the rest of the result loads or the save dialog is open.
export function exportWords({ exporting }: EditorTab): string | null {
  if (exporting?.rows == null) return null;
  const verb = exporting.action === "copy" ? "Copying" : "Saving";
  return `${verb} ${exporting.rows.toLocaleString("en-US")} of ${exporting.total.toLocaleString("en-US")} rows…`;
}
