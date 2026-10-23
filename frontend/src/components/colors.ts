import type { Color, Engine } from "@/lib/types";

// The Tailwind classes for a connection's dot: one per engine, and one per
// profile colour tag (tokens in index.css).

export const engineColor: Record<Engine, string> = {
  sqlite: "bg-engine-sqlite",
  postgres: "bg-engine-postgres",
  redshift: "bg-engine-redshift",
};

export const tagColor: Record<Exclude<Color, "none">, string> = {
  red: "bg-tag-red",
  orange: "bg-tag-orange",
  yellow: "bg-tag-yellow",
  green: "bg-tag-green",
  blue: "bg-tag-blue",
  purple: "bg-tag-purple",
};
