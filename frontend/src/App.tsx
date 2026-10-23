import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { focusEditor } from "@/editor/states";
import { onEvent } from "@/lib/bridge";
import { loadProfiles, openProfileDialog, restoreSelection } from "@/state/profiles";
import { cancel, closeTab, newTab, runCurrent, selectedTabId } from "@/state/runner";

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

export default function App() {
  useMenu();
  useEffect(() => {
    void loadProfiles().then(restoreSelection);
  }, []);
  return <AppShell />;
}
