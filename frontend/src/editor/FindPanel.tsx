import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from "@codemirror/search";
import { runScopeHandlers } from "@codemirror/view";
import { ArrowDown, ArrowUp, CaseSensitive, ChevronRight, Regex, Replace, ReplaceAll, WholeWord, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { keyLabelOf } from "@/state/keymap";
import { cn } from "cn";
import type { PanelHost } from "./panels";
import { countLabel, countMatches } from "./searchCount";

// The find and replace controls, drawn into the find panel's dom. The
// query lives in the editor state: the fields show it and every change
// dispatches a new one, so ⌘F seeding it from the selection shows here too.
// rev (from the panel store) re-renders on each change the panel saw.

type Spec = ConstructorParameters<typeof SearchQuery>[0];

const specOf = (q: SearchQuery): Spec => ({
  search: q.search,
  caseSensitive: q.caseSensitive,
  literal: q.literal,
  regexp: q.regexp,
  wholeWord: q.wholeWord,
  replace: q.replace,
});

const fieldClass = "h-7 font-editor text-xs md:text-xs";

export function FindPanel({ host }: { host: PanelHost; rev: number }) {
  const { view } = host;
  const state = view.state;
  const query = getSearchQuery(state);
  const [replaceOpen, setReplaceOpen] = useState(query.replace !== "");
  const findField = useRef<HTMLInputElement>(null);
  const replaceField = useRef<HTMLInputElement>(null);

  const count = useMemo(() => countMatches(state, query), [state, query]);
  const invalid = !query.valid && query.search !== "";

  useLayoutEffect(() => {
    if (host.focus) findField.current?.select();
  }, [host]);

  const change = (patch: Partial<Spec>) =>
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...specOf(query), ...patch })) });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (runScopeHandlers(view, e.nativeEvent, "search-panel")) {
      e.preventDefault();
    } else if (e.key === "Enter" && e.target === findField.current) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(view);
    } else if (e.key === "Enter" && e.target === replaceField.current) {
      e.preventDefault();
      replaceNext(view);
    }
  };

  const option = (on: boolean, label: string, icon: React.ReactNode, patch: Partial<Spec>) => (
    <InputGroupButton
      size="icon-xs"
      aria-label={label}
      title={label}
      aria-pressed={on}
      className={cn(on && "bg-muted text-foreground")}
      onClick={() => change(patch)}
    >
      {icon}
    </InputGroupButton>
  );

  const editable = !state.readOnly;

  return (
    <div className="flex flex-col gap-1 px-2 py-1.5" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-1">
        {editable ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Toggle replace"
            title="Toggle replace"
            aria-expanded={replaceOpen}
            onClick={() => setReplaceOpen((o) => !o)}
          >
            <ChevronRight className={cn("transition-transform", replaceOpen && "rotate-90")} />
          </Button>
        ) : null}
        <InputGroup className="h-7 w-72">
          <InputGroupInput
            ref={findField}
            main-field="true"
            aria-label="Find"
            placeholder="Find"
            aria-invalid={invalid}
            className={fieldClass}
            value={query.search}
            onChange={(e) => change({ search: e.target.value })}
          />
          <InputGroupAddon align="inline-end" className="gap-0.5">
            {option(query.caseSensitive, "Match case", <CaseSensitive />, { caseSensitive: !query.caseSensitive })}
            {option(query.wholeWord, "Match whole word", <WholeWord />, { wholeWord: !query.wholeWord })}
            {option(query.regexp, "Use regular expression", <Regex />, { regexp: !query.regexp })}
          </InputGroupAddon>
        </InputGroup>
        <span className="min-w-20 px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums" aria-live="polite">
          {countLabel(query, count)}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Previous match"
          title={`Previous match (${keyLabelOf("find-previous")})`}
          onClick={() => findPrevious(view)}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Next match"
          title={`Next match (${keyLabelOf("find-next")})`}
          onClick={() => findNext(view)}
        >
          <ArrowDown />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close find"
          title="Close (Esc)"
          onClick={() => closeSearchPanel(view)}
        >
          <X />
        </Button>
      </div>
      {editable && replaceOpen ? (
        <div className="flex items-center gap-1">
          <div className="size-7 shrink-0" />
          <InputGroup className="h-7 w-72">
            <InputGroupInput
              ref={replaceField}
              aria-label="Replace"
              placeholder="Replace"
              className={fieldClass}
              value={query.replace}
              onChange={(e) => change({ replace: e.target.value })}
            />
          </InputGroup>
          <Button variant="ghost" size="icon-xs" aria-label="Replace next" title="Replace (Enter)" onClick={() => replaceNext(view)}>
            <Replace />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Replace all" title="Replace all" onClick={() => replaceAll(view)}>
            <ReplaceAll />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
