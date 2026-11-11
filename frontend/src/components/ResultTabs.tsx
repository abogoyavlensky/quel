import { useRef, useState } from "react";
import { MessageSquare, Pin, PinOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ResultGrid } from "@/grid/ResultGrid";
import { cn } from "@/lib/utils";
import { cancelConnect, closeResult, connectProfile, pin, renameResult, selectResult } from "@/state/runner";
import { type EditorTab, MESSAGES, selectedWorkspace, useApp } from "@/state/store";
import { MessagesView } from "./MessagesView";
import { NameInput } from "./NameInput";
import { ResultFooter } from "./ResultFooter";
import { ResultOutcome } from "./ResultOutcome";
import { RUN_KEY } from "./keys";
import { useResultTabDrag } from "./useResultTabDrag";

// A result tab is named by its statement, as far as it fits.
function label(sql: string): string {
  const line = sql.replace(/\s+/g, " ").trim();
  return line.length > 32 ? `${line.slice(0, 31)}…` : line;
}

// Other props (a context menu trigger's handlers and ref) go to the div.
function TabButton({
  selected,
  onSelect,
  className,
  ...props
}: { selected: boolean; onSelect: () => void } & React.ComponentProps<"div">) {
  return (
    <div
      role="tab"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && onSelect()}
      {...props}
      className={cn(
        "group flex h-[30px] shrink-0 cursor-default items-center gap-1.5 rounded-full pr-1.5 pl-2.5 text-xs select-none",
        selected ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    />
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
      {connecting && <span>Connecting…</span>}
      <Button
        size="xs"
        variant="outline"
        aria-label={connecting ? `Cancel connecting to ${profile.name}` : `Connect to ${profile.name}`}
        onClick={() => (connecting ? cancelConnect(profile.id) : void connectProfile(profile.id))}
      >
        {connecting ? "Cancel" : "Connect"}
      </Button>
      {w.error && <span className="text-destructive">{w.error}</span>}
    </div>
  );
}

// The results of one editor tab: its messages log and one tab per
// statement run, showing its rows or what it came to (a count, the error).
// A run replaces the results; a kept one ("Keep result", the pin) stays
// until closed. While the profile is not connected, the empty tab says so
// instead of the run hint, and a refused run puts a banner above the
// results. The footer under them says what a run is doing, or the shown
// result's rows and time. Double-click a result tab to name it; right-click
// for Rename, Keep and Close. A blank name gives back the statement. A kept
// tab drags to a new place in the strip (useResultTabDrag); other tabs and
// Messages do not move.
export function ResultTabs({ tab }: { tab: EditorTab }) {
  const [editing, setEditing] = useState<string | null>(null);
  // Rename chosen in a tab's menu: the input appears once the menu has
  // closed and let go of focus, or it would not keep it.
  const renameAfterMenu = useRef<string | null>(null);
  const current = tab.results.find((r) => r.id === tab.active);
  const empty = tab.results.length === 0 && tab.messages.length === 0;
  const w = useApp(selectedWorkspace);
  const offline = w?.status === "disconnected" || w?.status === "connecting";
  const { dragging, stripProps } = useResultTabDrag(tab.id);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!empty && offline && w.runRefused && <NotConnected banner />}
      <div
        role="tablist"
        aria-label="Results"
        {...stripProps}
        className={cn(
          "flex h-[46px] shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 px-2.5",
          dragging && "cursor-grabbing **:cursor-grabbing",
        )}
      >
        <TabButton selected={tab.active === MESSAGES} onSelect={() => selectResult(tab.id, MESSAGES)}>
          <MessageSquare className="size-4" />
          <span className="pr-1">Messages</span>
        </TabButton>
        {tab.results.map((r) => (
          <ContextMenu key={r.id}>
            <ContextMenuTrigger asChild>
              <TabButton
                selected={r.id === tab.active}
                onSelect={() => selectResult(tab.id, r.id)}
                onDoubleClick={(e) => !(e.target as HTMLElement).closest("button") && setEditing(r.id)}
                title={r.sql}
                data-result-id={r.id}
                data-kept={r.pinned ? "" : undefined}
                data-dragging={dragging === r.id ? "" : undefined}
                className="data-dragging:ring-1 data-dragging:ring-ring"
              >
                {editing === r.id ? (
                  <NameInput
                    value={r.title ?? ""}
                    placeholder={label(r.sql)}
                    label="Result name"
                    onCommit={(name) => renameResult(tab.id, r.id, name)}
                    onDone={() => setEditing(null)}
                  />
                ) : (
                  <span className={cn("max-w-56 truncate text-[14px]", r.title === undefined && "font-mono")}>
                    {r.title ?? label(r.sql)}
                  </span>
                )}
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
                  {r.pinned ? <Pin className="size-3.5 fill-current" /> : <PinOff className="size-3.5" />}
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
                  <X className="size-3.5" />
                </button>
              </TabButton>
            </ContextMenuTrigger>
            <ContextMenuContent
              onCloseAutoFocus={(e) => {
                if (renameAfterMenu.current !== r.id) return;
                e.preventDefault();
                renameAfterMenu.current = null;
                setEditing(r.id);
              }}
            >
              <ContextMenuItem onSelect={() => (renameAfterMenu.current = r.id)}>Rename</ContextMenuItem>
              <ContextMenuItem onSelect={() => pin(tab.id, r.id)}>
                {r.pinned ? "Don't keep result" : "Keep result"}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => closeResult(tab.id, r.id)}>Close</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
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
        ) : current?.kind === "rows" ? (
          <ResultGrid key={current.id} tabId={tab.id} result={current} />
        ) : current ? (
          <ResultOutcome tab={tab} result={current} />
        ) : (
          <MessagesView tab={tab} />
        )}
      </div>
      <ResultFooter key={tab.id} tab={tab} result={current} />
    </div>
  );
}
