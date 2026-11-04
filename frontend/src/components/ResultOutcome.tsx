import { cn } from "@/lib/utils";
import type { EditorTab, ResultTab } from "@/state/store";
import { LostNotice } from "./LostNotice";

// The body of a result with no rows: what its statement came to. Empty
// while it runs; the footer says so.
export function ResultOutcome({ tab, result }: { tab: EditorTab; result: Exclude<ResultTab, { kind: "rows" }> }) {
  return (
    <div role="region" aria-label="Statement outcome" className="h-full overflow-auto p-4 text-sm">
      {result.kind === "lost" ? (
        <LostNotice tab={tab} messageId={result.messageId} lost={result.lost} />
      ) : (
        result.kind !== "running" && (
          <p
            className={cn(
              "break-words whitespace-pre-wrap",
              result.kind === "error" && "text-destructive",
              result.kind === "canceled" && "text-muted-foreground",
            )}
          >
            {result.text}
          </p>
        )
      )}
    </div>
  );
}
