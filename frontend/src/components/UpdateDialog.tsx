import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { openUrl } from "@/lib/browser";
import { copyText } from "@/lib/clipboard";
import type { UpdateState } from "@/lib/types";
import { restartNow, skipVersion, startDownload } from "@/state/updates";
import { store, useApp } from "@/state/store";

const BREW_UPGRADE = "brew upgrade --cask quel";

const close = () => store.setState({ updateDialogOpen: false });

// The update found by state/updates.ts: skip it, leave it, or download it
// and restart into it. Where this copy can't replace itself (dev or server
// mode, an ad-hoc build, a folder it can't write), it points to Homebrew.
// It can close while a download runs; the status bar keeps the progress.
export function UpdateDialog() {
  const u = useApp((s) => s.update);
  const open = useApp((s) => s.updateDialogOpen) && u.phase !== "idle";
  const connected = useApp((s) => Object.values(s.workspaces).some((w) => w.status === "connected"));
  if (u.phase === "idle") return null;
  const { current, release } = u.info;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update Quel</DialogTitle>
          <DialogDescription>
            Quel {release.version} is available. You have {current}.{" "}
            <button type="button" className="underline underline-offset-4" onClick={() => void openUrl(release.url)}>
              What's new
            </button>
          </DialogDescription>
        </DialogHeader>
        <Body u={u} connected={connected} />
      </DialogContent>
    </Dialog>
  );
}

function Body({ u, connected }: { u: Exclude<UpdateState, { phase: "idle" }>; connected: boolean }) {
  const releasePage = () => void openUrl(u.info.release.url);

  if (u.phase === "available" && !u.info["can-install"]) return <Brew onPage={releasePage} />;

  if (u.phase === "available")
    return (
      <DialogFooter>
        <Button variant="ghost" onClick={() => void skipVersion()}>
          Skip This Version
        </Button>
        <Button variant="outline" onClick={close}>
          Later
        </Button>
        <Button onClick={() => void startDownload()}>Update</Button>
      </DialogFooter>
    );

  if (u.phase === "downloading") {
    const pct = u.total > 0 ? Math.min(100, Math.round((u.written / u.total) * 100)) : null;
    return (
      <>
        <div
          role="progressbar"
          aria-label="Download"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct ?? 0}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">Downloading and checking the update…</p>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Hide
          </Button>
        </DialogFooter>
      </>
    );
  }

  if (u.phase === "ready" || u.phase === "restarting")
    return (
      <>
        <p className="text-sm">The update is ready. Quel restarts to install it.</p>
        {connected && (
          <p className="text-xs text-muted-foreground">Running queries are canceled and open transactions rolled back.</p>
        )}
        {u.phase === "ready" && u.saveError && (
          <p role="alert" className="break-words text-xs text-destructive">
            Could not save your tabs: {u.saveError}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={u.phase === "restarting"}>
            Later
          </Button>
          {u.phase === "ready" && u.saveError ? (
            <Button variant="destructive" onClick={() => void restartNow({ force: true })}>
              Restart Anyway
            </Button>
          ) : (
            <Button onClick={() => void restartNow()} disabled={u.phase === "restarting"}>
              {u.phase === "restarting" ? "Restarting…" : "Restart Now"}
            </Button>
          )}
        </DialogFooter>
      </>
    );

  // error
  return (
    <>
      <p role="alert" className="break-words text-sm text-destructive">
        The update failed: {u.message}
      </p>
      <DialogFooter>
        <Button variant="ghost" onClick={() => void skipVersion()}>
          Skip This Version
        </Button>
        <Button variant="outline" onClick={releasePage}>
          Open Release Page
        </Button>
        <Button onClick={() => void startDownload()}>Try Again</Button>
      </DialogFooter>
    </>
  );
}

// This copy can't replace itself: update with Homebrew, or download it.
function Brew({ onPage }: { onPage: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <p className="text-sm">This copy of Quel can't update itself. Update it with Homebrew:</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md bg-muted px-2 py-1.5 font-mono text-xs">{BREW_UPGRADE}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void copyText(BREW_UPGRADE).then((ok) => setCopied(ok))}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => void skipVersion()}>
          Skip This Version
        </Button>
        <Button variant="outline" onClick={close}>
          Later
        </Button>
        <Button onClick={onPage}>Open Release Page</Button>
      </DialogFooter>
    </>
  );
}
