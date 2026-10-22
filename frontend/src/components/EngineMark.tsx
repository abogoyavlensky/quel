import { cn } from "@/lib/utils";
import type { Engine } from "@/lib/types";

const color: Record<Engine, string> = {
  sqlite: "bg-engine-sqlite",
  postgres: "bg-engine-postgres",
  redshift: "bg-engine-redshift",
};

// The open database's marker: one colour per engine (a profile's colour
// tag takes this place later).
export function EngineMark({ engine, className }: { engine: Engine | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", engine ? color[engine] : "bg-muted-foreground/40", className)}
    />
  );
}
