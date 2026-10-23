import { useState } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { openProfileDialog } from "@/state/profiles";
import { closeDb, connectProfile, openDb } from "@/state/runner";
import { useApp } from "@/state/store";
import { ConnMark } from "./ConnMark";

const engineLabel = { sqlite: "SQLite", postgres: "PostgreSQL", redshift: "Redshift" } as const;

// The left panel: saved connections (a click connects one), and below
// them a quick open for a file path or postgres:// URL that is not saved.
export function ConnectionsPanel() {
  const conn = useApp((s) => s.conn);
  const switching = useApp((s) => s.switching);
  const error = useApp((s) => s.dbError);
  const profiles = useApp((s) => s.profiles);
  const profilesError = useApp((s) => s.profilesError);
  const [target, setTarget] = useState("");

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
          <p className="text-xs text-muted-foreground">No saved connections.</p>
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

      <form
        className="flex flex-col gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (target.trim()) void openDb(target.trim());
        }}
      >
        <h2 className="text-xs font-medium text-muted-foreground">Quick open</h2>
        <label htmlFor="db-target" className="text-xs text-muted-foreground">
          File path or postgres:// URL
        </label>
        <Input
          id="db-target"
          className="h-8 font-mono text-xs"
          placeholder="/path/to/app.db"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={switching || !target.trim()}>
            Open
          </Button>
          {conn && (
            <Button type="button" size="sm" variant="ghost" disabled={switching} onClick={() => void closeDb()}>
              Close
            </Button>
          )}
        </div>
      </form>

      {error && (
        <p role="alert" className="text-xs break-words text-destructive">
          {error}
        </p>
      )}

      {conn ? (
        <div className="flex items-start gap-2 border-t pt-3">
          <ConnMark engine={conn.engine} color={conn.color} className="mt-1.5" />
          <div className="min-w-0">
            <p className="truncate font-mono text-xs" title={conn.label}>
              {conn.label}
            </p>
            <p className="text-xs text-muted-foreground">{engineLabel[conn.engine]}</p>
          </div>
        </div>
      ) : (
        !error && <p className="border-t pt-3 text-xs text-muted-foreground">No database open.</p>
      )}
    </div>
  );
}
