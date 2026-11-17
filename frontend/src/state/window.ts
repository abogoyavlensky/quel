import * as api from "@/lib/api";
import { onEvent } from "@/lib/bridge";

// The window's zoom, the state it is left in and its frame, all saved by
// the backend (quel.window).
//
// The zoom level sits in --zoom on the root element too: the title strip
// divides by it. Steps go one after another: the backend runs bridge calls
// concurrently and a step reads the level and then writes it, so two quick
// steps could otherwise both start from the old level. The restore at
// start goes on the same chain, so it cannot land on top of a step. A
// failure is dropped: the level stays where it was.
let zooming: Promise<void> = Promise.resolve();

function nextOnChain(op: () => Promise<number>): Promise<void> {
  zooming = zooming
    .then(op)
    .then((level) => document.documentElement.style.setProperty("--zoom", String(level)))
    .catch(() => {});
  return zooming;
}

// The saved level, applied at start-up.
export function loadZoom(): Promise<void> {
  return nextOnChain(api.restoreZoom);
}

export function stepZoom(direction: api.ZoomDirection): void {
  void nextOnChain(() => api.zoom(direction));
}

export const WINDOW_STATE_DELAY_MS = 400;

// Fit the saved frame to the screens once the window runs. A failure is
// dropped: the window stays where Wails put it.
export function restoreWindowFrame(): Promise<void> {
  return api.restoreWindowFrame().catch(() => {});
}

// Save the window's state and frame once a resize or a move settles; the
// backend asks the window. A resize covers every way in and out of
// maximised and fullscreen, on every platform. A move fires no resize, so
// Wails' move event counts too (macOS sends it; GTK4 sends none). Returns
// the fn that stops watching.
export function watchWindowState(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void api.saveWindowState().catch(() => {}), WINDOW_STATE_DELAY_MS);
  };
  window.addEventListener("resize", onChange);
  const stopMoves = onEvent("common:WindowDidMove", onChange);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("resize", onChange);
    stopMoves();
  };
}
