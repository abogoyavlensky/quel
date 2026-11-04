import * as api from "@/lib/api";

// The window's zoom and the state it is left in, both saved by the backend
// (quel.window).
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

// Save the window's state once a resize settles; the backend asks the
// window what the state is. A resize covers every way in and out of
// maximised and fullscreen, on every platform. Returns the fn that stops
// watching.
export function watchWindowState(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void api.saveWindowState().catch(() => {}), WINDOW_STATE_DELAY_MS);
  };
  window.addEventListener("resize", onResize);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("resize", onResize);
  };
}
