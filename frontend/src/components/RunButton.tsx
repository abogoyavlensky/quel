import { Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cancel, runCurrent } from "@/state/runner";
import { type EditorTab, isRunning } from "@/state/store";
import { RUN_KEY, SCRIPT_KEY, STOP_KEY } from "./keys";

// Run in the editor's corner, and Stop while a statement or script runs.
// It turns to Stop only 300ms into a run: a double-click on Run never
// cancels (the second click is a run, which the runner drops while one is
// in flight), and a quick query never flashes Stop. A page load is not a
// run, so it never shows Stop. A press does not take focus, so the editor
// keeps its caret. Keyed by tab in AppShell: switching tabs starts the
// delay over.

// True once value has been true for ms; false at once when it is not.
function useDelayed(value: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!value) return;
    const id = setTimeout(() => setElapsed(true), ms);
    return () => {
      clearTimeout(id);
      setElapsed(false);
    };
  }, [value, ms]);
  return value && elapsed;
}

export function RunButton({ tab }: { tab: EditorTab }) {
  const stop = useDelayed(isRunning(tab), 300);
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="absolute right-4 bottom-3 z-10">
      {stop ? (
        <Button
          size="sm"
          variant="secondary"
          className="shadow-sm"
          aria-label="Stop"
          title={`Stop (${STOP_KEY})`}
          disabled={tab.stopping}
          onMouseDown={keepFocus}
          onClick={() => cancel(tab.id)}
        >
          <Square className="fill-current" />
          Stop
        </Button>
      ) : (
        <Button
          size="sm"
          variant="default"
          className="shadow-sm"
          aria-label="Run"
          title={`Run statement (${RUN_KEY}) · Run all (${SCRIPT_KEY})`}
          onMouseDown={keepFocus}
          onClick={() => void runCurrent("statement")}
        >
          <Play className="fill-current" />
          Run
        </Button>
      )}
    </div>
  );
}
