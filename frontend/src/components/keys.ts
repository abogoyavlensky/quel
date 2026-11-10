// Shortcut labels as the platform writes them.
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// The app's modifier held (⌘ on macOS, Ctrl elsewhere), without Alt; Shift may be.
export const modKey = (e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey">) =>
  (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey;
export const RUN_KEY = isMac ? "⌘↵" : "Ctrl+Enter";
export const ROW_KEY = isMac ? "⌘I" : "Ctrl+I";
export const SCRIPT_KEY = isMac ? "⇧⌘↵" : "Ctrl+Shift+Enter";
export const STOP_KEY = isMac ? "⌘." : "Ctrl+.";
export const NEW_TAB_KEY = isMac ? "⌘T" : "Ctrl+T";
export const CLOSE_TAB_KEY = isMac ? "⌘W" : "Ctrl+W";
export const REOPEN_KEY = isMac ? "⇧⌘T" : "Ctrl+Shift+T";
export const PALETTE_KEY = isMac ? "⇧⌘P" : "Ctrl+Shift+P";
export const GOTO_KEY = isMac ? "⌘P" : "Ctrl+P";
export const FOCUS_KEY = isMac ? "⌘E" : "Ctrl+E";
export const RESULT_KEY = isMac ? "⌘R" : "Ctrl+R";
export const SIDEBAR_KEY = isMac ? "⌘B" : "Ctrl+B";
export const RESULTS_PANE_KEY = isMac ? "⌘J" : "Ctrl+J";
export const ZOOM_IN_KEY = isMac ? "⌘=" : "Ctrl+=";
export const ZOOM_OUT_KEY = isMac ? "⌘-" : "Ctrl+-";
export const ZOOM_RESET_KEY = isMac ? "⌘0" : "Ctrl+0";
export const FIND_KEY = isMac ? "⌘F" : "Ctrl+F";
export const FIND_NEXT_KEY = isMac ? "⌘G" : "Ctrl+G";
export const FIND_PREV_KEY = isMac ? "⇧⌘G" : "Ctrl+Shift+G";
export const GO_TO_LINE_KEY = isMac ? "⌥⌘G" : "Ctrl+Alt+G";
