import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { connectionWords } from "@/state/status";
import { selectedWorkspace, store, useApp } from "@/state/store";
import { updateLabel } from "@/state/updates";
import { engineLabel, tagInk } from "./colors";
import { ConnMark } from "./ConnMark";

// The strip across the top of the window: the selected connection, or
// "Quel" with none. The pill names it, its engine, and, unless it is
// connected, its state in words ("Not connected", "Connecting…"): the dot
// alone is too easy to miss. A colour tag tints the strip and colours the
// name, the one place a tag shows beyond its dot; the state words stay
// muted. At the right end, a newer version: a solid accent button, the
// one in the window, as it is the one thing asking for action, and a soft
// tint gets lost on a red or orange tag. It opens the update dialog.
//
// The strip is the window's drag area: on macOS the title bar is hidden
// (:mac-title-bar :hidden) and the traffic lights float over its left end.
// The button opts out (no-drag), so a click on it is a click. It is 36px,
// so the tint shows around the pill; the standard title bar's lights sit a
// few pixels above its centre. The content is centred, with the same wide
// padding on both sides so the pill never runs under the button or the
// lights; fullscreen, where the lights go away, needs nothing. Server mode
// and Linux have no traffic lights; it reads the same.
export function TitleBar() {
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.selected));
  const w = useApp(selectedWorkspace);
  const update = useApp((s) => updateLabel(s.update));
  const tag = profile && profile.color !== "none" ? profile.color : null;
  const status = w?.status ?? "disconnected";
  const words = connectionWords(status);

  return (
    <header
      style={tag ? ({ "--tag": `var(--color-tag-${tag})` } as CSSProperties) : undefined}
      className={cn(
        "relative flex h-9 shrink-0 items-center justify-center border-b bg-chrome px-40 text-xs [--wails-draggable:drag] select-none",
        tag &&
          "border-[color-mix(in_oklab,var(--tag)_25%,var(--border))] bg-[color-mix(in_oklab,var(--tag)_12%,var(--chrome))]",
      )}
    >
      {profile ? (
        <span
          className={cn(
            "flex h-6 min-w-0 items-center gap-2 rounded-full px-3",
            tag && "bg-background ring-1 ring-[color-mix(in_oklab,var(--tag)_25%,transparent)]",
          )}
        >
          <ConnMark engine={profile.engine} color={profile.color} status={status} />
          <span
            className={cn("max-w-80 truncate font-medium", tag ? tagInk[tag] : "text-foreground")}
            title={profile.name}
          >
            {profile.name}
          </span>
          <span className="shrink-0 text-muted-foreground">{engineLabel[profile.engine]}</span>
          {words && <span className="shrink-0 text-muted-foreground">· {words}</span>}
        </span>
      ) : (
        <span className="text-muted-foreground">Quel</span>
      )}
      {update && (
        <Button
          size="xs"
          className="absolute right-2.5 [--wails-draggable:no-drag]"
          onClick={() => store.setState({ updateDialogOpen: true })}
        >
          {update}
        </Button>
      )}
    </header>
  );
}
