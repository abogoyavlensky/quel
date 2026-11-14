import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type CommandId, GROUPS, KEYMAP, type KeyEntry, keyLabel } from "@/state/keymap";
import { closeSettings, restoreSettingsFocus } from "@/state/settings";
import { useApp } from "@/state/store";

// Settings: ⌘, or the palette's Settings…. One section for now, Keyboard
// Shortcuts: every command in the registry (state/keymap.ts) with its key,
// read-only until keys can be rebound (docs/backlog/custom-keybindings.md).
// The sections are a list, so a side navigation can come with the second
// one (an editor font size, themes). Focus goes back where it was on
// close (state/settings.ts).

const entries: readonly KeyEntry[] = KEYMAP;

function KeyboardShortcuts() {
  return (
    <section aria-labelledby="settings-keys" className="flex flex-col gap-3">
      <h3 id="settings-keys" className="text-sm font-medium">
        Keyboard Shortcuts
      </h3>
      {GROUPS.map((g) => (
        <div key={g} role="group" aria-label={g} className="flex flex-col">
          <h4 className="pb-1 text-xs font-medium text-muted-foreground">{g}</h4>
          {entries
            .filter((e) => e.group === g)
            .map((e) => {
              const label = keyLabel(e.id as CommandId);
              return (
                <div key={e.id} className="flex items-center justify-between gap-4 border-b py-1.5 last:border-b-0">
                  <span className="min-w-0 truncate">{e.name}</span>
                  {label ? (
                    <kbd className="shrink-0 font-sans text-xs tracking-widest text-muted-foreground">{label}</kbd>
                  ) : (
                    <span aria-label="No shortcut" className="shrink-0 text-xs text-muted-foreground/60">
                      —
                    </span>
                  )}
                </div>
              );
            })}
        </div>
      ))}
    </section>
  );
}

const SECTIONS = [{ id: "keyboard", body: KeyboardShortcuts }];

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeSettings()}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          restoreSettingsFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">Quel's settings and keyboard shortcuts</DialogDescription>
        </DialogHeader>
        <div className="-mx-5 max-h-[70vh] overflow-y-auto px-5">
          {SECTIONS.map(({ id, body: Body }) => (
            <Body key={id} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
