import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { focusEditor } from "@/editor/states";
import { onEvent } from "@/lib/bridge";
import { loadProfiles, openProfileDialog, restoreSelection } from "@/state/profiles";
import { flushAll } from "@/state/persist";
import { cancel, closeTab, newTab, reopenTab, runCurrent, selectedTabId } from "@/state/runner";

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
  useFlushOnHide();
  useEffect(() => {
    void loadProfiles().then(restoreSelection);
  }, []);
  return <AppShell />;
}
