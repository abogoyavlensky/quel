import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import type { ResultTab } from "@/state/store";
import { fetchMore, openRowDetails, selectRow } from "@/state/runner";
import { display, isNumericType } from "./format";
import { initialWidths, numberWidth } from "./widths";

// A result as a grid: rows and columns both virtualized, so a 100,000-row
// result or a 300-column table renders only what is on screen. Absolutely
// positioned divs rather than a <table>: the header sticks to the top, the
// row numbers to the left. Scrolling near the end loads the next page.
// A click selects a row (the result keeps it, for the row details panel),
// ↑/↓ move the selection while the grid has focus, and a double-click
// also opens the panel.

const ROW_H = 32;
const HEAD_H = 46;
const MIN_COL = 40;
const LOAD_AHEAD = 50; // rows from the end at which the next page loads

function footer(r: ResultTab): string {
  const n = r.rows.length.toLocaleString();
  switch (r.cursor) {
    case "done":
      return `${n} ${r.rows.length === 1 ? "row" : "rows"}`;
    case "open":
      return r.fetching ? `${n} rows loaded, loading more…` : `${n} rows loaded, more available`;
    case "closed":
      return `Showing ${n} rows: run again for more`;
    case "capped":
      return `Showing the first ${n} rows`;
  }
}

export function ResultGrid({ tabId, result }: { tabId: string; result: ResultTab }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState(() => initialWidths(result.columns, result.rows));
  const numeric = result.columns.map((c) => isNumericType(c.type));

  const rows = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_H,
    overscan: 20,
  });
  const cols = useVirtualizer({
    horizontal: true,
    count: result.columns.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => widths[i],
    overscan: 4,
  });
  useEffect(() => {
    cols.measure();
  }, [widths, cols]);

  const items = rows.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? -1;
  useEffect(() => {
    if (result.cursor === "open" && !result.fetching && lastIndex >= result.rows.length - LOAD_AHEAD) {
      void fetchMore(tabId, result.id);
    }
  }, [lastIndex, result.cursor, result.fetching, result.rows.length, result.id, tabId]);

  const startResize = (i: number, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = widths[i];
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      setWidths((ws) => ws.map((w, j) => (j === i ? Math.max(MIN_COL, w0 + ev.clientX - x0) : w)));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const last = result.rows.length - 1;
    const cur = result.selectedRow;
    if (last < 0 || (cur === null && e.key === "ArrowUp")) return;
    const next = cur === null ? 0 : Math.max(0, Math.min(last, cur + (e.key === "ArrowDown" ? 1 : -1)));
    selectRow(tabId, result.id, next);
    // Rows have a fixed height and sit under the sticky header, which the
    // virtualizer's scrollToIndex does not know about: scroll by hand.
    const el = e.currentTarget;
    const top = HEAD_H + next * ROW_H;
    if (top < el.scrollTop + HEAD_H) el.scrollTop = top - HEAD_H;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  };

  const colItems = cols.getVirtualItems();
  const numW = numberWidth(result.rows.length, result.cursor === "open");
  const width = numW + cols.getTotalSize();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        role="grid"
        aria-label="Result"
        aria-rowcount={result.rows.length + 1}
        aria-colcount={result.columns.length}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative min-h-0 flex-1 overflow-auto font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div style={{ width, height: HEAD_H + rows.getTotalSize() }} className="relative">
          {/* Header: sticks to the top; its corner sticks to the left too. */}
          <div role="row" className="sticky top-0 z-20 border-b bg-background" style={{ width, height: HEAD_H }}>
            <div className="sticky left-0 z-10 h-full border-r bg-background" style={{ width: numW }} />
            {colItems.map((c) => {
              const col = result.columns[c.index];
              return (
                <div
                  key={c.key}
                  role="columnheader"
                  title={`${col.name} ${col.type}`}
                  className={cn(
                    "absolute top-0 flex h-full flex-col justify-center border-r px-2.5",
                    numeric[c.index] && "items-end text-right",
                  )}
                  style={{ left: numW + c.start, width: c.size }}
                >
                  <span className="w-full truncate font-sans text-[14px] font-medium text-foreground">{col.name}</span>
                  <span className="w-full truncate text-[12px] text-muted-foreground">{col.type.toLowerCase()}</span>
                  <div
                    aria-hidden
                    onPointerDown={(e) => startResize(c.index, e)}
                    className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize hover:bg-ring/40"
                  />
                </div>
              );
            })}
          </div>

          {items.map((r) => {
            const row = result.rows[r.index];
            const selected = r.index === result.selectedRow;
            // Every other row is banded, its number cell too.
            const alt = r.index % 2 === 1;
            return (
              <div
                key={r.key}
                role="row"
                aria-rowindex={r.index + 2}
                aria-selected={selected}
                onClick={() => selectRow(tabId, result.id, r.index)}
                // A double-click selects the row, not a word in it.
                onMouseDown={(e) => {
                  if (e.detail > 1) e.preventDefault();
                }}
                onDoubleClick={() => {
                  selectRow(tabId, result.id, r.index);
                  openRowDetails();
                }}
                className={cn(
                  "absolute left-0",
                  selected ? "bg-primary/10" : alt ? "bg-row-alt hover:bg-muted/60" : "hover:bg-muted/40",
                )}
                style={{ top: HEAD_H + r.start, height: ROW_H, width }}
              >
                {/* Opaque, so cells scrolled under it stay hidden; the
                    selection tints it on top. */}
                <div
                  className={cn(
                    "sticky left-0 z-10 flex h-full items-center justify-end border-r px-2 text-muted-foreground tabular-nums",
                    selected
                      ? "bg-[color-mix(in_oklab,var(--primary)_10%,var(--background))]"
                      : alt
                        ? "bg-row-alt"
                        : "bg-background",
                  )}
                  style={{ width: numW }}
                >
                  {r.index + 1}
                </div>
                {colItems.map((c) => {
                  const cell = row[c.index];
                  const { text, kind } = display(cell);
                  return (
                    <div
                      key={c.key}
                      role="gridcell"
                      title={typeof cell === "string" && cell.length > 40 ? cell.slice(0, 2000) : undefined}
                      className={cn(
                        "absolute top-0 h-full truncate border-r border-border/50 px-2.5 leading-[32px]",
                        (kind === "number" || numeric[c.index]) && "text-right tabular-nums",
                        kind === "null" && "text-muted-foreground/70 italic",
                        kind === "bool" && "text-muted-foreground",
                      )}
                      style={{ left: numW + c.start, width: c.size }}
                    >
                      {text}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between border-t px-3.5 text-xs text-muted-foreground">
        <span aria-live="polite">{footer(result)}</span>
        <span className="tabular-nums">{result.elapsedMs.toLocaleString()} ms</span>
      </div>
    </div>
  );
}
