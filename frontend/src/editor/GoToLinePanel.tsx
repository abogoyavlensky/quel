import { useLayoutEffect, useRef, useState } from "react";
import { runScopeHandlers } from "@codemirror/view";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { goToLineTarget } from "./goToLine";
import { type PanelHost, closeGoToLine, goToLine } from "./panels";

// The Go to Line controls, drawn into its panel's dom. The field starts at
// the cursor's line, selected. Enter on a target that does not parse marks
// the field and keeps the panel open.

export function GoToLinePanel({ host }: { host: PanelHost; rev: number }) {
  const { view } = host;
  const [text, setText] = useState(() => String(view.state.doc.lineAt(view.state.selection.main.head).number));
  const [invalid, setInvalid] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (host.focus) field.current?.select();
  }, [host]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const pos = goToLineTarget(view.state, text);
      if (pos === null) setInvalid(true);
      else goToLine(view, pos);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeGoToLine(view);
    } else if (runScopeHandlers(view, e.nativeEvent, "goto-panel")) {
      e.preventDefault();
    }
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1.5" onKeyDown={onKeyDown}>
      <label htmlFor="quel-goto-line" className="text-xs text-muted-foreground">
        Go to line
      </label>
      <Input
        id="quel-goto-line"
        ref={field}
        main-field="true"
        aria-invalid={invalid}
        className="h-7 w-28 font-editor text-xs md:text-xs"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
      />
      <span className="text-xs text-muted-foreground">Line, +n, -n, n%, line:col</span>
      <div className="flex-1" />
      <Button variant="ghost" size="icon-xs" aria-label="Close go to line" title="Close (Esc)" onClick={() => closeGoToLine(view)}>
        <X />
      </Button>
    </div>
  );
}
