import { LoaderCircle } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { rowsText } from "@/grid/ResultGrid";
import { Button } from "@/components/ui/button";
import { formatElapsed } from "@/lib/elapsed";
import { useDelayed } from "@/lib/useDelayed";
import { cancelExport } from "@/state/runner";
import { exportWords, runWords } from "@/state/status";
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

// Something in progress, at the strip's left end.
function Working({ children }: { children: ReactNode }) {
  return (
    <span role="status" className="flex min-w-0 items-center gap-2 text-foreground">
      <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin text-primary" />
      {children}
    </span>
  );
}

// The strip under the results: what the tab's run is doing, or the shown
// result's rows or count and time. 300ms into a run (the Stop button's
// delay, so a quick query never flashes it) it says "Running…" or
// "Canceling…" with the time so far, whichever tab shows; then the result's
// rows or count and time take the same places. Otherwise (Messages, the
// empty tab, an error, a cancel) there is none. A page load is not a run:
// the rows text says "loading more…". An export, past the same delay, says
// how far it has come in the rows text's place, on Messages too, with a
// Cancel button after it, also while the rest of its rows load. Keyed by tab
// in ResultTabs: switching tabs starts the delay over.
export function ResultFooter({ tab, result: shown }: { tab: EditorTab; result: ResultTab | undefined }) {
  const result = shown?.kind === "rows" || shown?.kind === "update" ? shown : undefined;
  const busy = useDelayed(isRunning(tab), 300);
  const words = busy ? runWords(tab) : null;
  const exportText = exportWords(tab);
  const exportShown = useDelayed(exportText !== null, 300);
  const exporting = exportShown ? exportText : null;
  const cancelable = useDelayed(tab.exporting !== null, 300);
  if (!words && !exporting && !cancelable && !result) return null;

  return (
    <div
      role="group"
      aria-label="Result footer"
      className="flex h-9 shrink-0 items-center justify-between gap-3 border-t px-3.5 text-xs text-muted-foreground"
    >
      {words ? (
        <>
          <Working>{words}</Working>
          {tab.runStartedAt != null && <Elapsed since={tab.runStartedAt} />}
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2">
            {exporting ? (
              <Working>{exporting}</Working>
            ) : (
              result && (
                <span role="status" className="min-w-0 truncate">
                  {result.kind === "rows" ? rowsText(result) : result.text}
                </span>
              )
            )}
            {cancelable && (
              <Button variant="ghost" size="xs" onClick={() => cancelExport(tab.id)}>
                Cancel
              </Button>
            )}
          </div>
          {result && (
            <div className="flex shrink-0 items-center gap-2">
              {result.kind === "rows" && (
                <ExportMenu key={result.id} tabId={tab.id} result={result} exporting={tab.exporting !== null} />
              )}
              <span className="tabular-nums">{result.elapsedMs.toLocaleString()} ms</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
