import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { call, onEvent } from "@/lib/bridge";
import type { Cell, OpenResult, RunResult } from "@/lib/types";

// Milestone 0's spike screen: open a SQLite file, run a statement on its
// session, see the first page, cancel a runaway query.

type Status =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: RunResult }
  | { kind: "error"; message: string };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function CellView({ value }: { value: Cell }) {
  if (value === null) return <span className="text-muted-foreground">NULL</span>;
  return <>{String(value)}</>;
}

function StatusLine({ status }: { status: Status }) {
  switch (status.kind) {
    case "idle":
      return <span className="text-muted-foreground">Ready</span>;
    case "running":
      return <span>Running…</span>;
    case "error":
      return <span className="text-destructive">{status.message}</span>;
    case "done": {
      const r = status.result;
      const what =
        r["update-count"] !== null
          ? `${r["update-count"]} rows affected`
          : `${r.rows.length} rows${r["has-more"] ? " (more available)" : ""}`;
      return (
        <span>
          {what} · {r["elapsed-ms"]} ms
        </span>
      );
    }
  }
}

export default function App() {
  const [backend, setBackend] = useState("checking…");
  const [path, setPath] = useState("");
  const [conn, setConn] = useState<OpenResult | null>(null);
  const [sql, setSql] = useState("select 1 as id, 2 as id");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // The menu listeners are registered once, so they read the latest state
  // through refs.
  const connRef = useRef(conn);
  const sqlRef = useRef(sql);
  const queryIdRef = useRef<string | null>(null);
  // Opening and closing are serialized: a second request while one is in
  // flight is ignored, so connections never leak or arrive out of order.
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  useEffect(() => {
    connRef.current = conn;
    sqlRef.current = sql;
  }, [conn, sql]);

  useEffect(() => {
    call<{ ok: boolean }>("ping")
      .then((r) => setBackend(r.ok ? "ok" : "not ok"))
      .catch((e) => setBackend(`unreachable: ${message(e)}`));
  }, []);

  // Close the current database, then open `next` (or nothing), as one
  // serialized change. connRef is updated here as well as in the effect, so
  // the next change sees this one's result without waiting for a render.
  const switchDb = useCallback(async (next: string | null) => {
    if (switchingRef.current || queryIdRef.current) return;
    switchingRef.current = true;
    setSwitching(true);
    try {
      const current = connRef.current;
      if (current) {
        connRef.current = null;
        setConn(null);
        await call("close-db", current["conn-id"]);
      }
      if (next !== null) {
        const opened = await call<OpenResult>("open-db", next);
        connRef.current = opened;
        setConn(opened);
      }
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: message(e) });
    } finally {
      switchingRef.current = false;
      setSwitching(false);
    }
  }, []);

  const openDb = useCallback((p: string) => switchDb(p), [switchDb]);
  const closeDb = useCallback(() => switchDb(null), [switchDb]);

  const runQuery = useCallback(async () => {
    const c = connRef.current;
    if (!c || queryIdRef.current || switchingRef.current) return;
    const queryId = crypto.randomUUID();
    queryIdRef.current = queryId;
    setStatus({ kind: "running" });
    try {
      const result = await call<RunResult>("run", c["conn-id"], queryId, sqlRef.current);
      setStatus({ kind: "done", result });
    } catch (e) {
      setStatus({ kind: "error", message: message(e) });
    } finally {
      queryIdRef.current = null;
    }
  }, []);

  const cancelQuery = useCallback(() => {
    if (queryIdRef.current) void call("cancel", queryIdRef.current);
  }, []);

  useEffect(() => {
    const offRun = onEvent("menu:run", () => void runQuery());
    const offOpen = onEvent("menu:open-db", (data) => {
      const p = (data as { path?: string } | null)?.path;
      if (p) {
        setPath(p);
        void openDb(p);
      }
    });
    return () => {
      offRun();
      offOpen();
    };
  }, [runQuery, openDb]);

  const running = status.kind === "running";
  const result = status.kind === "done" ? status.result : null;

  return (
    <main className="flex h-screen flex-col gap-3 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Quel</h1>
        <span className="text-xs text-muted-foreground">backend: {backend}</span>
      </header>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void openDb(path);
        }}
      >
        <Input
          aria-label="Database path"
          placeholder="/path/to/database.db"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button type="submit" disabled={running || switching}>
          Open
        </Button>
        <Button type="button" variant="outline" disabled={!conn || running || switching} onClick={() => void closeDb()}>
          Close
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        {conn ? `Open: ${conn.path}` : "No database open"}
      </p>

      <Textarea
        aria-label="SQL"
        className="min-h-32 font-mono"
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void runQuery();
          }
        }}
      />

      <div className="flex items-center gap-2">
        <Button disabled={!conn || running || switching} onClick={() => void runQuery()}>
          Run
        </Button>
        <Button variant="outline" disabled={!running} onClick={cancelQuery}>
          Cancel
        </Button>
        <span role="status" className="text-sm">
          <StatusLine status={status} />
        </span>
      </div>

      {result && result.columns.length > 0 && (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {result.columns.map((c, i) => (
                  <TableHead key={i} title={c.type}>
                    {c.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row, i) => (
                <TableRow key={i}>
                  {row.map((cell, j) => (
                    <TableCell key={j} className="font-mono">
                      <CellView value={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
