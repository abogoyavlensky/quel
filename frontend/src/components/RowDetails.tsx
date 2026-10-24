import { memo, useEffect, useState } from "react";
import { Braces, Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JsonCode } from "@/grid/JsonCode";
import { jsonText, rowAsJson } from "@/grid/json";
import { copyText } from "@/lib/clipboard";
import type { Cell, Engine } from "@/lib/types";
import { toggleRowDetails } from "@/state/runner";
import { MESSAGES, activeTabOf, selectedWorkspace, store, useApp } from "@/state/store";

// The row details panel: every value of the active result's selected row,
// read-only, one block per column. JSON values are formatted and
// highlighted; each value copies as stored. It follows the selection, the
// result tab, the editor tab and the profile.

const COPIED_MS = 1500;

// A copy button whose icon turns into a check for a moment after a copy.
function CopyButton({ label, text, className }: { label: string; text: string | null; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => {
      clearTimeout(id);
    };
  }, [copied]);
  const onClick = async () => {
    if (text === null) return;
    if (await copyText(text)) setCopied(true);
    else store.setState({ notice: "Could not copy." });
  };
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      disabled={text === null}
      onClick={() => void onClick()}
      className={className}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}

const Field = memo(function Field({
  name,
  type,
  cell,
  engine,
}: {
  name: string;
  type: string;
  cell: Cell;
  engine: Engine | null;
}) {
  const json = jsonText(cell, type, engine);
  return (
    <div role="group" aria-label={name} className="group border-b border-border/50 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-xs font-medium">{name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{type.toLowerCase()}</span>
        {/* Hidden in a wrapper: the button's own disabled style sets its
            opacity, which would show it on NULL. */}
        <span className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton label={`Copy ${name}`} text={cell === null ? null : String(cell)} />
        </span>
      </div>
      <div className="mt-0.5 font-mono text-xs">
        {json !== null ? (
          <JsonCode text={json} />
        ) : cell === null ? (
          <span className="text-muted-foreground/70 italic">NULL</span>
        ) : (
          <span className="block break-words whitespace-pre-wrap">{String(cell)}</span>
        )}
      </div>
    </div>
  );
});

export function RowDetails() {
  const result = useApp((s) => {
    const w = selectedWorkspace(s);
    const tab = w && activeTabOf(w);
    return tab && tab.active !== MESSAGES ? tab.results.find((r) => r.id === tab.active) : undefined;
  });
  const engine = useApp((s) => s.profiles.find((p) => p.id === s.selected)?.engine ?? null);
  const [filter, setFilter] = useState("");

  const index = result?.selectedRow ?? null;
  const row = result && index !== null ? result.rows[index] : undefined;
  const needle = filter.trim().toLowerCase();

  return (
    <aside aria-label="Row details" className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-3">
        <span className="flex-1 truncate text-xs text-muted-foreground tabular-nums">
          {result && row ? `Row ${(index! + 1).toLocaleString()} of ${result.rows.length.toLocaleString()}` : "Row details"}
        </span>
        {result && row ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Copy row as JSON"
            title="Copy row as JSON"
            onClick={() =>
              void copyText(rowAsJson(result.columns, row)).then(
                (ok) => ok || store.setState({ notice: "Could not copy." }),
              )
            }
          >
            <Braces />
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-xs" aria-label="Close row details" title="Close" onClick={toggleRowDetails}>
          <X />
        </Button>
      </div>
      {result && row ? (
        <>
          <div className="shrink-0 border-b p-2">
            <Input
              aria-label="Filter columns"
              placeholder="Filter columns"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-7 text-xs md:text-xs"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {result.columns.map((c, i) =>
              needle === "" || c.name.toLowerCase().includes(needle) ? (
                <Field key={i} name={c.name} type={c.type} cell={row[i]} engine={engine} />
              ) : null,
            )}
          </div>
        </>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">Select a row to see its values.</p>
      )}
    </aside>
  );
}
