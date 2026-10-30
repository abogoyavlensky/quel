import { PencilIcon, PlugIcon, PlusIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { openProfileDialog } from "@/state/profiles";
import { connectProfile, disconnectProfile, selectProfile } from "@/state/runner";
import { type ConnStatus, useApp } from "@/state/store";
import { engineLabel } from "./colors";
import { ConnMark } from "./ConnMark";

const statusLabel: Record<ConnStatus, string> = {
  connected: "Connected",
  disconnected: "Not connected",
  connecting: "Connecting…",
  disconnecting: "Disconnecting…",
};

// The left panel: the saved connections. A click selects one and shows its
// workspace; each connects (a plug) and disconnects (a stop) on its
// own button, always shown, and several can be connected at once. The
// pencil shows on hover; right-click a row for Connect or Disconnect,
// Edit and Delete. New ones come from the + button, or from
// File > Open Database for a SQLite file.
export function ConnectionsPanel() {
  const selected = useApp((s) => s.selected);
  const workspaces = useApp((s) => s.workspaces);
  const profiles = useApp((s) => s.profiles);
  const profilesError = useApp((s) => s.profilesError);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
      <section aria-labelledby="connections-title" className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h2 id="connections-title" className="text-xs font-medium text-muted-foreground">
            Connections
          </h2>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="New connection"
            title="New connection"
            onClick={() => openProfileDialog({ mode: "new" })}
          >
            <PlusIcon />
          </Button>
        </div>
        {profiles.length === 0 ? (
          <div className="flex flex-col items-start gap-2 py-2">
            <p className="text-xs text-muted-foreground">No saved connections.</p>
            <Button size="sm" variant="outline" onClick={() => openProfileDialog({ mode: "new" })}>
              New connection…
            </Button>
          </div>
        ) : (
          <ul aria-label="Saved connections" className="-mx-1 flex flex-col">
            {profiles.map((p) => {
              const w = workspaces[p.id];
              const status = w?.status ?? "disconnected";
              const pending = status === "connecting" || status === "disconnecting";
              const plugged = status === "connected" || status === "disconnecting";
              return (
                <li key={p.id} className="group flex flex-col">
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      {/* The highlight covers the whole row, its buttons too. */}
                      <div
                        className={cn(
                          "flex h-[38px] items-center gap-0.5 rounded-md pr-1 hover:bg-muted",
                          selected === p.id && "bg-primary/10 font-medium hover:bg-primary/15",
                        )}
                      >
                        <button
                          type="button"
                          aria-current={selected === p.id ? "true" : undefined}
                          title={statusLabel[status]}
                          onClick={() => void selectProfile(p.id)}
                          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        >
                          <ConnMark engine={p.engine} color={p.color} status={status} />
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{engineLabel[p.engine]}</span>
                        </button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`${plugged ? "Disconnect" : "Connect"} ${p.name}`}
                          title={plugged ? "Disconnect" : "Connect"}
                          disabled={pending}
                          className={cn(pending && "animate-pulse")}
                          onClick={() => void (plugged ? disconnectProfile(p.id) : connectProfile(p.id))}
                        >
                          {plugged ? (
                            <SquareIcon className="size-3.5 fill-current text-muted-foreground" />
                          ) : (
                            <PlugIcon className="text-muted-foreground" />
                          )}
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Edit ${p.name}`}
                          title={`Edit ${p.name}`}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => openProfileDialog({ mode: "edit", id: p.id })}
                        >
                          <PencilIcon />
                        </Button>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        disabled={pending}
                        onSelect={() => void (plugged ? disconnectProfile(p.id) : connectProfile(p.id))}
                      >
                        {plugged ? "Disconnect" : "Connect"}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => openProfileDialog({ mode: "edit", id: p.id })}>
                        Edit…
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        disabled={pending}
                        onSelect={() => openProfileDialog({ mode: "edit", id: p.id, confirmDelete: true })}
                      >
                        Delete…
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                  {w?.error && (
                    <p role="alert" className="px-1.5 pb-1 text-xs break-words text-destructive">
                      {w.error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {profilesError && (
          <p role="alert" className="text-xs break-words text-destructive">
            {profilesError}
          </p>
        )}
      </section>
    </div>
  );
}
