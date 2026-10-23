import { Button } from "@/components/ui/button";
import { cancel, connectProfile } from "@/state/runner";
import { activeTabOf, selectedWorkspace, useApp } from "@/state/store";
import { ConnMark } from "./ConnMark";

// The selected profile and its connection, the active tab's state, Cancel
// while something runs there, and Connect when it is not connected.
export function StatusBar() {
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.selected));
  const w = useApp(selectedWorkspace);
  const notice = useApp((s) => s.notice);
  const tab = w && activeTabOf(w);
  const result = tab?.results.find((r) => r.id === tab.active);
  const running = !!tab?.runningQueryId;
  const status = w?.status ?? "disconnected";

  let state = "";
  if (!profile) {
    // Nothing selected: the name slot says "No connection".
  } else if (status === "connecting") state = "Connecting…";
  else if (status === "disconnecting") state = "Disconnecting…";
  else if (status === "disconnected") state = notice ?? "Not connected";
  else if (tab?.stopping) state = "Canceling…";
  else if (running) state = "Running…";
  else state = "Ready";

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-muted/30 px-3 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        <ConnMark engine={profile?.engine ?? null} color={profile?.color} status={profile ? status : "connected"} />
        <span className="max-w-80 truncate font-mono" title={profile?.name}>
          {profile ? profile.name : "No connection"}
        </span>
      </span>
      <span role="status" className="flex-1 truncate">
        {state}
      </span>
      {profile && status === "disconnected" && (
        <Button size="xs" variant="outline" onClick={() => void connectProfile(profile.id)}>
          Connect
        </Button>
      )}
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
