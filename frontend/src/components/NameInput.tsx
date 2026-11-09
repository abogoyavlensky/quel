import { useEffect, useRef } from "react";

// A tab's name, editable in place: Enter or leaving commits, Escape
// cancels. What a blank name means is the caller's (onCommit gets the text
// as typed). Clicks and keys stay here, so they never reach the tab.
export function NameInput({
  value,
  label,
  placeholder,
  onCommit,
  onDone,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onCommit: (name: string) => void;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && input.current) onCommit(input.current.value);
    onDone();
  };
  return (
    <input
      ref={input}
      aria-label={label}
      defaultValue={value}
      placeholder={placeholder}
      size={Math.min(40, Math.max(6, (value || placeholder || "").length))}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      className="h-5 rounded-sm border bg-background px-1 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}
