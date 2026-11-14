import { formatKey, isMac, matchesKey } from "@/components/keys";

// Every command and its keys, in one list: the Settings dialog shows it,
// the Command Palette (state/commands.ts) and the page's key listener
// (state/pageKeys.ts) attach what a command does by its id, and tooltips
// take their labels from it. Data only: leaf components (the find bars)
// read labels from here, and importing the runner would put them in
// import cycles.
//
// Keys are written per platform, with the modifier that platform uses:
// `mac` with Cmd (⌘), `other` with Ctrl. Both lists are written out in
// full, so a platform can differ where it should, and a rebinding only
// ever changes the current platform's list. Bindings are as
// components/keys.ts parses them ("Cmd-Shift-p").
//
// Where a key is caught:
//   "page"  - the page's one capture-phase listener (App.tsx useKeys),
//             which runs the action in state/pageKeys.ts;
//   "menu"  - the native menu's accelerator (src/quel/menu.lg). Those
//             accelerators mirror the "menu" keys here; keymap.test.ts
//             checks that both sides have the same set;
//   "local" - CodeMirror or a component's own onKeyDown; the registry
//             only labels it.
// A key caught in two places (Cancel: menu and page) arrives twice in the
// app window. That is only safe for an action that can run twice; see
// docs/DESIGN.md, Palettes and keys.

export type Group = "Tabs" | "Query" | "Connection" | "View" | "Find" | "Help";
export type Catcher = "page" | "menu" | "local";

export interface KeyEntry {
  readonly id: string;
  readonly group: Group;
  // The Settings list's name; the palette may word it by state.
  readonly name: string;
  // The first key is the one a label shows.
  readonly keys: { readonly mac: readonly string[]; readonly other: readonly string[] };
  // The keys form a run (⌘1–⌘8), labelled first–last.
  readonly range?: boolean;
  // Empty when there are no keys.
  readonly caught: readonly Catcher[];
}

const none = { mac: [], other: [] } as const;

export const GROUPS: readonly Group[] = ["Tabs", "Query", "Connection", "View", "Find", "Help"];

