// A lost-and-restored connection, as the backend describes it in the error's
// data (quel.exec's :lost, sent by the bridge as the rejected call's cause).
// This is the one place that knows the shape.
export interface Lost {
  notRun: boolean; // nothing reached the server: safe to run again
  reconnected: boolean;
  page: boolean; // lost while loading more rows
  canceled: boolean;
  error: string; // the driver's message
}

export function lostOf(e: unknown): Lost | null {
  const cause = (e as { cause?: unknown } | null)?.cause;
  const l = (cause as { lost?: unknown } | null | undefined)?.lost as Record<string, unknown> | undefined;
  if (!l || typeof l !== "object" || typeof l.reconnected !== "boolean") return null;
  return {
    notRun: l["not-run"] === true,
    reconnected: l.reconnected,
    page: l.page === true,
    canceled: l.canceled === true,
    error: typeof l.error === "string" ? l.error : "",
  };
}
