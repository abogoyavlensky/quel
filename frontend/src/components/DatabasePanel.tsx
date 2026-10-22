import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { closeDb, openDb } from "@/state/runner";
import { useApp } from "@/state/store";
import { EngineMark } from "./EngineMark";

// Which database is open. One at a time for now: a file path or a
// postgres:// URL. Saved connection profiles replace this form later.
export function DatabasePanel() {
  const conn = useApp((s) => s.conn);
  const switching = useApp((s) => s.switching);
  const error = useApp((s) => s.dbError);
  const [target, setTarget] = useState("");

  return (
    <div className="flex h-full flex-col gap-3 p-3 text-sm">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (target.trim()) void openDb(target.trim());
        }}
      >
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
          <EngineMark engine={conn.engine} className="mt-1.5" />
          <div className="min-w-0">
            <p className="truncate font-mono text-xs" title={conn.label}>
              {conn.label}
            </p>
            <p className="text-xs text-muted-foreground">{conn.engine}</p>
          </div>
        </div>
      ) : (
        !error && <p className="border-t pt-3 text-xs text-muted-foreground">No database open.</p>
      )}
    </div>
  );
}
