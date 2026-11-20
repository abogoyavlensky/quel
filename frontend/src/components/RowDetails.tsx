import { memo, useEffect, useMemo, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JsonCode } from "@/grid/JsonCode";
import { jsonText, rowAsJson } from "@/grid/json";
import { MarkedText } from "@/grid/Marked";
import { hasMatch, matchRanges } from "@/grid/marks";
import { copyText } from "@/lib/clipboard";
import { notify } from "@/lib/notify";
import type { Cell, Engine } from "@/lib/types";
import { toggleRowDetails } from "@/state/runner";
import { activeTabOf, selectedWorkspace, useApp } from "@/state/store";

// The row details panel: every value of the active result's selected row,
// read-only, one block per column. JSON values are formatted and
// highlighted; each value copies as stored. It follows the selection, the
// result tab, the editor tab and the profile.
//
// The filter keeps a field whose column name or shown value contains the
// text, ignoring case, and highlights the matches inside values. It
// searches what the panel shows: a JSON value as formatted (so
// `"status": "x"` finds {"status":"x"}), anything else as its text. NULL
// never matches.

const COPIED_MS = 1500;

// A copy button whose icon turns into a check for a moment after a copy.
// text is called on click (a row's JSON is built only then); null
// disables the button.
function CopyButton({
  label,
  text,
  icon = <Copy />,
  className,
}: {
  label: string;
  text: (() => string) | null;
  icon?: React.ReactNode;
  className?: string;
}) {
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
    if (await copyText(text())) setCopied(true);
    else notify.error("Could not copy.");
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
      {copied ? <Check /> : icon}
    </Button>
  );
}

const NO_RANGES: ReadonlyArray<[number, number]> = [];

// What the panel shows for a value: formatted JSON, or the value as text;
// null for NULL. json says which.
interface Shown {
  text: string | null;
  json: boolean;
}

function shownOf(cell: Cell, type: string, engine: Engine | null): Shown {
  if (cell === null) return { text: null, json: false };
  const json = jsonText(cell, type, engine);
  return json !== null ? { text: json, json: true } : { text: String(cell), json: false };
}

const Field = memo(function Field({
  name,
  type,
  cell,
  shown,
  ranges,
}: {
  name: string;
  type: string;
  cell: Cell;
  shown: Shown;
  ranges: ReadonlyArray<[number, number]>;
}) {
  return (
    <div role="group" aria-label={name} className="group border-b border-border/50 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-xs font-medium">{name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{type.toLowerCase()}</span>
        {/* Hidden in a wrapper: the button's own disabled style sets its
            opacity, which would show it on NULL. */}
        <span className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton label={`Copy ${name}`} text={cell === null ? null : () => String(cell)} />
        </span>
      </div>
      <div className="mt-0.5 font-mono text-xs">
        {shown.text === null ? (
          <span className="text-muted-foreground/70 italic">NULL</span>
        ) : shown.json ? (
          <JsonCode text={shown.text} ranges={ranges} />
        ) : (
          <span className="block break-words whitespace-pre-wrap">
            <MarkedText text={shown.text} ranges={ranges} />
          </span>
        )}
      </div>
    </div>
  );
});

export function RowDetails() {
  const result = useApp((s) => {
    const w = selectedWorkspace(s);
    const tab = w && activeTabOf(w);
    const shown = tab?.results.find((r) => r.id === tab.active);
    return shown?.kind === "rows" ? shown : undefined;
  });
  const engine = useApp((s) => s.profiles.find((p) => p.id === s.selected)?.engine ?? null);
  const [filter, setFilter] = useState("");

  const index = result?.selectedRow ?? null;
  const row = result && index !== null ? result.rows[index] : undefined;
  const needle = filter.trim();
  const columns = result?.columns;
  // Worked out once per row: the filter and the fields read the same text.
  const shown = useMemo(
    () => (row && columns ? columns.map((c, i) => shownOf(row[i], c.type, engine)) : []),
    [row, columns, engine],
  );
  const fields =
    result && row
      ? result.columns.flatMap((c, i) => {
          const text = shown[i]?.text ?? null;
          const valueHit = needle !== "" && text !== null && hasMatch(text, needle);
          if (needle !== "" && !valueHit && !hasMatch(c.name, needle)) return [];
          const ranges = valueHit && text !== null ? matchRanges(text, needle) : NO_RANGES;
          return [<Field key={i} name={c.name} type={c.type} cell={row[i]} shown={shown[i]} ranges={ranges} />];
        })
      : [];

  return (
    <aside aria-label="Row details" className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-3">
        <span className="flex-1 truncate text-xs text-muted-foreground tabular-nums">
          {result && row ? `Row ${(index! + 1).toLocaleString()} of ${result.rows.length.toLocaleString()}` : "Row details"}
        </span>
        {result && row ? (
          <CopyButton label="Copy row as JSON" text={() => rowAsJson(result.columns, row)} />
        ) : null}
        <Button variant="ghost" size="icon-xs" aria-label="Close row details" title="Close" onClick={toggleRowDetails}>
          <X />
        </Button>
      </div>
      {result && row ? (
        <>
          <div className="shrink-0 border-b p-2">
            <Input
              aria-label="Filter columns and values"
              placeholder="Filter columns and values"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-7 text-xs md:text-xs"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {fields.length > 0 ? (
              fields
            ) : (
              <p className="p-4 text-sm text-muted-foreground">No columns or values match.</p>
            )}
          </div>
        </>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">Select a row to see its values.</p>
      )}
    </aside>
  );
}
