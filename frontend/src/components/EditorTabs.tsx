import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { closeTab, newTab, selectTab } from "@/state/runner";
import { useApp } from "@/state/store";

// The editor tabs. Each is its own database session: SET, temp tables and
// an open transaction stay in the tab they were made in.
export function EditorTabs() {
  const tabs = useApp((s) => s.tabs);
  const active = useApp((s) => s.activeTab);

  return (
    <div role="tablist" aria-label="Editor tabs" className="flex h-9 shrink-0 items-end gap-px border-b bg-muted/30 px-1">
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          tabIndex={0}
          onClick={() => selectTab(t.id)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && selectTab(t.id)}
          onAuxClick={(e) => e.button === 1 && void closeTab(t.id)}
          className={cn(
            "group flex h-8 cursor-default items-center gap-1.5 rounded-t-md border border-b-0 border-transparent pr-1 pl-3 text-xs select-none",
            t.id === active ? "border-border bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.runningQueryId && <span aria-label="running" className="size-1.5 animate-pulse rounded-full bg-foreground/70" />}
          <span>{t.title}</span>
          <button
            type="button"
            aria-label={`Close ${t.title}`}
            onClick={(e) => {
              e.stopPropagation();
              void closeTab(t.id);
            }}
            className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100 group-aria-selected:opacity-60"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      <Button variant="ghost" size="icon-xs" aria-label="New tab" className="mb-1 ml-1" onClick={newTab}>
        <Plus />
      </Button>
    </div>
  );
}
