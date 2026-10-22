import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { focusEditor } from "@/editor/states";
import { onEvent } from "@/lib/bridge";
import { cancel, closeTab, newTab, openDb, runCurrent } from "@/state/runner";
import { store } from "@/state/store";

// The app's menu items (quel.menu) arrive as events; the work happens here.
function useMenu() {
  useEffect(() => {
    const active = () => store.getState().activeTab;
    const offs = [
      onEvent("menu:new-tab", () => {
        newTab();
        setTimeout(focusEditor);
      }),
      onEvent("menu:close-tab", () => void closeTab(active())),
      onEvent("menu:run", () => void runCurrent("statement")),
      onEvent("menu:run-script", () => void runCurrent("script")),
      onEvent("menu:cancel", () => cancel(active())),
      onEvent("menu:open-db", (data) => {
        const path = (data as { path?: string } | null)?.path;
        if (path) void openDb(path);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);
}

export default function App() {
  useMenu();
  return <AppShell />;
}
