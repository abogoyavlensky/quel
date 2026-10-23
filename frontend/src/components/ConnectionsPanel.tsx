import { PencilIcon, PlusIcon, UnplugIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openProfileDialog } from "@/state/profiles";
import { closeDb, connectProfile } from "@/state/runner";
import { useApp } from "@/state/store";
import { ConnMark } from "./ConnMark";

const engineLabel = { sqlite: "SQLite", postgres: "PostgreSQL", redshift: "Redshift" } as const;

// The left panel: the saved connections. A click connects one; the
// connected one can be disconnected, any one edited. New ones come from
// the + button, or from File > Open Database for a SQLite file.
export function ConnectionsPanel() {
  const conn = useApp((s) => s.conn);
  const switching = useApp((s) => s.switching);
  const error = useApp((s) => s.dbError);
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
              const connected = conn?.profileId === p.id;
              return (
                <li key={p.id} className="group flex items-center">
                  <button
                    type="button"
                    disabled={switching}
                    aria-current={connected ? "true" : undefined}
                    title={connected ? `${p.name} (connected)` : `Connect ${p.name}`}
                    onClick={() => void connectProfile(p.id)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted",
                      connected && "bg-muted font-medium",
                    )}
                  >
                    <ConnMark engine={p.engine} color={p.color} />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{engineLabel[p.engine]}</span>
                  </button>
                  {connected && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Disconnect ${p.name}`}
                      title="Disconnect"
                      disabled={switching}
                      onClick={() => void closeDb()}
                    >
                      <UnplugIcon />
                    </Button>
                  )}
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

      {error && (
        <p role="alert" className="border-t pt-3 text-xs break-words text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
