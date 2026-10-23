import { Button } from "@/components/ui/button";
import { cancel } from "@/state/runner";
import { useApp } from "@/state/store";
import { ConnMark } from "./ConnMark";

// The open database, the active tab's state, and Cancel while something
// runs there.
export function StatusBar() {
  const conn = useApp((s) => s.conn);
  const tab = useApp((s) => s.tabs.find((t) => t.id === s.activeTab));
  const result = tab?.results.find((r) => r.id === tab.active);
  const running = !!tab?.runningQueryId;

  let state = "Ready";
  if (!conn) state = "Connect a database to run queries";
  else if (tab?.stopping) state = "Canceling…";
  else if (running) state = "Running…";

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-muted/30 px-3 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        <ConnMark engine={conn?.engine ?? null} color={conn?.color} />
        <span className="max-w-80 truncate font-mono" title={conn?.label}>
          {conn ? conn.label : "No database"}
        </span>
      </span>
      <span role="status" className="flex-1 truncate">
        {state}
      </span>
      {result && !running && (
        <span className="flex gap-3 tabular-nums">
          <span>{result.rows.length.toLocaleString()} rows</span>
          <span>{result.elapsedMs.toLocaleString()} ms</span>
        </span>
      )}
      {running && tab && (
        <Button size="xs" variant="outline" disabled={tab.stopping} onClick={() => cancel(tab.id)}>
          Cancel
        </Button>
      )}
    </footer>
  );
}
