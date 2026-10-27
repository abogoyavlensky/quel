import { activeTabOf, isRunning, selectedWorkspace, useApp } from "@/state/store";
import { ConnMark } from "./ConnMark";

// The selected profile and its connection, and the active tab's state.
// Rows and time are in the grid's footer, Stop is in the editor, and
// connecting is the sidebar's job.
export function StatusBar() {
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.selected));
  const w = useApp(selectedWorkspace);
  const notice = useApp((s) => s.notice);
  const tab = w && activeTabOf(w);
  const running = !!tab && isRunning(tab);
  const status = w?.status ?? "disconnected";

  let state = "";
  if (!profile) {
    // Nothing selected: the name slot says "No connection".
  } else if (status === "connecting") state = "Connecting…";
  else if (status === "disconnecting") state = "Disconnecting…";
  else if (tab?.stopping) state = "Canceling…";
  else if (running) state = "Running…";
  else if (notice) state = notice;
  else if (status === "disconnected") state = "Not connected";
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
    </footer>
  );
}
