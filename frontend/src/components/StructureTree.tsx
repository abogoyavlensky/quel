import { useEffect, useMemo, useRef, useState } from "react";
import { useIsFetching, useQueries, useQuery } from "@tanstack/react-query";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRightIcon, DotIcon, EyeIcon, FolderIcon, FolderOpenIcon, LayersIcon, RefreshCwIcon, Table2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import { metaKeys, queryClient } from "@/lib/query";
import type { ColumnInfo, ObjectInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { connectProfile, setTreeExpanded } from "@/state/runner";
import { type Workspace, selectedWorkspace, useApp } from "@/state/store";
import {
  type Loaded,
  type TreeRow,
  initialExpanded,
  isExpandable,
  openObjects,
  openSchemas,
  toggle,
  treeRows,
} from "@/state/tree";

// The selected profile's structure, under the connections: schemas, their
// tables and views, and their columns, each level read when it is first
// opened (TanStack Query caches it per connection until the refresh
// button). The rows are a flat, virtualized list (state/tree.ts) with one
// focused row, walked by the keyboard as an ARIA tree.

const ROW_H = 28;
const INDENT = 14;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function loaded<T>(q: { status: "pending" | "error" | "success"; data?: T; error: unknown }): Loaded<T> {
  if (q.status === "success") return { status: "success", data: q.data as T };
  if (q.status === "error") return { status: "error", message: errorText(q.error) };
  return { status: "pending" };
}

export function StructureTree() {
  const w = useApp(selectedWorkspace);
  const connId = w?.status === "connected" ? w.connId : null;
  const fetching = useIsFetching({ queryKey: metaKeys.all(connId ?? "") }) > 0 && connId !== null;

  return (
    <section aria-labelledby="structure-title" className="flex h-full min-h-0 flex-col text-[13.5px]">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <h2 id="structure-title" className="text-xs font-medium text-muted-foreground">
          Structure
        </h2>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Refresh structure"
          title="Refresh structure"
          disabled={!connId}
          onClick={() => connId && void queryClient.invalidateQueries({ queryKey: metaKeys.all(connId) })}
        >
          <RefreshCwIcon className={cn(fetching && "animate-spin")} />
        </Button>
      </div>
      {!w ? null : connId ? (
        <Tree workspace={w} connId={connId} />
      ) : w.status === "connecting" ? (
        <p className="px-3 py-1 text-xs text-muted-foreground">Connecting…</p>
      ) : (
        <div className="flex flex-col items-start gap-2 px-3 py-1">
          <p className="text-xs text-muted-foreground">Not connected.</p>
          {w.status === "disconnected" && !w.loadError && (
            <Button size="sm" variant="outline" onClick={() => void connectProfile(w.profileId)}>
              Connect
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function Tree({ workspace, connId }: { workspace: Workspace; connId: string }) {
  const { profileId, treeExpanded } = workspace;
  const expanded = useMemo(() => new Set(treeExpanded ?? []), [treeExpanded]);

  const schemas = useQuery({ queryKey: metaKeys.schemas(connId), queryFn: () => api.listSchemas(connId) });

  // The first look at a database opens its default schema.
  useEffect(() => {
    if (schemas.data && treeExpanded === null) setTreeExpanded(profileId, [...initialExpanded(schemas.data)]);
  }, [schemas.data, treeExpanded, profileId]);

  const schemaList = schemas.data ?? [];
  const shown = openSchemas(schemaList, expanded);
  const objectQueries = useQueries({
    queries: shown.map((s) => ({ queryKey: metaKeys.objects(connId, s), queryFn: () => api.listObjects(connId, s) })),
  });
  const objects: Record<string, Loaded<ObjectInfo[]>> = {};
  shown.forEach((s, i) => (objects[s] = loaded(objectQueries[i])));

  // Which objects show their columns follows from the rows without them.
  const open = openObjects(treeRows({ connId, schemas: schemaList, objects, columns: {} }, expanded));
  const columnQueries = useQueries({
    queries: open.map((o) => ({
      queryKey: metaKeys.columns(connId, o.schema, o.name),
      queryFn: () => api.listColumns(connId, o.schema, o.name),
    })),
  });
  const columns: Record<string, Loaded<ColumnInfo[]>> = {};
  open.forEach((o, i) => (columns[o.key] = loaded(columnQueries[i])));

  const rows = treeRows({ connId, schemas: schemaList, objects, columns }, expanded);

  // The focused row. When it goes away (its parent closed, a refresh), the
  // focus falls back to its nearest ancestor still shown, else the first
  // row. parents remembers every row's parent seen so far, for that walk.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const parents = useRef(new Map<string, string | null>());
  for (const r of rows) parents.current.set(r.key, r.parentKey);
  const index = new Map(rows.map((r, i) => [r.key, i]));
  let focusIndex = -1;
  for (let k = focusKey; k !== null && k !== undefined; k = parents.current.get(k) ?? null) {
    const i = index.get(k);
    if (i !== undefined) {
      focusIndex = i;
      break;
    }
  }
  if (focusIndex === -1 && rows.length > 0) focusIndex = 0;
  const focused = focusIndex >= 0 ? rows[focusIndex] : undefined;

  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_H,
    overscan: 10,
    // The focused row stays rendered when scrolled away: it is the tree's
    // one tab stop.
    rangeExtractor: (range) => {
      const shown = defaultRangeExtractor(range);
      return focusIndex < 0 || shown.includes(focusIndex) ? shown : [...shown, focusIndex].sort((a, b) => a - b);
    },
  });

  // A keyboard move scrolls the row into view and focuses it, once it is
  // rendered. Only a move asks for that: a re-render after a refresh or a
  // profile switch must not pull focus into the tree.
  const pendingFocus = useRef(false);
  const [moved, setMoved] = useState(0);
  useEffect(() => {
    if (!pendingFocus.current || focusIndex < 0) return;
    pendingFocus.current = false;
    virtual.scrollToIndex(focusIndex);
    let done = false;
    const id = requestAnimationFrame(() => {
      done = true;
      const el = scroller.current?.querySelector<HTMLElement>(`[data-index="${focusIndex}"]`);
      el?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
      // Re-rendered before the frame: the next run focuses instead.
      if (!done) pendingFocus.current = true;
    };
  }, [moved, focusIndex, virtual]);

  const flip = (row: TreeRow) => setTreeExpanded(profileId, [...toggle(expanded, row)]);
  const moveTo = (i: number) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!r) return;
    setFocusKey(r.key);
    pendingFocus.current = true;
    setMoved((n) => n + 1);
  };
  const activate = (row: TreeRow) => {
    if (isExpandable(row)) flip(row);
    else if (row.kind === "error") void queryClient.refetchQueries({ queryKey: row.retryKey });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!focused) return;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "ArrowDown":
        handled();
        moveTo(focusIndex + 1);
        break;
      case "ArrowUp":
        handled();
        moveTo(focusIndex - 1);
        break;
      case "Home":
        handled();
        moveTo(0);
        break;
      case "End":
        handled();
        moveTo(rows.length - 1);
        break;
      case "ArrowRight":
        handled();
        if (isExpandable(focused) && !focused.expanded) flip(focused);
        else if (isExpandable(focused) && rows[focusIndex + 1]?.parentKey === focused.key) moveTo(focusIndex + 1);
        break;
      case "ArrowLeft":
        handled();
        if (isExpandable(focused) && focused.expanded) flip(focused);
        else if (focused.parentKey !== null && index.has(focused.parentKey)) moveTo(index.get(focused.parentKey)!);
        break;
      case "Enter":
      case " ":
        handled();
        activate(focused);
        break;
    }
  };

  if (schemas.isPending) return <p className="px-3 py-1 text-xs text-muted-foreground">Loading…</p>;
  if (schemas.isError)
    return (
      <div className="flex flex-col items-start gap-2 px-3 py-1">
        <p role="alert" className="text-xs break-words text-destructive">
          {errorText(schemas.error)}
        </p>
        <Button size="sm" variant="outline" onClick={() => void schemas.refetch()}>
          Retry
        </Button>
      </div>
    );
  if (rows.length === 0) return <p className="px-3 py-1 text-xs text-muted-foreground">No schemas.</p>;

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
      <div
        role="tree"
        aria-label="Structure"
        onKeyDown={onKeyDown}
        className="relative w-full"
        style={{ height: virtual.getTotalSize() }}
      >
        {virtual.getVirtualItems().map((item) => {
          const row = rows[item.index];
          const isFocused = item.index === focusIndex;
          return (
            <div
              key={row.key}
              data-index={item.index}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-expanded={isExpandable(row) ? row.expanded : undefined}
              aria-selected={isFocused}
              tabIndex={isFocused ? 0 : -1}
              title={"label" in row ? row.label : undefined}
              onClick={() => {
                setFocusKey(row.key);
                if (isExpandable(row)) flip(row);
              }}
              onFocus={() => setFocusKey(row.key)}
              className={cn(
                "absolute left-0 flex w-full cursor-default items-center gap-1 rounded-sm pr-1.5 outline-none select-none",
                "hover:bg-muted focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring",
              )}
              style={{ top: item.start, height: ROW_H, paddingLeft: 4 + row.depth * INDENT }}
            >
              <RowBody row={row} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RowBody({ row }: { row: TreeRow }) {
  const chevron = (open: boolean) => (
    <ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
  );
  const icon = "size-3.5 shrink-0 text-muted-foreground";
  switch (row.kind) {
    case "schema":
      return (
        <>
          {chevron(row.expanded)}
          {row.expanded ? <FolderOpenIcon className={icon} /> : <FolderIcon className={icon} />}
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
        </>
      );
    case "group":
      return (
        <>
          {chevron(row.expanded)}
          <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
          <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">{row.detail}</span>
        </>
      );
    case "object":
      return (
        <>
          {chevron(row.expanded)}
          {row.objectKind === "table" ? (
            <Table2Icon className={icon} />
          ) : row.objectKind === "view" ? (
            <EyeIcon className={icon} />
          ) : (
            <LayersIcon className={icon} />
          )}
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
        </>
      );
    case "column":
      return (
        <>
          <DotIcon className={icon} />
          <span className="min-w-0 truncate font-mono text-xs">{row.label}</span>
          <span className="ml-auto min-w-0 shrink truncate pl-2 font-mono text-xs text-muted-foreground">{row.detail}</span>
        </>
      );
    case "loading":
      return <span className="pl-4 text-xs text-muted-foreground">Loading…</span>;
    case "empty":
      return <span className="pl-4 text-xs text-muted-foreground">{row.text}</span>;
    case "error":
      return (
        <>
          <span role="alert" className="min-w-0 flex-1 truncate pl-4 text-xs text-destructive" title={row.message}>
            {row.message}
          </span>
          <Button
            size="xs"
            variant="ghost"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              void queryClient.refetchQueries({ queryKey: row.retryKey });
            }}
          >
            Retry
          </Button>
        </>
      );
  }
}
