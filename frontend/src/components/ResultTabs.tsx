import { MessageSquare, Pin, PinOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResultGrid } from "@/grid/ResultGrid";
import { cn } from "@/lib/utils";
import { closeResult, connectProfile, pin, selectResult } from "@/state/runner";
import { type EditorTab, MESSAGES, selectedWorkspace, useApp } from "@/state/store";
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
        "group flex h-[26px] shrink-0 cursor-default items-center gap-1.5 rounded-full pr-1.5 pl-2.5 text-xs select-none",
        selected ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </div>
  );
}

// The selected profile is not connected: says so, and offers to connect
// (only that; nothing runs). The empty tab shows it as a paragraph, so you
// see it before you try; a tab with results shows it as a thin banner
// after a refused run.
function NotConnected({ banner }: { banner: boolean }) {
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.selected));
  const w = useApp(selectedWorkspace);
  if (!profile || !w) return null;
  const connecting = w.status === "connecting";

  return (
    <div
      aria-live="polite"
      className={
        banner
          ? "flex h-8 shrink-0 items-center gap-2 border-b bg-muted/40 px-3 text-xs"
          : "flex flex-wrap items-center gap-2 p-4 text-sm text-muted-foreground"
      }
    >
      <span>
        <b className={cn("font-medium", !banner && "text-foreground")}>{profile.name}</b> isn't connected.
      </span>
      <Button
        size="xs"
        variant="outline"
        aria-label={`Connect to ${profile.name}`}
        disabled={connecting}
        onClick={() => void connectProfile(profile.id)}
      >
        {connecting ? "Connecting…" : "Connect"}
      </Button>
      {w.error && <span className="text-destructive">{w.error}</span>}
    </div>
  );
}

// The results of one editor tab: its messages log and one tab per result.
// A run replaces the results; a kept one ("Keep result", the pin) stays
// until closed. While the profile is not connected, the empty tab says so
// instead of the run hint, and a refused run puts a banner above the
// results.
export function ResultTabs({ tab }: { tab: EditorTab }) {
  const current = tab.results.find((r) => r.id === tab.active);
  const empty = tab.results.length === 0 && tab.messages.length === 0;
  const w = useApp(selectedWorkspace);
  const offline = w?.status === "disconnected" || w?.status === "connecting";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!empty && offline && w.runRefused && <NotConnected banner />}
      <div
        role="tablist"
        aria-label="Results"
        className="flex h-[42px] shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 px-2.5"
      >
        <TabButton selected={tab.active === MESSAGES} onSelect={() => selectResult(tab.id, MESSAGES)}>
          <MessageSquare className="size-3.5" />
          <span className="pr-1">Messages</span>
        </TabButton>
        {tab.results.map((r) => (
          <TabButton
            key={r.id}
            selected={r.id === tab.active}
            onSelect={() => selectResult(tab.id, r.id)}
            title={r.sql}
          >
            <span className="max-w-56 truncate font-mono text-[12.5px]">{label(r.sql)}</span>
            <button
              type="button"
              aria-label="Keep result"
              title="Keep result across runs"
              aria-pressed={r.pinned}
              onClick={(e) => {
                e.stopPropagation();
                pin(tab.id, r.id);
              }}
              className={cn(
                "rounded-full p-0.5 hover:bg-background/70",
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
              className="rounded-full p-0.5 opacity-0 group-hover:opacity-100 group-aria-selected:opacity-60 hover:bg-background/70 focus-visible:opacity-100"
            >
              <X className="size-3" />
            </button>
          </TabButton>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {empty ? (
          offline ? (
            <NotConnected banner={false} />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              Run the statement under the cursor with {RUN_KEY}. Its rows show here.
            </p>
          )
        ) : current ? (
          <ResultGrid key={current.id} tabId={tab.id} result={current} />
        ) : (
          <MessagesView messages={tab.messages} />
        )}
      </div>
    </div>
  );
}
