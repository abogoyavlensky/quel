import { useEffect, useState } from "react";
import { formatElapsed } from "@/lib/elapsed";
import { activeTabOf, isRunning, selectedWorkspace, useApp } from "@/state/store";
import { ConnMark } from "./ConnMark";

// How long the run has lasted, redrawn a few times a second. Mounted only
// while something runs, so the clock stops with the run.
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(id);
    };
  }, []);
  const text = formatElapsed(now - since);
  return text ? <span className="tabular-nums">{text}</span> : null;
}

// The selected profile and its connection, and the active tab's state.
// Rows and time are in the grid's footer, Stop is in the editor, and
// connecting is the sidebar's job. A run's time shows next to "Running…".
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
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span role="status" className="truncate">
          {state}
        </span>
        {(running || tab?.stopping) && tab?.runStartedAt != null && <Elapsed since={tab.runStartedAt} />}
      </span>
    </footer>
  );
}
