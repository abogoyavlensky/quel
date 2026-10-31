import type { ExportFormat } from "@/grid/export";
import * as api from "@/lib/api";

// Where an exported file goes. In the app's webview the backend opens the
// native save dialog and writes the file: Wails' macOS webview handles no
// browser downloads. Anywhere else (server mode, a plain browser, e2e) the
// browser downloads it, as Wails' dialogs are not available there.

const MIME: Record<ExportFormat, string> = {
  csv: "text/csv",
  json: "application/json",
  markdown: "text/markdown",
};

interface Webview {
  chrome?: { webview?: { postMessage?: unknown } };
  webkit?: { messageHandlers?: { external?: { postMessage?: unknown } } };
}

// The check @wailsio/runtime makes to pick its transport.
function inAppWebview(): boolean {
  const w = window as Webview;
  return Boolean(w.chrome?.webview?.postMessage || w.webkit?.messageHandlers?.external?.postMessage);
}

function download(filename: string, format: ExportFormat, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${MIME[format]};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Save text as a file: the path it was saved to, "download" when the
// browser took it, or null when the user canceled the dialog. A failed
// write rejects.
export async function saveText(filename: string, format: ExportFormat, text: string): Promise<string | null> {
  if (inAppWebview()) return api.exportResult(format, filename, text);
  download(filename, format, text);
  return "download";
}
