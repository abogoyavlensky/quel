import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { focusEditor } from "@/editor/states";
import { onEvent } from "@/lib/bridge";
import { loadProfiles, openProfileDialog, restoreSelection } from "@/state/profiles";
import { flushAll } from "@/state/persist";
import { isMac } from "@/components/keys";
import { cancel, closeTab, newTab, reopenTab, runCurrent, selectedTabId, toggleRowDetails } from "@/state/runner";

// The app's menu items (quel.menu) arrive as events; the work happens here,
// on the selected profile's workspace (nothing, when none is selected).
function useMenu() {
  useEffect(() => {
    const active = (f: (tabId: string) => void) => () => {
      const id = selectedTabId();
      if (id) f(id);
    };
    const offs = [
      onEvent("menu:new-tab", () => {
        newTab();
        setTimeout(focusEditor);
      }),
      onEvent("menu:close-tab", active((id) => void closeTab(id))),
      onEvent("menu:reopen-tab", () => void reopenTab()),
      onEvent("menu:run", () => void runCurrent("statement")),
      onEvent("menu:run-script", () => void runCurrent("script")),
      onEvent("menu:cancel", active(cancel)),
      onEvent("menu:open-db", (data) => {
        const path = (data as { path?: string } | null)?.path;
        // A chosen file becomes a new SQLite profile, filled in for Save.
        if (path) openProfileDialog({ mode: "new", path });
      }),
      onEvent("menu:new-connection", () => openProfileDialog({ mode: "new" })),
    ];
    return () => offs.forEach((off) => off());
  }, []);
}

// ⌘I / Ctrl+I opens and closes the row details panel. Not a native menu
// item: a toggle cannot take the double delivery Run tolerates (menu plus
// page), and CodeMirror binds Mod-i itself. Caught in the capture phase,
// before the editor sees it.
function useRowDetailsKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.shiftKey || e.altKey || e.key.toLowerCase() !== "i") return;
      e.preventDefault();
      e.stopPropagation();
      toggleRowDetails();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
}

// ⌘. / Ctrl+. stops the running statement. The native Query menu has it
// too, so with the app window it may arrive twice; that is harmless:
// cancel only marks the tab as stopping and asks the backend again, and a
// failed ask is swallowed. Server mode has no native menu, so there the
// key comes from here alone.
function useStopKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.shiftKey || e.altKey || e.key !== ".") return;
      e.preventDefault();
      e.stopPropagation();
      const id = selectedTabId();
      if (id) cancel(id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
}

// Pending tab saves go out now when the window hides or the page goes
// away: the app is likely quitting.
function useFlushOnHide() {
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushAll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushAll);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushAll);
    };
  }, []);
}

export default function App() {
  useMenu();
  useRowDetailsKey();
  useStopKey();
  useFlushOnHide();
  useEffect(() => {
    void loadProfiles().then(restoreSelection);
  }, []);
  return <AppShell />;
}
