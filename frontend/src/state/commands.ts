import {
  CLOSE_TAB_KEY,
  FOCUS_KEY,
  GOTO_KEY,
  NEW_TAB_KEY,
  OPEN_DB_KEY,
  REOPEN_KEY,
  ROW_KEY,
  RUN_KEY,
  SCRIPT_KEY,
  STOP_KEY,
} from "@/components/keys";
import { focusEditor } from "@/editor/states";
import { chooseFile } from "@/lib/api";
import { openPalette } from "./palette";
import { openProfileDialog } from "./profiles";
import {
  cancel,
  closeTab,
  connectProfile,
  disconnectProfile,
  newTab,
  reopenTab,
  runCurrent,
  toggleRowDetails,
} from "./runner";
import { type AppState, activeTabOf, selectedWorkspace } from "./store";
import { checkForUpdates } from "./updates";

// The Command Palette's entries: what can run now, as a hand-written list.
// It repeats some native menu items on purpose: both call the same runner
// functions, so the two can only drift on titles and key labels.
export interface Command {
  id: string; // stable, also the cmdk value
  group: "Tabs" | "Query" | "Connection" | "View" | "Help";
  title: string;
  keys?: string; // a label from components/keys.ts
  run: () => void | Promise<void>;
}

// Entries show only when they can run; nothing is greyed out. In table
// order, which is the order the palette shows its groups.
export function commands(s: AppState): Command[] {
  const w = selectedWorkspace(s);
  const loaded = w !== undefined && !w.loadError;
  const tab = loaded ? activeTabOf(w) : undefined;
  const running = tab !== undefined && tab.runningQueryId !== null;
  const selected = s.selected;
  const list: Command[] = [];
  const add = (c: Command | false) => {
    if (c) list.push(c);
  };

  add(
    loaded && {
      id: "new-tab",
      group: "Tabs",
      title: "New Tab",
      keys: NEW_TAB_KEY,
      run: () => {
        newTab();
        setTimeout(focusEditor);
      },
    },
  );
  add(
    loaded &&
      !tab!.pinned && {
        id: "close-tab",
        group: "Tabs",
        title: "Close Tab",
        keys: CLOSE_TAB_KEY,
        run: () => closeTab(tab!.id),
      },
  );
  add(
    loaded &&
      w.closed.length > 0 && {
        id: "reopen-tab",
        group: "Tabs",
        title: "Reopen Closed Tab",
        keys: REOPEN_KEY,
        run: () => reopenTab(),
      },
  );
  add(
    loaded && {
      id: "focus-editor",
      group: "Tabs",
      title: "Focus Editor",
      keys: FOCUS_KEY,
      run: () => void setTimeout(focusEditor),
    },
  );

  add(
    loaded &&
      !running && {
        id: "run",
        group: "Query",
        title: "Run",
        keys: RUN_KEY,
        run: () => runCurrent("statement"),
      },
  );
  add(
    loaded &&
      !running && {
        id: "run-script",
        group: "Query",
        title: "Run Script",
        keys: SCRIPT_KEY,
        run: () => runCurrent("script"),
      },
  );
  add(
    running && {
      id: "cancel",
      group: "Query",
      title: "Cancel",
      keys: STOP_KEY,
      run: () => cancel(tab!.id),
    },
  );

  add(
    selected !== null &&
      w?.status === "disconnected" && {
        id: "connect",
        group: "Connection",
        title: "Connect",
        run: () => connectProfile(selected),
      },
  );
  add(
    selected !== null &&
      w?.status === "connected" && {
        id: "disconnect",
        group: "Connection",
        title: "Disconnect",
        run: () => disconnectProfile(selected),
      },
  );
  add(
    s.profiles.length > 0 && {
      id: "go-to-connection",
      group: "Connection",
      title: "Go to Connection…",
      keys: GOTO_KEY,
      run: () => openPalette("connections"),
    },
  );
  add({
    id: "new-connection",
    group: "Connection",
    title: "New Connection…",
    run: () => openProfileDialog({ mode: "new" }),
  });
  add(
    selected !== null && {
      id: "edit-connection",
      group: "Connection",
      title: "Edit Connection…",
      run: () => openProfileDialog({ mode: "edit", id: selected }),
    },
  );
  add({
    id: "open-database",
    group: "Connection",
    title: "Open Database…",
    keys: OPEN_DB_KEY,
    run: async () => {
      // A chosen file becomes a new SQLite profile, filled in for Save.
      const path = await chooseFile();
      if (path) openProfileDialog({ mode: "new", path });
    },
  });

  add({
    id: "row-details",
    group: "View",
    title: s.rowDetails ? "Hide Row Details" : "Show Row Details",
    keys: ROW_KEY,
    run: toggleRowDetails,
  });

  add({
    id: "check-updates",
    group: "Help",
    title: "Check for Updates…",
    run: () => checkForUpdates({ manual: true }),
  });

  return list;
}
