import { cn } from "@/lib/utils";
import type { ResultTab } from "@/state/store";

// The body of a result with no rows: what its statement came to. Empty
// while it runs; the footer says so.
export function ResultOutcome({ result }: { result: Exclude<ResultTab, { kind: "rows" }> }) {
  return (
    <div role="region" aria-label="Statement outcome" className="h-full overflow-auto p-4 text-sm">
      {result.kind !== "running" && (
        <p
          className={cn(
            "break-words whitespace-pre-wrap",
            result.kind === "error" && "text-destructive",
            result.kind === "canceled" && "text-muted-foreground",
          )}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
