import { PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Lost } from "@/lib/lost";
import { canRerunLost, rerunLost } from "@/state/runner";
import type { EditorTab } from "@/state/store";

function headline(lost: Lost): string {
  if (lost.page) {
    return "Connection lost and restored while loading rows. The statement had already run: if it changes data, check before running it again.";
  }
  if (lost.notRun) return "Connection lost and restored. The statement was not run.";
  return "Connection lost and restored. The statement may have completed: check before running it again.";
}

// The connection was lost and Quel reconnected: say so calmly, what the
// session lost, and offer Run again when nothing ran. Shown in the
// messages and in the statement's result tab; messageId names the message.
export function LostNotice({ tab, messageId, lost }: { tab: EditorTab; messageId: string; lost: Lost }) {
  const n = tab.messages.find((m) => m.id === messageId)?.rerun?.length ?? 0;
  return (
    <div className="space-y-1">
      <p className="flex items-start gap-1.5 break-words text-amber-700 dark:text-amber-400">
        <PlugZap aria-hidden className="mt-px size-3.5 shrink-0" />
        <span>{headline(lost)}</span>
      </p>
      <p className="pl-5 text-muted-foreground">
        Any open transaction, SET values and temp tables in this tab were reset.
      </p>
      {canRerunLost(tab, messageId) && (
        <div className="pl-5">
          <Button size="xs" variant="outline" onClick={() => void rerunLost(tab.id, messageId)}>
            {n > 1 ? `Run the remaining ${n}` : "Run again"}
          </Button>
        </div>
      )}
      {lost.error && (
        <details className="pl-5 text-muted-foreground">
          <summary className="cursor-pointer select-none">Details</summary>
          <p className="mt-0.5 font-mono break-words whitespace-pre-wrap">{lost.error}</p>
        </details>
      )}
    </div>
  );
}
