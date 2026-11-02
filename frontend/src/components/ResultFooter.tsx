import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { rowsText } from "@/grid/ResultGrid";
import { formatElapsed } from "@/lib/elapsed";
import { useDelayed } from "@/lib/useDelayed";
import { runWords } from "@/state/status";
import { type EditorTab, type ResultTab, isRunning } from "@/state/store";
import { ExportMenu } from "./ExportMenu";

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
  return text ? <span className="text-foreground tabular-nums">{text}</span> : null;
}

// The strip under the results: what the tab's run is doing, or the shown
// result's rows and time. 300ms into a run (the Stop button's delay, so a
// quick query never flashes it) it says "Running…" or "Canceling…" with
// the time so far, over Messages or a kept result alike; then the run's
// last result shows and its rows and time take the same places. With no
// run and no result showing (Messages, the empty tab) there is none. A
// page load is not a run: the rows text says "loading more…". Keyed by
// tab in ResultTabs: switching tabs starts the delay over.
export function ResultFooter({ tab, result }: { tab: EditorTab; result: ResultTab | undefined }) {
  const busy = useDelayed(isRunning(tab), 300);
  const words = busy ? runWords(tab) : null;
  if (!words && !result) return null;

  return (
    <div
      role="group"
      aria-label="Result footer"
      className="flex h-9 shrink-0 items-center justify-between gap-3 border-t px-3.5 text-xs text-muted-foreground"
    >
      {words ? (
        <>
          <span role="status" className="flex min-w-0 items-center gap-2 text-foreground">
            <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin text-primary" />
            {words}
          </span>
          {tab.runStartedAt != null && <Elapsed since={tab.runStartedAt} />}
        </>
      ) : (
        result && (
          <>
            <span role="status" className="min-w-0 truncate">
              {rowsText(result)}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <ExportMenu key={result.id} tabId={tab.id} result={result} />
              <span className="tabular-nums">{result.elapsedMs.toLocaleString()} ms</span>
            </div>
          </>
        )
      )}
    </div>
  );
}
