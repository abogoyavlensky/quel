import { Browser } from "@wailsio/runtime";

// Open url in the user's browser: the Wails runtime's, which the native
// webview needs, then the page's own (server mode, a plain browser).
export async function openUrl(url: string): Promise<void> {
  try {
    await Browser.OpenURL(url);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
