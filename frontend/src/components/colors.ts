import type { Color, Engine } from "@/lib/types";

// The Tailwind classes for a connection's colour: one per engine, and one
// per profile colour tag (tokens in index.css). The bg- ones fill a swatch;
// the text- ones colour ConnMark, which draws with currentColor.

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

export const engineText: Record<Engine, string> = {
  sqlite: "text-engine-sqlite",
  postgres: "text-engine-postgres",
  redshift: "text-engine-redshift",
};

export const tagText: Record<Exclude<Color, "none">, string> = {
  red: "text-tag-red",
  orange: "text-tag-orange",
  yellow: "text-tag-yellow",
  green: "text-tag-green",
  blue: "text-tag-blue",
  purple: "text-tag-purple",
};
