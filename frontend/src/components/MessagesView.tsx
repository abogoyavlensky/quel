import { useEffect, useRef } from "react";
import { PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Lost } from "@/lib/lost";
import { canRerunLost, rerunLost } from "@/state/runner";
import type { EditorTab, Message } from "@/state/store";

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// What each statement did, newest at the bottom: rows, rows affected, the
// error, or a lost-and-restored connection.
export function MessagesView({ tab }: { tab: EditorTab }) {
  const { messages } = tab;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">Nothing has run in this tab yet.</p>;
  }
  return (
    <div role="log" aria-label="Messages" className="h-full overflow-auto py-1 text-xs">
      {messages.map((m) => (
        <div key={m.id} className="grid grid-cols-[5.5rem_1fr] gap-x-3 px-3 py-1.5">
          <span className="text-muted-foreground tabular-nums">{time(m.at)}</span>
          <div className="min-w-0">
            <p className="truncate font-mono text-muted-foreground" title={m.sql}>
              {m.sql.replace(/\s+/g, " ")}
            </p>
            {m.kind === "lost" && m.lost ? (
              <LostNotice tab={tab} message={m} lost={m.lost} />
            ) : (
              <p
                className={cn(
                  "break-words whitespace-pre-wrap",
                  m.kind === "error" && "text-destructive",
                  m.kind === "canceled" && "text-muted-foreground",
                )}
              >
                {m.text}
                {m.elapsedMs !== null && <span className="text-muted-foreground"> in {m.elapsedMs} ms</span>}
              </p>
            )}
          </div>
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}

function headline(lost: Lost): string {
  if (lost.page) {
    return "Connection lost and restored while loading rows. The statement had already run: if it changes data, check before running it again.";
  }
  if (lost.notRun) return "Connection lost and restored. The statement was not run.";
  return "Connection lost and restored. The statement may have completed: check before running it again.";
}

// The connection was lost and Quel reconnected: say so calmly, what the
// session lost, and offer Run again when nothing ran.
function LostNotice({ tab, message, lost }: { tab: EditorTab; message: Message; lost: Lost }) {
  const n = message.rerun?.length ?? 0;
  return (
    <div className="space-y-1">
      <p className="flex items-start gap-1.5 break-words text-amber-700 dark:text-amber-400">
        <PlugZap aria-hidden className="mt-px size-3.5 shrink-0" />
        <span>{headline(lost)}</span>
      </p>
      <p className="pl-5 text-muted-foreground">
        Any open transaction, SET values and temp tables in this tab were reset.
      </p>
      {canRerunLost(tab, message.id) && (
        <div className="pl-5">
          <Button size="xs" variant="outline" onClick={() => void rerunLost(tab.id, message.id)}>
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
