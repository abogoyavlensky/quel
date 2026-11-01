import { useRef } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  keywordsFilter,
} from "@/components/ui/command";
import { focusEditor } from "@/editor/states";
import { closePalette, restoreFocus } from "@/state/palette";
import { selectProfile } from "@/state/runner";
import { useApp } from "@/state/store";
import { engineLabel } from "./colors";
import { ConnMark } from "./ConnMark";

// ⌘P: the saved connections. Enter selects one, as a click in the sidebar
// does, and puts the cursor in its editor; it never connects (that is a
// command in the Command Palette).
export function GoToConnection() {
  const open = useApp((s) => s.palette === "connections");
  const profiles = useApp((s) => s.profiles);
  const selected = useApp((s) => s.selected);
  const workspaces = useApp((s) => s.workspaces);
  // An entry was picked: the next close is not a dismissal.
  const ran = useRef(false);

  const pick = (id: string) => {
    ran.current = true;
    closePalette();
    // After the close, so the palette no longer counts as an open dialog.
    setTimeout(async () => {
      await selectProfile(id);
      setTimeout(focusEditor);
    });
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) closePalette();
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        if (!ran.current) restoreFocus();
        ran.current = false;
      }}
      title="Go to Connection"
      description="Select a saved connection"
    >
      <Command filter={keywordsFilter}>
        <CommandInput placeholder="Go to connection…" />
        <CommandList>
          <CommandEmpty>{profiles.length === 0 ? "No saved connections." : "No matching connections."}</CommandEmpty>
          {/* A group, as in the Command Palette: its padding insets the highlight. */}
          <CommandGroup>
            {profiles.map((p) => (
              <CommandItem
                key={p.id}
                value={p.id}
                keywords={[p.name, engineLabel[p.engine]]}
                onSelect={() => pick(p.id)}
                className="h-[38px] px-2.5 data-selected:bg-primary/10 [&>svg:last-child]:hidden"
              >
                <ConnMark engine={p.engine} color={p.color} status={workspaces[p.id]?.status ?? "disconnected"} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.id === selected && <span className="shrink-0 text-xs text-muted-foreground">Current</span>}
                <span className="shrink-0 text-xs text-muted-foreground">{engineLabel[p.engine]}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
