import { useEffect, useRef, useState } from "react";
import { HistoryIcon, PanelRight, Pin, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ClosedTab } from "@/lib/types";
import { cn } from "@/lib/utils";
import { closeTab, newTab, renameTab, reopenTab, selectTab, togglePin, toggleRowDetails } from "@/state/runner";
import { type EditorTab, type Workspace, useApp } from "@/state/store";
import { ROW_KEY } from "./keys";

// The selected workspace's editor tabs. Each is its own database session:
// SET, temp tables and an open transaction stay in the tab they were made in.
// Double-click a tab to rename it; right-click for Rename, Pin and Close. A
// pinned tab comes first and shows a pin in place of its close button (the
// pin unpins). The history button at the end reopens recently closed tabs.
export function EditorTabs({ workspace }: { workspace: Workspace }) {
  const { tabs, activeTab: active, closed } = workspace;
  const [editing, setEditing] = useState<string | null>(null);
  // Rename chosen in a tab's menu: the input appears once the menu has
  // closed and let go of focus, or it would not keep it.
  const renameAfterMenu = useRef<string | null>(null);

  return (
    <div
      role="tablist"
      aria-label="Editor tabs"
      className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border/60 bg-background px-2"
    >
      {/* The tabs sit in a track; the active one is a raised pill. */}
      <div className="flex min-w-0 gap-0.5 rounded-[10px] bg-muted p-[3px]">
        {tabs.map((t) => (
          <ContextMenu key={t.id}>
            <ContextMenuTrigger asChild>
              <div
                role="tab"
                aria-selected={t.id === active}
                tabIndex={0}
                onClick={() => selectTab(t.id)}
                onDoubleClick={() => setEditing(t.id)}
                onKeyDown={(e) =>
                  e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && selectTab(t.id)
                }
                onAuxClick={(e) => e.button === 1 && void closeTab(t.id)}
                className={cn(
                  "group flex h-8 min-w-0 cursor-default items-center gap-1.5 rounded-[7px] pr-1.5 pl-3 text-[15px] select-none",
                  t.id === active
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.runningQueryId && (
                  <span aria-label="running" className="size-1.5 animate-pulse rounded-full bg-foreground/70" />
                )}
                {editing === t.id ? (
                  <TitleInput tab={t} onDone={() => setEditing(null)} />
                ) : (
                  <span className="max-w-48 min-w-0 truncate">{t.title}</span>
                )}
                {t.pinned ? (
                  <button
                    type="button"
                    aria-label={`Unpin ${t.title}`}
                    title="Pinned: click to unpin"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(t.id);
                    }}
                    className="rounded p-0.5 hover:bg-foreground/10"
                  >
                    <Pin className="size-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={`Close ${t.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void closeTab(t.id);
                    }}
                    className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-foreground/10 focus-visible:opacity-100 group-aria-selected:opacity-60"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent
              onCloseAutoFocus={(e) => {
                if (renameAfterMenu.current !== t.id) return;
                e.preventDefault();
                renameAfterMenu.current = null;
                setEditing(t.id);
              }}
            >
              <ContextMenuItem onSelect={() => (renameAfterMenu.current = t.id)}>Rename</ContextMenuItem>
              <ContextMenuItem onSelect={() => togglePin(t.id)}>{t.pinned ? "Unpin" : "Pin"}</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={t.pinned} onSelect={() => void closeTab(t.id)}>
                Close
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="New tab" onClick={newTab}>
        <Plus />
      </Button>
      <div className="flex-1" />
      <ClosedTabsMenu closed={closed} />
      <RowDetailsToggle />
    </div>
  );
}

// The tab's name, editable: Enter or leaving commits, Escape cancels, and
// a blank name keeps the old one.
function TitleInput({ tab, onDone }: { tab: EditorTab; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && input.current) renameTab(tab.id, input.current.value);
    onDone();
  };
  return (
    <input
      ref={input}
      aria-label="Tab name"
      defaultValue={tab.title}
      size={Math.max(6, tab.title.length)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      className="h-5 rounded-sm border bg-background px-1 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}

function ago(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString();
}

function firstLine(body: string): string {
  return (
    body
      .split("\n")
      .find((l) => l.trim() !== "")
      ?.trim() ?? ""
  );
}

// Opens and closes the row details panel on the right.
function RowDetailsToggle() {
  const open = useApp((s) => s.rowDetails);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Row details"
      aria-pressed={open}
      title={`Row details (${ROW_KEY})`}
      onClick={toggleRowDetails}
      className={cn(open && "bg-muted text-foreground")}
    >
      <PanelRight />
    </Button>
  );
}

// Recently closed tabs, newest first: a click opens one again.
function ClosedTabsMenu({ closed }: { closed: ClosedTab[] }) {
  // "5 min ago" counts from when the menu opened.
  const [now, setNow] = useState(0);
  return (
    <DropdownMenu onOpenChange={(open) => open && setNow(Date.now())}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Recently closed tabs" title="Recently closed tabs">
          <HistoryIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Recently closed</DropdownMenuLabel>
        {closed.length === 0 ? (
          <DropdownMenuItem disabled>No closed tabs</DropdownMenuItem>
        ) : (
          closed.map((c) => (
            <DropdownMenuItem key={c.id} onSelect={() => void reopenTab(c.id)} className="flex-col items-start gap-0.5">
              <span className="flex w-full items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{ago(c["closed-at"], now)}</span>
              </span>
              <span className="w-full truncate font-mono text-xs text-muted-foreground">{firstLine(c.body)}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
