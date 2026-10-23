import { cn } from "@/lib/utils";
import type { Color, Engine } from "@/lib/types";
import { engineColor, tagColor } from "./colors";

// A connection's dot: the profile's colour tag when it has one, else one
// colour per engine; grey for no connection.
export function ConnMark({
  engine,
  color = "none",
  className,
}: {
  engine: Engine | null;
  color?: Color;
  className?: string;
}) {
  const bg = color !== "none" ? tagColor[color] : engine ? engineColor[engine] : "bg-muted-foreground/40";
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", bg, className)} />;
}
