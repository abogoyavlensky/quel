import { useEffect, useMemo, useRef, useState } from "react";
import { useIsFetching, useQueries, useQuery } from "@tanstack/react-query";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
  BracesIcon,
  ChevronRightIcon,
  DotIcon,
  EyeIcon,
  FolderIcon,
  FolderOpenIcon,
  HashIcon,
  KeyRoundIcon,
  LayersIcon,
  ListIcon,
  type LucideIcon,
  RefreshCwIcon,
  SearchIcon,
  ShapesIcon,
  SquareFunctionIcon,
  Table2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { modKey } from "@/components/keys";
import * as api from "@/lib/api";
import { completionQuery, metaKeys, queryClient } from "@/lib/query";
import type { ObjectDetails, SchemaContents } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toggleStructure } from "@/state/layout";
import { cancelConnect, connectProfile, setTreeExpanded, setTreeFilter } from "@/state/runner";
import { type Workspace, selectedWorkspace, useApp } from "@/state/store";
import {
  type ItemIcon,
  type Loaded,
  type TreeFilter,
  type TreeRow,
  filterSchemas,
  initialExpanded,
  isExpandable,
  openObjects,
  openSchemas,
  toggle,
  treeRows,
} from "@/state/tree";

// The selected profile's structure, under the connections: schemas, their
// tables, views, functions, types and sequences, and a table's columns,
// indexes, keys and sequences, each level read when it is first opened (TanStack Query caches it per connection until the refresh
// button). The rows are a flat, virtualized list (state/tree.ts) with one
// focused row, walked by the keyboard as an ARIA tree. The input above it
// filters the tables and views by name: completion's cached names pick the
// schemas to load, so typing runs no query.

const ROW_H = 32;
const INDENT = 14;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function loaded<T>(q: { status: "pending" | "error" | "success"; data?: T; error: unknown }): Loaded<T> {
  if (q.status === "success") return { status: "success", data: q.data as T };
  if (q.status === "error") return { status: "error", message: errorText(q.error) };
  return { status: "pending" };
}

// The section's title row: a disclosure button that collapses the section
// to this row (state/layout.ts), and while expanded the refresh button.
// AppShell draws it on its own, under the connections, while collapsed.
export function StructureHeader({ collapsed }: { collapsed: boolean }) {
  const w = useApp(selectedWorkspace);
  const connId = w?.status === "connected" ? w.connId : null;
  const fetching = useIsFetching({ queryKey: metaKeys.all(connId ?? "") }) > 0 && connId !== null;

  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-1 px-1.5 pt-1">
      <h2 id="structure-title" className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
        <button
          type="button"
          data-quel-structure-toggle=""
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : "structure-body"}
          onClick={toggleStructure}
          className="flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform", !collapsed && "rotate-90")} />
          Structure
        </button>
      </h2>
      {!collapsed && (
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
      )}
    </div>
  );
}

