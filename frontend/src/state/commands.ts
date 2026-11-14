import { focusEditor } from "@/editor/states";
import { sidebarShown, toggleResults, toggleSidebar } from "./layout";
import { focusResult, openPalette } from "./palette";
import { openProfileDialog } from "./profiles";
import {
  cancel,
  cancelConnect,
  closeTab,
  connectProfile,
  disconnectProfile,
  newTab,
  reopenTab,
  runCurrent,
  toggleRowDetails,
} from "./runner";
import { type AppState, activeTabOf, selectedWorkspace, showsResult } from "./store";
import { type CommandId, keyLabel } from "./keymap";
import { checkForUpdates } from "./updates";
import { stepZoom } from "./window";

// The Command Palette's entries: what can run now, as a hand-written list.
// It repeats some native menu items on purpose: both call the same runner
// functions, so the two can only drift on titles and key labels.
export interface Command {
  id: CommandId; // stable, also the cmdk value
  group: "Tabs" | "Query" | "Connection" | "View" | "Help";
  title: string;
  keys?: string; // the registry's label (state/keymap.ts), filled in by commands()
  // The action leaves focus alone, so the palette gives it back to where it
  // was. The others move it themselves (the editor, a dialog).
  keepsFocus?: boolean;
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
  const add = (c: Omit<Command, "keys"> | false) => {
    if (c) list.push({ ...c, keys: keyLabel(c.id) });
  };

  add(
    loaded && {
      id: "new-tab",
      group: "Tabs",
      title: "New Tab",
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
        keepsFocus: true,
        group: "Tabs",
        title: "Close Tab",
        run: () => closeTab(tab!.id),
      },
  );
  add(
    loaded &&
      w.closed.length > 0 && {
        id: "reopen-tab",
        keepsFocus: true,
        group: "Tabs",
        title: "Reopen Closed Tab",
        run: () => reopenTab(),
      },
  );
  add(
    loaded && {
      id: "focus-editor",
      group: "Tabs",
      title: "Focus Editor",
      run: () => void setTimeout(focusEditor),
    },
  );
  add(
    loaded &&
      showsResult(s) && {
        id: "focus-result",
        group: "Tabs",
        title: "Focus Result",
        run: () => void setTimeout(focusResult),
      },
  );

  add(
    loaded &&
      !running && {
        id: "run",
        keepsFocus: true,
        group: "Query",
        title: "Run",
        run: () => runCurrent("statement"),
      },
  );
  add(
    loaded &&
      !running && {
        id: "run-script",
        keepsFocus: true,
        group: "Query",
        title: "Run Script",
        run: () => runCurrent("script"),
      },
  );
  add(
    running && {
      id: "cancel",
      keepsFocus: true,
      group: "Query",
      title: "Cancel",
      run: () => cancel(tab!.id),
    },
  );

  add(
    selected !== null &&
      w?.status === "disconnected" && {
        id: "connect",
        keepsFocus: true,
        group: "Connection",
        title: "Connect",
        run: () => connectProfile(selected),
      },
  );
  add(
    selected !== null &&
      w?.status === "connecting" && {
        id: "cancel-connect",
        keepsFocus: true,
        group: "Connection",
        title: "Cancel Connecting",
        run: () => cancelConnect(selected),
      },
  );
  add(
    selected !== null &&
      w?.status === "connected" && {
        id: "disconnect",
        keepsFocus: true,
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
    id: "row-details",
    keepsFocus: true,
    group: "View",
    title: s.rowDetails ? "Hide Row Details" : "Show Row Details",
    run: toggleRowDetails,
  });
  add(
    loaded && {
      id: "sidebar",
      keepsFocus: true,
      group: "View",
      title: sidebarShown(s) ? "Hide Sidebar" : "Show Sidebar",
      run: toggleSidebar,
    },
  );
  add(
    loaded && {
      id: "results",
      keepsFocus: true,
      group: "View",
      title: s.resultsHidden ? "Show Results" : "Hide Results",
      run: toggleResults,
    },
  );
  add({
    id: "zoom-in",
    keepsFocus: true,
    group: "View",
    title: "Zoom In",
    run: () => stepZoom("in"),
  });
  add({
    id: "zoom-out",
    keepsFocus: true,
    group: "View",
    title: "Zoom Out",
    run: () => stepZoom("out"),
  });
  add({
    id: "zoom-reset",
    keepsFocus: true,
    group: "View",
    title: "Actual Size",
    run: () => stepZoom("reset"),
  });

  add({
    id: "check-updates",
    group: "Help",
    title: "Check for Updates…",
    run: () => checkForUpdates({ manual: true }),
  });

  return list;
}
