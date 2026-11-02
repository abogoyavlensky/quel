import { classify } from "./classify";
import type { Statement } from "./split";

// What a profile's run policy makes of a run, before anything is sent.
// The run (the statement, the selection or the script) is judged whole:
// one question for all of it, and a refused script never half-runs.
//   never      runs
//   writes     asks if a statement may change something (write or unknown)
//   always     asks, listing every statement
//   read-only  refuses if a statement writes; asks if one is unknown
// Read-only is Quel's own refusal: the database is not told, so a role
// without write grants is still the real lock.

export type RunPolicy = "never" | "writes" | "always" | "read-only";
export type ConfirmReason = "writes" | "always" | "unknown";
export type Gate =
  | { action: "run" }
  | { action: "confirm"; reason: ConfirmReason; statements: Statement[] }
  | { action: "refuse"; statement: Statement };

export function gate(policy: RunPolicy, statements: Statement[]): Gate {
  if (policy === "never" || statements.length === 0) return { action: "run" };
  if (policy === "always") return { action: "confirm", reason: "always", statements };
  const classes = statements.map((s) => classify(s.text));
  if (policy === "writes") {
    const asked = statements.filter((_, i) => classes[i] === "write" || classes[i] === "unknown");
    return asked.length > 0 ? { action: "confirm", reason: "writes", statements: asked } : { action: "run" };
  }
  const refused = classes.indexOf("write");
  if (refused >= 0) return { action: "refuse", statement: statements[refused] };
  const unknown = statements.filter((_, i) => classes[i] === "unknown");
  return unknown.length > 0 ? { action: "confirm", reason: "unknown", statements: unknown } : { action: "run" };
}
