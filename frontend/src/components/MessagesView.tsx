import { useEffect, useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { messagesWithQuel, quelQueriesShown, toggleQuelQueries } from "@/state/quelLog";
import { type EditorTab, type Message, type QuelQuery, selectedWorkspace, useApp } from "@/state/store";
import { LostNotice } from "./LostNotice";

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;

// What each statement did, newest at the bottom: rows, rows affected, the
// error, or a lost-and-restored connection. Merged in by time, unless the
// header's checkbox hides them: the queries Quel itself sent on this
// connection (state/quelLog.ts), each opening to its full SQL. A tab that
// has run nothing shows hint first (ResultTabs: how to run).
export function MessagesView({ tab, hint }: { tab: EditorTab; hint?: React.ReactNode }) {
  const workspace = useApp(selectedWorkspace);
  const shown = quelQueriesShown(useApp((s) => s.quelQueriesHidden));
  const entries = messagesWithQuel(tab.messages, workspace, shown);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-2 border-b px-3 py-1">
        <Checkbox id={`quel-queries-${tab.id}`} checked={shown} onCheckedChange={toggleQuelQueries} />
        <Label htmlFor={`quel-queries-${tab.id}`} className="text-xs font-normal text-muted-foreground">
          Show Quel's queries
        </Label>
      </div>
      {entries.length === 0 ? (
        (hint ?? <p className="p-4 text-sm text-muted-foreground">Nothing has run in this tab yet.</p>)
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          {hint}
          <div role="log" aria-label="Messages" className="py-1 text-xs">
            {entries.map((e) =>
              e.kind === "tab" ? <TabMessage key={e.m.id} tab={tab} m={e.m} /> : <QuelEntry key={e.q.id} q={e.q} />,
            )}
            <div ref={end} />
          </div>
        </div>
      )}
    </div>
  );
}

function TabMessage({ tab, m }: { tab: EditorTab; m: Message }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-3 px-3 py-1.5">
      <span className="text-muted-foreground tabular-nums">{time(m.at)}</span>
      <div className="min-w-0">
        <p className="truncate font-mono text-muted-foreground" title={m.sql}>
          {oneLine(m.sql)}
        </p>
        {m.kind === "lost" && m.lost ? (
          <LostNotice tab={tab} messageId={m.id} lost={m.lost} />
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
  );
}

// One query Quel sent: its SQL on one line and what it returned; opening
// it shows the SQL as it was sent. A closed <details> shows only its
// summary, so the outcome is in the summary too.
function QuelEntry({ q }: { q: QuelQuery }) {
  return (
    <details role="group" aria-label="Quel's query" className="group/quel px-3 py-1.5">
      <summary className="grid cursor-default list-none grid-cols-[5.5rem_1fr] gap-x-3 [&::-webkit-details-marker]:hidden">
        <span className="text-muted-foreground tabular-nums">{time(q.at)}</span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Quel
            </span>
            <span className="truncate font-mono text-muted-foreground group-open/quel:hidden" title="Show the full query">
              {oneLine(q.sql)}
            </span>
          </span>
          {q.error !== null ? (
            <span className="block break-words whitespace-pre-wrap text-destructive">{q.error}</span>
          ) : (
            <span className="block text-muted-foreground">
              {plural(q.rows ?? 0, "row")} in {q.ms} ms
            </span>
          )}
          {q.params.length > 0 && (
            <span className="block text-muted-foreground">Parameters: {q.params.join(", ")}</span>
          )}
        </span>
      </summary>
      <pre className="mt-1 ml-[calc(5.5rem+0.75rem)] font-mono break-words whitespace-pre-wrap text-muted-foreground">
        {q.sql.trim()}
      </pre>
    </details>
  );
}
