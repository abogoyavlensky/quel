import { Pin, PinOff, X } from "lucide-react";
import { ResultGrid } from "@/grid/ResultGrid";
import { cn } from "@/lib/utils";
import { closeResult, pin, selectResult } from "@/state/runner";
import { type EditorTab, MESSAGES } from "@/state/store";
import { MessagesView } from "./MessagesView";
import { RUN_KEY } from "./keys";

// A result tab is named by its statement, as far as it fits.
function label(sql: string): string {
  const line = sql.replace(/\s+/g, " ").trim();
  return line.length > 32 ? `${line.slice(0, 31)}…` : line;
}

function TabButton({
  selected,
  onSelect,
  children,
  title,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div
      role="tab"
      aria-selected={selected}
      tabIndex={0}
      title={title}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      className={cn(
        "group flex h-7 shrink-0 cursor-default items-center gap-1 rounded-md px-2 text-xs select-none",
        selected ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </div>
  );
}

// The results of one editor tab: its messages log and one tab per result.
// A run replaces the unpinned results; a pinned one stays until closed.
export function ResultTabs({ tab }: { tab: EditorTab }) {
  const current = tab.results.find((r) => r.id === tab.active);
  const empty = tab.results.length === 0 && tab.messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Results" className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b px-2">
        <TabButton selected={tab.active === MESSAGES} onSelect={() => selectResult(tab.id, MESSAGES)}>
          Messages
        </TabButton>
        {tab.results.map((r) => (
          <TabButton key={r.id} selected={r.id === tab.active} onSelect={() => selectResult(tab.id, r.id)} title={r.sql}>
            <span className="max-w-56 truncate font-mono">{label(r.sql)}</span>
            <button
              type="button"
              aria-label={r.pinned ? "Unpin result" : "Pin result"}
              aria-pressed={r.pinned}
              onClick={(e) => {
                e.stopPropagation();
                pin(tab.id, r.id);
              }}
              className={cn(
                "rounded p-0.5 hover:bg-background",
                r.pinned ? "text-foreground" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              )}
            >
              {r.pinned ? <Pin className="size-3 fill-current" /> : <PinOff className="size-3" />}
            </button>
            <button
              type="button"
              aria-label="Close result"
              onClick={(e) => {
                e.stopPropagation();
                closeResult(tab.id, r.id);
              }}
              className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-background focus-visible:opacity-100"
            >
              <X className="size-3" />
            </button>
          </TabButton>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {empty ? (
          <p className="p-4 text-sm text-muted-foreground">
            Run the statement under the cursor with {RUN_KEY}. Its rows show here.
          </p>
        ) : current ? (
          <ResultGrid key={current.id} tabId={tab.id} result={current} />
        ) : (
          <MessagesView messages={tab.messages} />
        )}
      </div>
    </div>
  );
}
