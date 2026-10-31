import { useRef } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  keywordsFilter,
} from "@/components/ui/command";
import { type Command as Cmd, commands } from "@/state/commands";
import { closePalette, restoreFocus } from "@/state/palette";
import { useApp } from "@/state/store";

// ⇧⌘P: what can run now (state/commands.ts), grouped. Enter runs the
// highlighted entry.
export function CommandPalette() {
  const open = useApp((s) => s.palette === "commands");
  // The list depends on much of the state; useApp(commands) would be a new
  // array on every change.
  const state = useApp((s) => s);
  // An entry was picked: the next close is not a dismissal, and the action
  // decides where focus goes.
  const ran = useRef(false);

  const list = open ? commands(state) : [];
  const groups = [...new Set(list.map((c) => c.group))];

  const pick = (c: Cmd) => {
    // Only switches the palette: no close, no focus handling.
    if (c.id === "go-to-connection") {
      void c.run();
      return;
    }
    ran.current = true;
    closePalette();
    // After the close, so the palette no longer counts as an open dialog
    // (the profile dialog would refuse to open under it).
    setTimeout(() => void c.run());
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
      title="Command Palette"
      description="Search for a command to run"
    >
      <Command filter={keywordsFilter}>
        <CommandInput placeholder="Type a command…" />
        <CommandList>
          <CommandEmpty>No matching commands.</CommandEmpty>
          {groups.map((g) => (
            <CommandGroup key={g} heading={g}>
              {list
                .filter((c) => c.group === g)
                .map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    keywords={[c.title]}
                    onSelect={() => pick(c)}
                    className="data-selected:bg-primary/10"
                  >
                    {c.title}
                    {c.keys && <CommandShortcut>{c.keys}</CommandShortcut>}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
