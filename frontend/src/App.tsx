import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { focusEditor } from "@/editor/states";
import { onEvent } from "@/lib/bridge";
import { loadProfiles, openProfileDialog, restoreSelection } from "@/state/profiles";
import { flushAll } from "@/state/persist";
import { loadSidebar, loadStructure } from "@/state/layout";
import { openPalette } from "@/state/palette";
import { onPageKey } from "@/state/pageKeys";
import { loadZoom, stepZoom, watchWindowState } from "@/state/window";
import { checkForUpdates, startUpdateChecks } from "@/state/updates";
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
      onEvent("menu:new-connection", () => openProfileDialog({ mode: "new" })),
      onEvent("menu:check-updates", () => void checkForUpdates({ manual: true })),
      onEvent("menu:command-palette", () => openPalette("commands")),
      onEvent("menu:go-to-connection", () => openPalette("connections")),
      onEvent("menu:zoom-in", () => stepZoom("in")),
      onEvent("menu:zoom-out", () => stepZoom("out")),
      onEvent("menu:zoom-reset", () => stepZoom("reset")),
    ];
    return () => offs.forEach((off) => off());
  }, []);
}

// The keys the page catches (state/keymap.ts, "page"), in the capture
// phase so the editor never sees them. What each does, and why some are
// the page's alone, is in state/pageKeys.ts.
function useKeys() {
  useEffect(() => {
    window.addEventListener("keydown", onPageKey, true);
    return () => {
      window.removeEventListener("keydown", onPageKey, true);
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
  useKeys();
  useFlushOnHide();
  useEffect(() => {
    void loadProfiles().then(restoreSelection);
    void loadSidebar();
    void loadStructure();
    void loadZoom();
  }, []);
  useEffect(() => {
    return watchWindowState();
  }, []);
  // New versions: 10 s after start, then every 6 hours.
  useEffect(() => {
    return startUpdateChecks();
  }, []);
  return (
    <>
      <AppShell />
      <Toaster />
    </>
  );
}