export const KEYMAP = [
  { id: "new-tab", group: "Tabs", name: "New Tab", keys: { mac: ["Cmd-t"], other: ["Ctrl-t"] }, caught: ["menu"] },
  { id: "close-tab", group: "Tabs", name: "Close Tab", keys: { mac: ["Cmd-w"], other: ["Ctrl-w"] }, caught: ["menu"] },
  {
    id: "reopen-tab",
    group: "Tabs",
    name: "Reopen Closed Tab",
    keys: { mac: ["Cmd-Shift-t"], other: ["Ctrl-Shift-t"] },
    caught: ["menu"],
  },
  {
    id: "go-to-tab",
    group: "Tabs",
    name: "Go to Tab 1–8",
    keys: {
      mac: ["Cmd-1", "Cmd-2", "Cmd-3", "Cmd-4", "Cmd-5", "Cmd-6", "Cmd-7", "Cmd-8"],
      other: ["Ctrl-1", "Ctrl-2", "Ctrl-3", "Ctrl-4", "Ctrl-5", "Ctrl-6", "Ctrl-7", "Ctrl-8"],
    },
    range: true,
    caught: ["page"],
  },
  { id: "last-tab", group: "Tabs", name: "Go to Last Tab", keys: { mac: ["Cmd-9"], other: ["Ctrl-9"] }, caught: ["page"] },
  {
    id: "previous-tab",
    group: "Tabs",
    name: "Previous Tab",
    keys: { mac: ["Cmd-PageUp"], other: ["Ctrl-PageUp"] },
    caught: ["page"],
  },
  {
    id: "next-tab",
    group: "Tabs",
    name: "Next Tab",
    keys: { mac: ["Cmd-PageDown"], other: ["Ctrl-PageDown"] },
    caught: ["page"],
  },
  { id: "focus-editor", group: "Tabs", name: "Focus Editor", keys: { mac: ["Cmd-e"], other: ["Ctrl-e"] }, caught: ["page"] },
  { id: "focus-result", group: "Tabs", name: "Focus Result", keys: { mac: ["Cmd-r"], other: ["Ctrl-r"] }, caught: ["page"] },

  { id: "run", group: "Query", name: "Run", keys: { mac: ["Cmd-Enter"], other: ["Ctrl-Enter"] }, caught: ["menu", "local"] },
  {
    id: "run-script",
    group: "Query",
    name: "Run Script",
    keys: { mac: ["Cmd-Shift-Enter"], other: ["Ctrl-Shift-Enter"] },
    caught: ["menu", "local"],
  },
  { id: "cancel", group: "Query", name: "Cancel", keys: { mac: ["Cmd-."], other: ["Ctrl-."] }, caught: ["menu", "page"] },

  {
    id: "go-to-connection",
    group: "Connection",
    name: "Go to Connection…",
    keys: { mac: ["Cmd-p"], other: ["Ctrl-p"] },
    caught: ["menu", "page"],
  },
  { id: "connect", group: "Connection", name: "Connect", keys: none, caught: [] },
  { id: "cancel-connect", group: "Connection", name: "Cancel Connecting", keys: none, caught: [] },
  { id: "disconnect", group: "Connection", name: "Disconnect", keys: none, caught: [] },
  { id: "new-connection", group: "Connection", name: "New Connection…", keys: none, caught: [] },
  { id: "edit-connection", group: "Connection", name: "Edit Connection…", keys: none, caught: [] },

  {
    id: "command-palette",
    group: "View",
    name: "Command Palette…",
    keys: { mac: ["Cmd-Shift-p"], other: ["Ctrl-Shift-p"] },
    caught: ["menu", "page"],
  },
  { id: "settings", group: "View", name: "Settings…", keys: { mac: ["Cmd-,"], other: ["Ctrl-,"] }, caught: ["page"] },
  {
    id: "row-details",
    group: "View",
    name: "Toggle Row Details",
    keys: { mac: ["Cmd-i"], other: ["Ctrl-i"] },
    caught: ["page"],
  },
  { id: "sidebar", group: "View", name: "Toggle Sidebar", keys: { mac: ["Cmd-b"], other: ["Ctrl-b"] }, caught: ["page"] },
  { id: "results", group: "View", name: "Toggle Results", keys: { mac: ["Cmd-j"], other: ["Ctrl-j"] }, caught: ["page"] },
  { id: "zoom-in", group: "View", name: "Zoom In", keys: { mac: ["Cmd-="], other: ["Ctrl-="] }, caught: ["menu"] },
  { id: "zoom-out", group: "View", name: "Zoom Out", keys: { mac: ["Cmd--"], other: ["Ctrl--"] }, caught: ["menu"] },
  { id: "zoom-reset", group: "View", name: "Actual Size", keys: { mac: ["Cmd-0"], other: ["Ctrl-0"] }, caught: ["menu"] },

  // F3 and Shift-F3 are the editor's (editor/panels.ts); the grid's find
  // takes only ⌘G and ⇧⌘G.
  { id: "find", group: "Find", name: "Find", keys: { mac: ["Cmd-f"], other: ["Ctrl-f"] }, caught: ["local"] },
  {
    id: "find-next",
    group: "Find",
    name: "Find Next",
    keys: { mac: ["Cmd-g", "F3"], other: ["Ctrl-g", "F3"] },
    caught: ["local"],
  },
  {
    id: "find-previous",
    group: "Find",
    name: "Find Previous",
    keys: { mac: ["Cmd-Shift-g", "Shift-F3"], other: ["Ctrl-Shift-g", "Shift-F3"] },
    caught: ["local"],
  },
  {
    id: "go-to-line",
    group: "Find",
    name: "Go to Line…",
    keys: { mac: ["Cmd-Alt-g"], other: ["Ctrl-Alt-g"] },
    caught: ["local"],
  },

  { id: "check-updates", group: "Help", name: "Check for Updates…", keys: none, caught: [] },
] as const satisfies readonly KeyEntry[];

export type CommandId = (typeof KEYMAP)[number]["id"];

const entries: readonly KeyEntry[] = KEYMAP;
const byId = new Map(entries.map((e) => [e.id, e]));

export function entryOf(id: CommandId): KeyEntry {
  return byId.get(id)!;
}

// The entry's keys on this platform.
export function keysOf(entry: KeyEntry, mac: boolean = isMac): readonly string[] {
  return mac ? entry.keys.mac : entry.keys.other;
}

// What an entry's keys show as: its first key, or first–last for a run;
// undefined without keys.
export function keyLabel(id: CommandId, mac: boolean = isMac): string | undefined {
  const entry = entryOf(id);
  const keys = keysOf(entry, mac);
  if (keys.length === 0) return undefined;
  const first = formatKey(keys[0], mac);
  return entry.range ? `${first}–${formatKey(keys[keys.length - 1], mac)}` : first;
}

// The label of an entry that has keys, for the tooltips and hints that
// name one: those ids always have keys, so a missing one is a bug here.
export function keyLabelOf(id: CommandId): string {
  const label = keyLabel(id);
  if (label === undefined) throw new Error(`${id} has no keys`);
  return label;
}

// The page-caught entry a keydown is, and which of its keys: ⌘3 is
// { id: "go-to-tab", index: 2 }. Null for any other key, including keys
// the native menu or the editor catch.
export function keyFor(
  e: Parameters<typeof matchesKey>[0],
  mac: boolean = isMac,
): { id: CommandId; index: number } | null {
  for (const entry of entries) {
    if (!entry.caught.includes("page")) continue;
    const index = keysOf(entry, mac).findIndex((k) => matchesKey(e, k));
    if (index >= 0) return { id: entry.id as CommandId, index };
  }
  return null;
}
