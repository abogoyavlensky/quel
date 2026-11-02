import { Lock, ShieldAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { RunPolicy } from "@/sql/guard";
import { RUN_POLICIES } from "@/state/profileForm";
import { selectedWorkspace, useApp } from "@/state/store";
import { engineLabel, tagInk } from "./colors";
import { ConnMark } from "./ConnMark";

// A run policy other than Never ask, at the end of the connection pill.
// Neutral ink: colour belongs to the tag.
const policyMark: Record<Exclude<RunPolicy, "never">, { icon: typeof Lock; text: string }> = {
  writes: { icon: ShieldAlert, text: "Asks before changes" },
  always: { icon: ShieldAlert, text: "Asks before every query" },
  "read-only": { icon: Lock, text: "Read-only" },
};

function PolicyMark({ policy }: { policy: RunPolicy }) {
  if (policy === "never") return null;
  const { icon: Icon, text } = policyMark[policy];
  return (
    <>
      <span aria-hidden className="h-3 w-px shrink-0 bg-border" />
      <span
        className="flex shrink-0 items-center gap-1 text-muted-foreground"
        title={RUN_POLICIES.find((p) => p.value === policy)?.hint}
      >
        <Icon aria-hidden className="size-3" />
        {text}
      </span>
    </>
  );
}

// The strip across the top of the window: the selected connection, or
// "Quel" with none. A colour tag tints the strip and colours the name, the
// one place a tag shows beyond its dot. It is the window's drag area: on
// macOS the title bar is hidden (:mac-title-bar :hidden) and the traffic
// lights float over its left end. It is 36px like the status bar, so the
// tint shows around the pill; the standard title bar's lights sit a few
// pixels above its centre. The content is centred, so it
// reserves no room for them, and fullscreen, where they go away, needs
// nothing. Server mode and Linux have no traffic lights; it reads the same.
// The pill ends with the profile's run policy, unless it is Never ask.
export function TitleBar() {
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.selected));
  const w = useApp(selectedWorkspace);
  const tag = profile && profile.color !== "none" ? profile.color : null;

  return (
    <header
      style={tag ? ({ "--tag": `var(--color-tag-${tag})` } as CSSProperties) : undefined}
      className={cn(
        "flex h-9 shrink-0 items-center justify-center border-b bg-chrome px-24 text-xs [--wails-draggable:drag] select-none",
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
          <ConnMark engine={profile.engine} color={profile.color} status={w?.status ?? "disconnected"} />
          <span
            className={cn("max-w-80 truncate font-medium", tag ? tagInk[tag] : "text-foreground")}
            title={profile.name}
          >
            {profile.name}
          </span>
          <span className="shrink-0 text-muted-foreground">{engineLabel[profile.engine]}</span>
          <PolicyMark policy={profile["run-policy"]} />
        </span>
      ) : (
        <span className="text-muted-foreground">Quel</span>
      )}
    </header>
  );
}
