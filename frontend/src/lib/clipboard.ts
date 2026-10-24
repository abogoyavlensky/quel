import { Clipboard } from "@wailsio/runtime";

// Put text on the clipboard: the browser's API first (server mode and the
// browser have it), then the Wails runtime's, which the native webview may
// need. False when neither worked.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      await Clipboard.SetText(text);
      return true;
    } catch {
      return false;
    }
  }
}
