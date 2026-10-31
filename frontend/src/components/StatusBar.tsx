import { useEffect, useState } from "react";
import { formatElapsed } from "@/lib/elapsed";
import { activeTabOf, isRunning, selectedWorkspace, store, useApp } from "@/state/store";
import { updateLabel } from "@/state/updates";
import { Button } from "@/components/ui/button";

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

// What is happening: the active tab's state, or the connection's. The
// connection itself is named in the top strip, rows and time are in the
// grid's footer, Stop is in the editor, and connecting is the sidebar's
// job. A run's time shows next to "Running…". At the right end, a newer
// version: its button opens the update dialog.
export function StatusBar() {
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.selected));
  const w = useApp(selectedWorkspace);
  const notice = useApp((s) => s.notice);
  const tab = w && activeTabOf(w);
  const running = !!tab && isRunning(tab);
  const status = w?.status ?? "disconnected";
  const update = useApp((s) => updateLabel(s.update));

  let state = "";
  if (!profile) state = "No connection";
  else if (status === "connecting") state = "Connecting…";
  else if (status === "disconnecting") state = "Disconnecting…";
  else if (tab?.stopping) state = "Canceling…";
  else if (running) state = "Running…";
  else if (notice) state = notice;
  else if (status === "disconnected") state = "Not connected";
  else state = "Ready";

  return (
    <footer className="flex h-9 shrink-0 items-center border-t bg-chrome px-3.5 text-xs text-muted-foreground">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span role="status" className="truncate">
          {state}
        </span>
        {(running || tab?.stopping) && tab?.runStartedAt != null && <Elapsed since={tab.runStartedAt} />}
      </span>
      {update && (
        <Button
          size="xs"
          variant="ghost"
          className="shrink-0 text-foreground"
          onClick={() => store.setState({ updateDialogOpen: true })}
        >
          {update}
        </Button>
      )}
    </footer>
  );
}
