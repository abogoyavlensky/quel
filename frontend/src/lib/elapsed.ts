// A running query's time for the status bar, in whole seconds: "12s",
// "1m 05s", "1h 02m". Nothing under a second, so a quick query shows none.
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 1) return "";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