export function StructureTree() {
  const w = useApp(selectedWorkspace);
  const connId = w?.status === "connected" ? w.connId : null;

  return (
    <section
      aria-labelledby="structure-title"
      data-quel-structure=""
      className="flex h-full min-h-0 flex-col text-[15px]"
    >
      <StructureHeader collapsed={false} />
      <div id="structure-body" className="flex min-h-0 flex-1 flex-col">
      {!w ? null : connId ? (
        <Tree workspace={w} connId={connId} />
      ) : w.status === "connecting" ? (
        <div className="flex items-center gap-2 px-3 py-1">
          <p className="text-xs text-muted-foreground">Connecting…</p>
          <Button size="xs" variant="ghost" onClick={() => cancelConnect(w.profileId)}>
            Cancel
          </Button>
        </div>
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
      </div>
    </section>
  );
}

function Tree({ workspace, connId }: { workspace: Workspace; connId: string }) {
  const { profileId, treeExpanded, treeFilter } = workspace;
  const expanded = useMemo(() => new Set(treeExpanded ?? []), [treeExpanded]);
  const text = treeFilter.trim();

  const schemas = useQuery({ queryKey: metaKeys.schemas(connId), queryFn: () => api.listSchemas(connId) });
  const completion = useQuery(completionQuery(connId));

  // The first look at a database opens its default schema.
  useEffect(() => {
    if (schemas.data && treeExpanded === null) setTreeExpanded(profileId, [...initialExpanded(schemas.data)]);
  }, [schemas.data, treeExpanded, profileId]);

  // The schema and group rows closed under the filter, for the text they
  // were closed under: a new text starts with everything open.
  const [folds, setFolds] = useState<{ text: string; keys: ReadonlySet<string> }>({ text: "", keys: new Set() });
  const filter: TreeFilter | undefined = text ? { text, closed: folds.text === text ? folds.keys : new Set() } : undefined;

  const schemaList = schemas.data ?? [];
  const shown = filter ? filterSchemas(schemaList, completion.data, text, expanded) : openSchemas(schemaList, expanded);
  const contentQueries = useQueries({
    queries: shown.map((s) => ({ queryKey: metaKeys.schema(connId, s), queryFn: () => api.describeSchema(connId, s) })),
  });
  const contents: Record<string, Loaded<SchemaContents>> = {};
  shown.forEach((s, i) => (contents[s] = loaded(contentQueries[i])));

  // Which objects show their details follows from the rows without them.
  const open = openObjects(treeRows({ connId, schemas: schemaList, contents, details: {} }, expanded, filter));
  const detailQueries = useQueries({
    queries: open.map((o) => ({
      queryKey: metaKeys.object(connId, o.schema, o.name),
      queryFn: () => api.describeObject(connId, o.schema, o.name),
    })),
  });
  const details: Record<string, Loaded<ObjectDetails>> = {};
  open.forEach((o, i) => (details[o.key] = loaded(detailQueries[i])));

  const rows = treeRows({ connId, schemas: schemaList, contents, details }, expanded, filter);
  const filterLoading = !!filter && (completion.isPending || contentQueries.some((q) => q.isPending));

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

  const flip = (row: TreeRow) => {
    if (filter && (row.kind === "schema" || row.kind === "group")) {
      const keys = new Set(filter.closed);
      if (keys.has(row.key)) keys.delete(row.key);
      else keys.add(row.key);
      setFolds({ text, keys });
    } else {
      setTreeExpanded(profileId, [...toggle(expanded, row)]);
    }
  };
  const input = useRef<HTMLInputElement>(null);
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
    // ⌘F: the filter (the registry's "find", caught here).
    if (modKey(e) && !e.shiftKey && e.key.toLowerCase() === "f") {
      handled();
      input.current?.select();
      return;
    }
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
  if (schemaList.length === 0) return <p className="px-3 py-1 text-xs text-muted-foreground">No schemas.</p>;

  const onFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && treeFilter !== "") {
      e.preventDefault();
      e.stopPropagation();
      setTreeFilter(profileId, "");
    } else if (e.key === "ArrowDown" && rows.length > 0) {
      e.preventDefault();
      moveTo(0);
    }
  };

  return (
    <>
      <div className="shrink-0 px-1.5 pb-1">
        <InputGroup className="h-7">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            ref={input}
            aria-label="Filter structure"
            placeholder="Filter tables and views"
            className="text-xs"
            value={treeFilter}
            onChange={(e) => setTreeFilter(profileId, e.target.value)}
            onKeyDown={onFilterKeyDown}
          />
          {treeFilter !== "" && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear filter"
                title="Clear filter"
                onClick={() => {
                  setTreeFilter(profileId, "");
                  input.current?.focus();
                }}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-1 text-xs text-muted-foreground">
          {filterLoading ? "Loading…" : filter ? "No tables or views match." : "No schemas."}
        </p>
      ) : (
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
                  title={"label" in row ? ("detail" in row && row.detail ? `${row.label} ${row.detail}` : row.label) : undefined}
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
                  <RowBody row={row} filterText={text} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// The label with the filter's match marked, when the match is where
// matchAt said (lower-casing can shift it in rare Unicode).
function Marked({ label, at, text }: { label: string; at: number | undefined; text: string }) {
  if (at === undefined || at < 0 || !text || label.slice(at, at + text.length).toLowerCase() !== text.toLowerCase())
    return <>{label}</>;
  return (
    <>
      {label.slice(0, at)}
      <span className="rounded-[2px] bg-(--search-match)">{label.slice(at, at + text.length)}</span>
      {label.slice(at + text.length)}
    </>
  );
}

const ITEM_ICONS: Record<ItemIcon, LucideIcon> = {
  function: SquareFunctionIcon,
  procedure: SquareFunctionIcon,
  domain: ShapesIcon,
  composite: BracesIcon,
  sequence: HashIcon,
  index: ListIcon,
  key: KeyRoundIcon,
  value: DotIcon,
};

function RowBody({ row, filterText }: { row: TreeRow; filterText: string }) {
  const chevron = (open: boolean) => (
    <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
  );
  const icon = "size-4 shrink-0 text-muted-foreground";
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
          <span className="min-w-0 flex-1 truncate">
            <Marked label={row.label} at={row.match} text={filterText} />
          </span>
        </>
      );
    case "column":
      return (
        <>
          <DotIcon className={icon} />
          <span className="min-w-0 truncate font-mono text-xs">{row.label}</span>
          {row.badges.map((b) => (
            <span
              key={b}
              title={b === "PK" ? "Primary key" : "Foreign key"}
              className="shrink-0 rounded-sm border px-1 text-[10px] leading-4 font-semibold text-muted-foreground"
            >
              {b}
            </span>
          ))}
          <span className="ml-auto min-w-0 shrink truncate pl-2 font-mono text-xs text-muted-foreground">{row.detail}</span>
        </>
      );
    case "section":
      return (
        <>
          {chevron(row.expanded)}
          <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
          <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">{row.detail}</span>
        </>
      );
    case "enum":
      return (
        <>
          {chevron(row.expanded)}
          <ShapesIcon className={icon} />
          <span className="min-w-0 flex-1 truncate">{row.label}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">enum</span>
        </>
      );
    case "item": {
      const Icon = ITEM_ICONS[row.icon];
      return (
        <>
          <Icon className={icon} />
          <span className="min-w-0 truncate font-mono text-xs">{row.label}</span>
          {row.detail && (
            // The detail gives way before the name; the row's title has both.
            <span className="ml-auto min-w-0 shrink-[4] truncate pl-2 font-mono text-xs text-muted-foreground">{row.detail}</span>
          )}
        </>
      );
    }
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
