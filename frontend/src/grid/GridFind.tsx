import { ArrowDown, ArrowUp, CaseSensitive, Regex, WholeWord, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { FIND_NEXT_KEY, FIND_PREV_KEY, modKey } from "@/components/keys";
import { cn } from "@/lib/utils";
import type { GridFind as Find } from "@/state/store";

// The find bar over a result's grid: the editor's Find panel without
// replace. The query lives on the result (state/runner.ts setFind); the
// grid counts and moves between matches.

type Patch = Partial<Omit<Find, "open" | "current">>;

const fieldClass = "h-7 font-editor text-xs md:text-xs";

export function GridFind({
  find,
  count,
  invalid,
  fieldRef,
  onChange,
  onStep,
  onClose,
}: {
  find: Find;
  count: string;
  invalid: boolean;
  fieldRef: React.RefObject<HTMLInputElement | null>;
  onChange: (patch: Patch) => void;
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const key = e.key.toLowerCase();
    if (e.key === "Enter" && !modKey(e)) onStep(e.shiftKey ? -1 : 1);
    else if (e.key === "Escape") onClose();
    else if (modKey(e) && key === "g") onStep(e.shiftKey ? -1 : 1);
    else if (modKey(e) && !e.shiftKey && key === "f") e.currentTarget.select();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const option = (on: boolean, label: string, icon: React.ReactNode, patch: Patch) => (
    <InputGroupButton
      size="icon-xs"
      aria-label={label}
      title={label}
      aria-pressed={on}
      className={cn(on && "bg-muted text-foreground")}
      onClick={() => onChange(patch)}
    >
      {icon}
    </InputGroupButton>
  );

  return (
    <div
      role="search"
      aria-label="Find in result"
      className="flex shrink-0 items-center gap-1 border-b bg-background px-2 py-1.5"
    >
      <InputGroup className="h-7 w-72">
        <InputGroupInput
          ref={fieldRef}
          aria-label="Find in result"
          placeholder="Find"
          aria-invalid={invalid}
          className={fieldClass}
          value={find.search}
          onChange={(e) => onChange({ search: e.target.value })}
          onKeyDown={onKeyDown}
        />
        <InputGroupAddon align="inline-end" className="gap-0.5">
          {option(find.caseSensitive, "Match case", <CaseSensitive />, { caseSensitive: !find.caseSensitive })}
          {option(find.wholeWord, "Match whole word", <WholeWord />, { wholeWord: !find.wholeWord })}
          {option(find.regexp, "Use regular expression", <Regex />, { regexp: !find.regexp })}
        </InputGroupAddon>
      </InputGroup>
      <span className="min-w-20 px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums" aria-live="polite">
        {count}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Previous match"
        title={`Previous match (${FIND_PREV_KEY})`}
        onClick={() => onStep(-1)}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Next match"
        title={`Next match (${FIND_NEXT_KEY})`}
        onClick={() => onStep(1)}
      >
        <ArrowDown />
      </Button>
      <div className="flex-1" />
      <Button variant="ghost" size="icon-xs" aria-label="Close find" title="Close (Esc)" onClick={onClose}>
        <X />
      </Button>
    </div>
  );
}
