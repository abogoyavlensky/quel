// Shortcut labels as the platform writes them.
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const RUN_KEY = isMac ? "⌘↵" : "Ctrl+Enter";
export const SCRIPT_KEY = isMac ? "⇧⌘↵" : "Ctrl+Shift+Enter";
