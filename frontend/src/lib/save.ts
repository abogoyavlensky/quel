import { type ExportChunk, type ExportFormat, collectChunks } from "@/grid/export";
import * as api from "@/lib/api";

// Where an exported file goes. In the app's webview the backend opens the
// native save dialog and writes the file a chunk at a time: Wails' macOS
// webview handles no browser downloads, and caps a call at 64 MiB. Anywhere
// else (server mode, a plain browser, e2e) the browser downloads it, as Wails'
// dialogs are not available there.

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

function download(filename: string, format: ExportFormat, texts: string[]): void {
  const url = URL.createObjectURL(new Blob(texts, { type: `${MIME[format]};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Through the backend: a canceled dialog reads no chunks. On a cancel or a
// failure the export is dropped, leaving the chosen file as it was, and the
// first error is the one that surfaces.
async function saveToBackend(
  filename: string,
  format: ExportFormat,
  chunks: Iterable<ExportChunk>,
  onRows: (rows: number) => void,
  signal: AbortSignal,
): Promise<string | null> {
  const id = await api.exportBegin(format, filename);
  if (id === null) return null;
  const drop = () => api.exportAbort(id).catch(() => {});
  onRows(0);
  try {
    for (const chunk of chunks) {
      if (signal.aborted) break;
      await api.exportAppend(id, chunk.text);
      onRows(chunk.rows);
    }
    if (!signal.aborted) return await api.exportFinish(id);
  } catch (e) {
    await drop();
    throw e;
  }
  await drop();
  return null;
}

// Save chunks as a file, reporting the rows written once the file is chosen:
// the path it was saved to, "download" when the browser took it, or null when
// the user canceled the dialog or the signal did. A failed write rejects.
export async function saveChunks(
  filename: string,
  format: ExportFormat,
  chunks: Iterable<ExportChunk>,
  onRows: (rows: number) => void,
  signal: AbortSignal,
): Promise<string | null> {
  if (inAppWebview()) return saveToBackend(filename, format, chunks, onRows, signal);
  const texts = await collectChunks(chunks, onRows, signal);
  if (signal.aborted) return null;
  download(filename, format, texts);
  return "download";
}
