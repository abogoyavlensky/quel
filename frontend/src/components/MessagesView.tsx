import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Message } from "@/state/store";

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// What each statement did, newest at the bottom: rows, rows affected, or
// the error.
export function MessagesView({ messages }: { messages: Message[] }) {
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
          </div>
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
