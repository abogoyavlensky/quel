import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { selectedWorkspace, useApp } from "@/state/store";
import { engineLabel, tagInk } from "./colors";
import { ConnMark } from "./ConnMark";

// The strip across the top of the window: the selected connection, or
// "Quel" with none. A colour tag tints the strip and colours the name, the
// one place a tag shows beyond its dot. It is the window's drag area: on
// macOS the title bar is hidden (:mac-title-bar :hidden-inset) and the
// traffic lights float over its left end. The content is centred, so it
// reserves no room for them, and fullscreen, where they go away, needs
// nothing. Server mode and Linux have no traffic lights; it reads the same.
export function TitleBar() {
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.selected));
  const w = useApp(selectedWorkspace);
  const tag = profile && profile.color !== "none" ? profile.color : null;

  return (
    <header
      style={tag ? ({ "--tag": `var(--color-tag-${tag})` } as CSSProperties) : undefined}
      className={cn(
        "flex h-10 shrink-0 items-center justify-center border-b bg-chrome px-24 text-xs [--wails-draggable:drag] select-none",
        tag &&
          "border-[color-mix(in_oklab,var(--tag)_25%,var(--border))] bg-[color-mix(in_oklab,var(--tag)_12%,var(--chrome))]",
      )}
    >
      {profile ? (
        <span
          className={cn(
            "flex h-[26px] min-w-0 items-center gap-2 rounded-full px-3",
            tag && "bg-background ring-1 ring-[color-mix(in_oklab,var(--tag)_25%,transparent)]",
          )}
        >
          <ConnMark engine={profile.engine} color={profile.color} status={w?.status ?? "disconnected"} />
          <span className={cn("max-w-80 truncate font-medium", tag ? tagInk[tag] : "text-foreground")} title={profile.name}>
            {profile.name}
          </span>
          <span className="shrink-0 text-muted-foreground">{engineLabel[profile.engine]}</span>
        </span>
      ) : (
        <span className="text-muted-foreground">Quel</span>
      )}
    </header>
  );
}
