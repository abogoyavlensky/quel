import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDelayed } from "@/lib/useDelayed";
import { cancel, runCurrent } from "@/state/runner";
import { type EditorTab, isRunning } from "@/state/store";
import { keyLabelOf } from "@/state/keymap";

// Run in the editor's corner, and Stop while a statement or script runs.
// It turns to Stop only 300ms into a run: a double-click on Run never
// cancels (the second click is a run, which the runner drops while one is
// in flight), and a quick query never flashes Stop. A page load is not a
// run, so it never shows Stop. A press does not take focus, so the editor
// keeps its caret. Keyed by tab in AppShell: switching tabs starts the
// delay over.

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
          title={`Stop (${keyLabelOf("cancel")})`}
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
          variant="secondary"
          className="bg-primary/10 text-primary shadow-none hover:bg-primary/15"
          aria-label="Run"
          title={`Run statement (${keyLabelOf("run")}) · Run all (${keyLabelOf("run-script")})`}
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
