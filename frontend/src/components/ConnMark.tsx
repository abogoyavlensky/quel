import { cn } from "@/lib/utils";
import type { Color, Engine } from "@/lib/types";
import type { ConnStatus } from "@/state/store";
import { engineText, tagText } from "./colors";

// A connection's dot, in the profile's colour tag when it has one, else one
// colour per engine; grey for no profile. Filled when connected, a hollow
// ring when not, pulsing while it connects or disconnects. Decoration only:
// the words for the state are on the row or the status bar.
export function ConnMark({
  engine,
  color = "none",
  status = "connected",
  className,
}: {
  engine: Engine | null;
  color?: Color;
  status?: ConnStatus;
  className?: string;
}) {
  const tone = color !== "none" ? tagText[color] : engine ? engineText[engine] : "text-muted-foreground/40";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        tone,
        status === "disconnected" ? "border-[1.5px] border-current" : "bg-current",
        (status === "connecting" || status === "disconnecting") && "animate-pulse",
        className,
      )}
    />
  );
}
